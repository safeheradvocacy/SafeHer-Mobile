// Groq provider — OpenAI-compatible chat completions endpoint. This is
// the only file that knows Groq's request/response shape; index.ts only
// ever talks to the AiProvider interface.
import type { AiProvider } from './types.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// llama-3.3-70b-versatile was retired by Groq on 2026-08-16 (confirmed via
// a live 404 "model does not exist" response). openai/gpt-oss-120b is
// Groq's current recommended production model and supports JSON mode
// (response_format below), which is the only Groq-specific feature this
// provider depends on.
const GROQ_MODEL = 'openai/gpt-oss-120b';

export function createGroqProvider(apiKey: string): AiProvider {
  return {
    async generate({ systemPrompt, userMessage }) {
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.4,
          max_tokens: 400,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        // Never include the API key here — it's never in this string in
        // the first place (it only ever lives in the Authorization
        // header), but worth stating explicitly given how easy this class
        // of bug is to introduce by accident.
        throw new Error(`Groq API error (${response.status}): ${text}`);
      }

      const data = await response.json();
      const rawText: string = data?.choices?.[0]?.message?.content ?? '';
      return { rawText };
    },
  };
}
