// FAQ matching — verified content only. The AI is never allowed to
// invent or edit official SafeHer procedures; this module is what
// surfaces a matched row's answer VERBATIM, before the AI provider is
// ever called.

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export interface FaqRow {
  faq_id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
}

// A simple keyword + question-word overlap score. Proportional to a
// foundational-phase FAQ set (tens, not thousands, of rows) — no need
// for full-text search infrastructure yet.
const MIN_CONFIDENCE_SCORE = 3;

export async function matchFaq(client: AnySupabaseClient, rawText: string): Promise<FaqRow | null> {
  const { data, error } = await client.from('faqs').select('faq_id, category, question, answer, keywords').eq('is_active', true);
  if (error || !data || data.length === 0) return null;

  const normalized = rawText.toLowerCase();
  let best: { row: FaqRow; score: number } | null = null;

  for (const row of data as FaqRow[]) {
    let score = 0;
    for (const kw of row.keywords ?? []) {
      if (kw && normalized.includes(kw.toLowerCase())) score += 2;
    }
    const questionWords = row.question
      .toLowerCase()
      .split(/\W+/)
      .filter((w: string) => w.length > 3);
    for (const w of questionWords) {
      if (normalized.includes(w)) score += 1;
    }
    if (!best || score > best.score) best = { row, score };
  }

  return best && best.score >= MIN_CONFIDENCE_SCORE ? best.row : null;
}
