// supabase/functions/safeher-chatbot/index.ts
//
// Deploy with:
//   supabase functions deploy safeher-chatbot
//   supabase secrets set AI_API_KEY=gsk_...   (a Groq API key — console.groq.com)
//
// The mobile app calls this via supabase.functions.invoke('safeher-chatbot',
// { body: { sessionId, message } }) for every message sent while a chat
// session is in AI mode. It never calls Groq (or any AI provider) directly,
// and never sees AI_API_KEY.
//
// ARCHITECTURE — every message goes through these layers IN ORDER, and
// stops at the first one that produces a response. The AI provider is the
// LAST resort, not the first:
//   1. Safety evaluation (rule-based, deterministic, no network call)
//   2. FAQ matching (verified content, no AI involved)
//   3. Guided intent detection (deterministic keyword rules)
//   4. AI provider (Groq), asked for structured JSON output
// This keeps the assistant fast and free for the majority of messages,
// and means an AI provider outage never breaks safety detection, FAQ
// answers, or guided navigation — only the free-form conversational
// fallback.
//
// The survivor's OWN message is inserted by the mobile client directly
// (RLS-governed, sender_type='User') before this function is even called.
// This function only ever inserts the AI/System reply, and does so with
// the SERVICE ROLE client deliberately — 'AI' and 'System' sender_type
// values are absent from chat_messages' client-facing RLS with-check (see
// module6_ai_support.sql), so this is the ONLY code path in the whole
// system that can ever write an AI or System message. A survivor's own
// client can never spoof one.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { classifyMessage, maxRiskLevel, priorityForLevel, requiresExpertHandoff, type RiskCategory } from './safety.ts';
import { matchFaq } from './faq.ts';
import { detectGuidedIntent } from './guidedActions.ts';
import { createGroqProvider } from './providers/groq.ts';
import {
  ACTION_LOOKUP,
  EXPERT_ACTION,
  SHELTER_ACTION,
  SOS_ACTION,
  isAllowedActionType,
  type ActionType,
  type ChatbotResponse,
  type MessageRiskLevel,
  type SafeHerAction,
} from './types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You are SafeSpace's AI assistant, embedded in a mobile support app for survivors of violence against women and children in Aurora province, Philippines.

Identity and tone:
- Be calm, warm, respectful, and non-judgmental. Keep replies concise (under 100 words) and easy to read.
- You are SafeSpace's AI assistant — never imply you are a human, and never claim to be a licensed counselor, lawyer, doctor, or social worker.

What you help with: explaining SafeSpace features accurately (incident reporting, case tracking, the shelter locator and shelter requests, Emergency SOS, and requesting a SafeSpace support expert), and general, non-clinical safety-planning information.

What you must NEVER do:
- Never diagnose medical or psychological conditions, or give legal conclusions.
- Never guarantee safety, guarantee shelter admission, or promise a specific emergency response time.
- Never claim an SOS alert has been sent — only the person's own action in the app does that.
- Never invent or guess a person's case status or any other database information. If asked about case status, say you can't look it up directly here and that Track My Cases shows the real, current status.
- Never ask for a full legal name, exact address, or other identifying details beyond what the person volunteers.

When it seems appropriate, mention: "If you prefer to speak with a person, you can request a SafeSpace support expert."

Respond with ONLY a single JSON object, no other text, matching exactly this shape:
{"reply": string, "risk_level": "NORMAL"|"SUPPORT"|"URGENT"|"EMERGENCY", "needs_human_support": boolean, "actions": string[]}

risk_level guidance (be conservative — most messages are NORMAL):
- NORMAL: a general question or everyday conversation.
- SUPPORT: discussing a difficult situation, but not describing active danger.
- URGENT: describes fear, threats, or an unsafe situation without a clear sign of danger happening right now.
- EMERGENCY: clearly describes violence or danger happening right now.

"actions" must contain zero or more of EXACTLY these strings, only when clearly relevant, usually 0-2: "OPEN_INCIDENT_REPORT", "OPEN_CASE_TRACKING", "OPEN_SHELTER_LOCATOR", "OPEN_SHELTER_REQUEST", "OPEN_EMERGENCY_SOS", "REQUEST_EXPERT_HELP".`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const res = await handleRequest(req);
    const body = await res.text();
    return new Response(body, { status: res.status, headers: { ...Object.fromEntries(res.headers.entries()), ...corsHeaders } });
  } catch (e) {
    // Never leak raw technical detail to the client — log it here (visible
    // via `supabase functions logs`) and return a generic, calm fallback
    // instead of a stack trace.
    console.error('[safeher-chatbot] unhandled error:', e);
    const fallback: ChatbotResponse = unavailableResponse();
    return new Response(JSON.stringify(fallback), { status: 200, headers: { 'content-type': 'application/json', ...corsHeaders } });
  }
});

function unavailableResponse(debugDetail?: string): ChatbotResponse & { debugDetail?: string } {
  return {
    reply: "SafeSpace Assistant is temporarily unavailable. You can still use these options right away.",
    senderType: 'System',
    source: 'unavailable',
    riskLevel: 'NORMAL',
    actions: [EXPERT_ACTION, SOS_ACTION, SHELTER_ACTION],
    needsHumanSupport: false,
    messageId: null,
    // TEMPORARY diagnostic aid — only ever attached when the caller sends
    // `x-debug: 1` (the mobile app only does this in __DEV__ builds), and
    // even then it's never more than the AI provider's OWN error response
    // (e.g. Groq's "model not found" message) — never the API key, which
    // only ever lives in the outbound Authorization header, never in a
    // thrown error's message text. Remove once the current AI-provider
    // failure is root-caused.
    ...(debugDetail ? { debugDetail } : {}),
  };
}

/** Outcome of the automatic handoff — drives what the user is told. */
type HandoffOutcome = 'queued' | 'already_queued' | 'with_expert' | 'failed';

/**
 * Creates or reuses the expert support request for this conversation.
 *
 * Idempotency is enforced by the DATABASE, not by checking first:
 * module6's `idx_expert_requests_one_active_per_conversation` is a
 * unique partial index on conversation_id WHERE status != 'CLOSED'. A
 * concurrent duplicate therefore loses with 23505 rather than creating a
 * second queue entry — a check-then-insert would race.
 *
 * Never touches `status` or `assigned_expert_id` on an existing row. If
 * an expert has already been assigned or has accepted, that assignment
 * is theirs; repeated high-risk messages may raise the PRIORITY of a
 * still-waiting request but must not disturb the workflow around it.
 */
async function ensureExpertRequest(
  // Typed `any` to match insertReply() below — the generated Database
  // types are not wired into this function, and a half-typed client here
  // only produces noise at the call sites.
  serviceClient: any,
  sessionId: string,
  profileId: string,
  level: MessageRiskLevel,
  category: RiskCategory
): Promise<HandoffOutcome> {
  const priority = priorityForLevel(level);
  // `reason` is a category label, never the user's words — this string
  // is shown in the expert queue and must not leak message content.
  const reason = `Automatic safety escalation (${category ?? 'UNSPECIFIED'})`;

  const { error } = await serviceClient
    .from('expert_support_requests')
    .insert({ conversation_id: sessionId, profile_id: profileId, reason, priority });

  if (!error) return 'queued';

  // 23505 = unique violation: an active request already exists.
  if (error.code !== '23505') {
    console.error('[safeher-chatbot] expert request insert failed:', error.code, error.message);
    return 'failed';
  }

  const { data: existing } = await serviceClient
    .from('expert_support_requests')
    .select('request_id, status, priority')
    .eq('conversation_id', sessionId)
    .neq('status', 'CLOSED')
    .maybeSingle();

  if (!existing) return 'failed';
  const row = existing as { request_id: string; status: string; priority: string | null };

  // Raise priority only — and only upward. Attempted separately and
  // tolerated on failure: the request already being in the queue is the
  // outcome that matters, and module6's update trigger is deliberately
  // strict about who may change these rows.
  const RANK = { NORMAL: 0, HIGH: 1, URGENT: 2 } as const;
  const current = (row.priority ?? 'NORMAL') as keyof typeof RANK;
  if (RANK[priority] > RANK[current]) {
    const { error: bumpErr } = await serviceClient
      .from('expert_support_requests')
      .update({ priority })
      .eq('request_id', row.request_id);
    if (bumpErr) console.error('[safeher-chatbot] priority bump failed (non-fatal):', bumpErr.code);
  }

  // An already-accepted conversation is told the truth: a person is
  // already on it, rather than "you have been added to the queue".
  return row.status === 'EXPERT_ASSIGNED' || row.status === 'EXPERT_ACTIVE' ? 'with_expert' : 'already_queued';
}

/**
 * The safety reply. Wording is driven by the REAL handoff outcome, so
 * the assistant never claims a human is involved unless the database
 * says so — and says plainly when the request could not be confirmed.
 */
function safetyPanelResponse(
  riskLevel: MessageRiskLevel,
  category: RiskCategory,
  handoff: HandoffOutcome
): Omit<ChatbotResponse, 'messageId'> {
  const opening =
    category === 'SELF_HARM'
      ? "I'm really glad you told me, and I'm concerned about your safety. You deserve support from a person right now."
      : riskLevel === 'EMERGENCY'
        ? "I'm concerned about your safety. If you are in immediate danger, move to a safer place if you can."
        : 'It sounds like things feel unsafe right now. You are not alone, and you decide what happens next.';

  const handoffLine =
    handoff === 'queued' || handoff === 'already_queued'
      ? 'I have requested a SafeSpace support expert — your conversation is waiting for someone to join. You do not need to share more than you are comfortable sharing.'
      : handoff === 'with_expert'
        ? 'A SafeSpace support expert is already connected to this conversation.'
        : // Never claims a queue position that was not confirmed.
          'I could not confirm a support request just now. Please use the "Talk to an Expert" button below, or contact local emergency services if you are in immediate danger.';

  const closing =
    category === 'SELF_HARM'
      ? 'If you might act on these thoughts, please reach out to someone nearby you trust, or local emergency services, right away.'
      : 'If you are in immediate danger, contact local emergency services or someone you trust when it is safe to do so.';

  return {
    reply: `${opening}\n\n${handoffLine}\n\n${closing}`,
    senderType: 'System',
    source: 'safety',
    riskLevel,
    actions: [SOS_ACTION, EXPERT_ACTION, SHELTER_ACTION],
    needsHumanSupport: true,
  };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }
  // TEMPORARY diagnostic aid (see unavailableResponse) — only the mobile
  // app's own __DEV__ builds ever send this.
  const debugRequested = req.headers.get('x-debug') === '1';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Scoped to the CALLER's own JWT — every read through this client is
  // subject to the caller's own RLS, same as if the mobile app queried
  // directly. Never used to write AI/System messages.
  const callerClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
  // Service-role — used ONLY to insert the AI/System reply (see file
  // header for why that specific write can't go through the caller's
  // own RLS-governed client).
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user: callerUser },
  } = await callerClient.auth.getUser();
  if (!callerUser) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
  }

  const { data: callerProfile } = await callerClient.from('user_profiles').select('profile_id').eq('auth_user_id', callerUser.id).single();
  if (!callerProfile) {
    return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const sessionId = body?.sessionId;
  const message = body?.message;
  if (!sessionId || !message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'sessionId and message are required' }), { status: 400 });
  }
  if (message.length > 2000) {
    return new Response(JSON.stringify({ error: 'message is too long' }), { status: 400 });
  }

  // RLS already scopes this to sessions the caller can see; the explicit
  // profile_id check below is defense-in-depth, not the only guard.
  const { data: session } = await callerClient.from('chat_sessions').select('session_id, profile_id, mode, status').eq('session_id', sessionId).single();
  if (!session || session.profile_id !== callerProfile.profile_id) {
    return new Response(JSON.stringify({ error: 'Chat session not found' }), { status: 404 });
  }

  // AI must stop during human takeover — this function is never the one
  // generating a reply once an expert is active. A client that's behaving
  // correctly won't call this endpoint in that state; this is the
  // server-side backstop.
  if (session.mode === 'HUMAN') {
    return new Response(
      JSON.stringify({ error: 'This conversation is with a SafeSpace support representative — the AI assistant is paused.' }),
      { status: 409 }
    );
  }

  const classification = classifyMessage(message);
  const ruleLevel = classification.level;

  // Layer 1 result alone is enough to short-circuit straight to the
  // safety panel — no FAQ lookup, no AI call, for the two most severe
  // levels. Speed matters here, and a third-party AI outage must never
  // delay this.
  //
  // The handoff is created BEFORE the reply is composed, so what the
  // user is told reflects what actually happened in the database rather
  // than what was intended. This path never calls Groq, which is the
  // whole point: a provider outage cannot disable escalation.
  if (requiresExpertHandoff(ruleLevel)) {
    const handoff = await ensureExpertRequest(
      serviceClient,
      sessionId,
      callerProfile.profile_id,
      ruleLevel,
      classification.category
    );
    const built = safetyPanelResponse(ruleLevel, classification.category, handoff);
    const messageId = await insertReply(serviceClient, sessionId, built, ruleLevel);
    return jsonResponse({ ...built, messageId });
  }

  const faqMatch = await matchFaq(callerClient, message);
  if (faqMatch) {
    const built: Omit<ChatbotResponse, 'messageId'> = {
      reply: faqMatch.answer,
      senderType: 'AI',
      source: 'faq',
      riskLevel: ruleLevel,
      actions: ruleLevel === 'SUPPORT' ? [EXPERT_ACTION] : [],
      needsHumanSupport: ruleLevel === 'SUPPORT',
    };
    const messageId = await insertReply(serviceClient, sessionId, built, ruleLevel, { source: 'faq', faqId: faqMatch.faq_id });
    return jsonResponse({ ...built, messageId });
  }

  const guided = detectGuidedIntent(message);
  if (guided) {
    const built: Omit<ChatbotResponse, 'messageId'> = {
      reply: guided.reply,
      senderType: 'AI',
      source: 'guided',
      riskLevel: ruleLevel,
      actions: guided.actions,
      needsHumanSupport: false,
    };
    const messageId = await insertReply(serviceClient, sessionId, built, ruleLevel, { source: 'guided' });
    return jsonResponse({ ...built, messageId });
  }

  const apiKey = Deno.env.get('AI_API_KEY');
  if (!apiKey) {
    const built = unavailableResponse();
    const messageId = await insertReply(serviceClient, sessionId, built, ruleLevel);
    return jsonResponse({ ...built, riskLevel: ruleLevel, messageId });
  }

  try {
    const provider = createGroqProvider(apiKey);
    const { rawText } = await provider.generate({ systemPrompt: SYSTEM_PROMPT, userMessage: message });
    const parsed = parseAiJson(rawText);
    const finalLevel = maxRiskLevel(ruleLevel, parsed.riskLevel);

    // The AI may only ESCALATE (maxRiskLevel), so this catches danger
    // the rules worded differently — indirect phrasing, an unfamiliar
    // dialect — and escalates it the same way.
    if (requiresExpertHandoff(finalLevel)) {
      const handoff = await ensureExpertRequest(
        serviceClient,
        sessionId,
        callerProfile.profile_id,
        finalLevel,
        classification.category
      );
      const built = safetyPanelResponse(finalLevel, classification.category, handoff);
      const messageId = await insertReply(serviceClient, sessionId, built, finalLevel);
      return jsonResponse({ ...built, messageId });
    }

    const actions: SafeHerAction[] = parsed.actionTypes.map((t) => ACTION_LOOKUP[t]);
    if (parsed.needsHumanSupport && !actions.some((a) => a.type === 'REQUEST_EXPERT_HELP')) {
      actions.push(EXPERT_ACTION);
    }

    const built: Omit<ChatbotResponse, 'messageId'> = {
      reply: parsed.reply,
      senderType: 'AI',
      source: 'ai',
      riskLevel: finalLevel,
      actions,
      needsHumanSupport: parsed.needsHumanSupport,
    };
    const messageId = await insertReply(serviceClient, sessionId, built, finalLevel, { source: 'ai' });
    return jsonResponse({ ...built, messageId });
  } catch (err) {
    console.error('[safeher-chatbot] AI provider error:', err);
    const built = unavailableResponse(debugRequested ? (err instanceof Error ? err.message : String(err)) : undefined);
    const messageId = await insertReply(serviceClient, sessionId, built, ruleLevel);
    return jsonResponse({ ...built, riskLevel: ruleLevel, messageId });
  }
}

function jsonResponse(body: ChatbotResponse): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
async function insertReply(
  serviceClient: any,
  sessionId: string,
  built: Omit<ChatbotResponse, 'messageId'>,
  riskLevel: MessageRiskLevel,
  metadata?: Record<string, unknown>
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      sender_type: built.senderType,
      sender_profile_id: null,
      message: built.reply,
      message_metadata: metadata ? { ...metadata, actions: built.actions.map((a) => a.type) } : { actions: built.actions.map((a) => a.type) },
      risk_level: riskLevel,
    })
    .select('message_id')
    .single();
  if (error) {
    console.error('[safeher-chatbot] failed to insert reply message:', error.message);
    return null;
  }
  return data?.message_id ?? null;
}

interface ParsedAiJson {
  reply: string;
  riskLevel: MessageRiskLevel;
  needsHumanSupport: boolean;
  actionTypes: ActionType[];
}

function filterActionTypes(value: unknown): ActionType[] {
  return Array.isArray(value) ? value.filter(isAllowedActionType) : [];
}

const VALID_RISK_LEVELS: MessageRiskLevel[] = ['NORMAL', 'SUPPORT', 'URGENT', 'EMERGENCY'];

// The AI's raw output is NEVER trusted as-is — every field is validated
// and clamped to a safe default here before anything downstream sees it.
function parseAiJson(rawText: string): ParsedAiJson {
  let obj: Record<string, unknown> = {};
  try {
    // Groq's json_object mode should return clean JSON, but strip a
    // markdown code fence defensively in case the model wraps it anyway.
    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    obj = JSON.parse(cleaned);
  } catch {
    return { reply: "I'm here to help. Could you tell me a bit more?", riskLevel: 'NORMAL', needsHumanSupport: false, actionTypes: [] };
  }

  const reply = typeof obj.reply === 'string' && obj.reply.trim() ? obj.reply.trim().slice(0, 1000) : "I'm here to help. Could you tell me a bit more?";
  const riskLevel = VALID_RISK_LEVELS.includes(obj.risk_level as MessageRiskLevel) ? (obj.risk_level as MessageRiskLevel) : 'NORMAL';
  const needsHumanSupport = typeof obj.needs_human_support === 'boolean' ? obj.needs_human_support : false;
  const actionTypes = filterActionTypes(obj.actions);

  return { reply, riskLevel, needsHumanSupport, actionTypes };
}
