import { useCallback, useEffect, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { ChatMessage, ChatSession } from '../types/database.types';

// Dev-only, sanitized diagnostics for the one class of failure that was
// previously a black hole: supabase.functions.invoke() only ever
// resolves { data: null, error } for a non-2xx response — it never
// exposes the actual status or response body to the caller, so without
// this, every failure (401 bad session, 400 bad body, 404 unknown
// session, 409 human-mode conflict, 500 unhandled) rendered as the exact
// same generic fallback with zero way to tell which one happened.
// Never logs the Authorization header or any token — only status and
// the server's own (already-non-sensitive) JSON error/reply body.
async function logChatbotError(context: string, error: unknown) {
  if (!__DEV__) return;
  if (error instanceof FunctionsHttpError) {
    const res = error.context;
    let body: unknown = null;
    try {
      body = await res.clone().json();
    } catch {
      try {
        body = await res.clone().text();
      } catch {
        body = '<unreadable body>';
      }
    }
    console.warn(`[useSupportChat] ${context}: HTTP ${res.status} from safeher-chatbot`, body);
    return;
  }
  console.warn(`[useSupportChat] ${context}: request never reached safeher-chatbot (network/relay error)`, error instanceof Error ? error.message : error);
}

/**
 * Owns the survivor's SafeHer Assistant conversation end to end: loading
 * or creating today's session, the message list, sending a message
 * (insert as 'User' directly — RLS-governed — then invoke the
 * safeher-chatbot Edge Function for the reply), requesting expert
 * support, and two narrowly-scoped realtime subscriptions (this session's
 * own messages, this session's own status/mode) — never a blanket
 * subscription across all conversations. Both are cleaned up whenever the
 * session changes or the screen unmounts.
 */
export function useSupportChat(profileId: string | undefined) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [requestingExpert, setRequestingExpert] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  sessionRef.current = session;

  const loadOrCreateSession = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    // A CLOSED session's is_active is flipped to false server-side (see
    // sync_chat_session_from_request in module6_ai_support.sql), so this
    // naturally starts a fresh session for the next conversation instead
    // of ever reopening a closed one.
    const { data: existing } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1);

    let s = existing?.[0] as ChatSession | undefined;
    if (!s) {
      const { data: created } = await supabase.from('chat_sessions').insert({ profile_id: profileId, is_active: true }).select().single();
      s = created ?? undefined;
    }
    if (!s) {
      setLoading(false);
      return;
    }
    setSession(s);

    const { data: msgs } = await supabase.from('chat_messages').select('*').eq('session_id', s.session_id).order('created_at', { ascending: true });
    setMessages(msgs ?? []);
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    loadOrCreateSession();
  }, [loadOrCreateSession]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`assistant-messages-${session.session_id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${session.session_id}` },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => (prev.some((m) => m.message_id === msg.message_id) ? prev : [...prev, msg]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.session_id]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`assistant-session-${session.session_id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_sessions', filter: `session_id=eq.${session.session_id}` },
        (payload) => setSession(payload.new as ChatSession)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.session_id]);

  const sendMessage = useCallback(
    async (text: string) => {
      const s = sessionRef.current;
      const trimmed = text.trim();
      if (!s || !profileId || !trimmed) return;
      setSending(true);
      setLastError(null);

      const { data: userMsg, error: insertErr } = await supabase
        .from('chat_messages')
        .insert({ session_id: s.session_id, sender_type: 'User', sender_profile_id: profileId, message: trimmed })
        .select()
        .single();
      if (insertErr || !userMsg) {
        setSending(false);
        setLastError("Couldn't send your message. Please try again.");
        return;
      }
      setMessages((prev) => [...prev, userMsg]);

      // AI is paused during human takeover (mode 'HUMAN') — the message
      // above still reaches the assigned expert once they're active, it
      // just never goes to the Edge Function while a human owns this
      // conversation.
      if (s.mode !== 'AI') {
        setSending(false);
        return;
      }

      try {
        // x-debug is read server-side ONLY to decide whether to attach a
        // temporary, sanitized debugDetail field to an "unavailable"
        // response (see safeher-chatbot/index.ts) — __DEV__ gates it so a
        // production build never requests or sees it.
        const { data, error } = await supabase.functions.invoke('safeher-chatbot', {
          headers: __DEV__ ? { 'x-debug': '1' } : undefined,
          body: { sessionId: s.session_id, message: trimmed },
        });
        if (error) throw error;

        // This is the "quiet" degradation path: the function itself
        // responded 200 (so no error was thrown), but internally hit its
        // own AI-provider-unavailable branch (e.g. Groq call failed) and
        // is returning its own graceful fallback text as a normal
        // message. Flag it in dev so this doesn't look identical to a
        // genuine request failure with zero trace of which one happened.
        if (__DEV__ && data?.source === 'unavailable') {
          console.warn(
            '[useSupportChat] safeher-chatbot responded 200 but source="unavailable" — the AI provider call failed server-side.',
            data?.debugDetail ? `Detail: ${data.debugDetail}` : '(no detail attached — re-check that x-debug was sent)'
          );
        }

        if (data?.messageId) {
          setMessages((prev) =>
            prev.some((m) => m.message_id === data.messageId)
              ? prev
              : [
                  ...prev,
                  {
                    message_id: data.messageId,
                    session_id: s.session_id,
                    sender_type: data.senderType,
                    sender_profile_id: null,
                    message: data.reply,
                    message_metadata: { actions: data.actions },
                    risk_level: data.riskLevel,
                    created_at: new Date().toISOString(),
                  } as ChatMessage,
                ]
          );
        }
      } catch (err) {
        await logChatbotError('sendMessage', err);
        setLastError('SafeSpace Assistant is temporarily unavailable. You can still use Emergency SOS, Find Shelter, or Talk to an Expert below.');
      } finally {
        setSending(false);
      }
    },
    [profileId]
  );

  const requestExpertSupport = useCallback(
    async (reason?: string) => {
      const s = sessionRef.current;
      if (!s || !profileId) return { error: 'Not ready yet. Please try again.' };
      // Already requested/assigned/active for this conversation — treat
      // as a no-op rather than creating a duplicate request.
      if (s.status !== 'AI_ASSISTED') return { error: null };

      setRequestingExpert(true);
      const { error } = await supabase
        .from('expert_support_requests')
        .insert({ conversation_id: s.session_id, profile_id: profileId, reason: reason || null });
      setRequestingExpert(false);
      if (error) return { error: error.message || 'Could not request an expert. Please try again.' };

      // Optimistic local update — the realtime chat_sessions subscription
      // will confirm shortly, this just avoids a visible flash back to
      // the old state in the meantime.
      setSession((prev) => (prev ? { ...prev, status: 'WAITING_FOR_EXPERT' } : prev));
      return { error: null };
    },
    [profileId]
  );

  return { session, messages, loading, sending, requestingExpert, lastError, sendMessage, requestExpertSupport, reload: loadOrCreateSession };
}
