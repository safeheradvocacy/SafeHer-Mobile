// supabase/functions/safeher-chatbot/index.ts
//
// Deploy with:
//   supabase functions deploy safeher-chatbot
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// The mobile app calls this via supabase.functions.invoke('safeher-chatbot', ...)
// and falls back to a small offline FAQ list if this function is undeployed,
// errors, or the secret isn't set — so shipping without this file wired up
// yet does not break the app, it just runs in fallback mode.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const SYSTEM_PROMPT = `You are the SafeHer assistant, embedded in a mobile app for survivors of violence against
women and children in Aurora province, Philippines. You give calm, brief, practical guidance about:
- how to submit an incident report (Home > Report Incident, anonymous option available)
- how to check case status (Track My Cases)
- how to find shelters (Shelter Locator)
- how to use the SOS button in an emergency
- general safety planning information

You are NOT a replacement for an emergency responder, a lawyer, or a social worker, and you must say so
if the person describes an urgent or dangerous situation — direct them to the SOS button instead.
Keep replies under 100 words. Never ask for identifying details beyond what the person volunteers.`;

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 501 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(JSON.stringify({ error: `AI backend error: ${text}` }), { status: 502 });
    }

    const data = await response.json();
    const reply = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';

    return new Response(JSON.stringify({ reply }), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
