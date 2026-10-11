// Layer 1 — deterministic, rule-based safety classification. Runs BEFORE
// any AI call, on every message, so an emergency-sounding message never
// depends on a third-party AI provider being reachable at all.
//
// Deliberately conservative: a bare mention of a word like "violence" or
// "hurt" on its own is only ever SUPPORT, never URGENT/EMERGENCY — those
// two require a phrase describing an actual active/imminent situation.
// This is intentional (see module comment in the mobile brief this
// implements): "do not create a simplistic system where every mention of
// 'violence' automatically sends an SOS."

import type { MessageRiskLevel } from './types.ts';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Phrases describing violence/danger actively happening right now.
const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(he|she|they)( is| are|s)?\s*(attacking|hurting|hitting|choking|strangling|stabbing)\s*me\b/,
  /\bsomeone is (attacking|hurting|choking|strangling) me\b/,
  /\bi am (being )?(attacked|beaten|stabbed|strangled|choked)\b/,
  /\b(he|she|they) has? a (knife|gun|weapon)\b/,
  /\bi need help (now|right now|immediately)\b/,
  /\b(call|calling) (the )?(police|911) now\b/,
  /\bnot safe right now\b/,
  /\bin (immediate )?danger right now\b/,
  /\bviolence is happening (now|right now)\b/,
  /\bhes going to kill me\b/,
  /\bshes going to kill me\b/,
];

// Phrases describing a threatening or unsafe situation, without a clear
// signal that violence is actively occurring at this exact moment.
const URGENT_PATTERNS: RegExp[] = [
  /\bi am (scared|afraid|terrified)\b/,
  /\b(he|she|they) (threatened|is threatening|keeps threatening) me\b/,
  /\bsomeone is following me\b/,
  /\bi dont feel safe\b/,
  /\bi am not safe\b/,
  /\b(he|she|they)s going to hurt me\b/,
  /\bi think (he|she|they) (is|are) going to hurt me\b/,
  /\bi am being threatened\b/,
];

// Broad single-word/phrase signals that this is a difficult topic, but
// with none of the specificity above — worth a gentler, supportive
// response and a visible "talk to an expert" option, not the safety panel.
const SUPPORT_PATTERNS: RegExp[] = [
  /\babuse\b/,
  /\bviolence\b/,
  /\bhurt(ing)?\b/,
  /\bthreat(en|ened|s)?\b/,
  /\bafraid\b/,
  /\bscared\b/,
  /\bunsafe\b/,
  /\bdanger(ous)?\b/,
  /\bhit (me|us)\b/,
];

export function classifyMessageRuleBased(rawText: string): MessageRiskLevel {
  const text = normalize(rawText);
  if (EMERGENCY_PATTERNS.some((p) => p.test(text))) return 'EMERGENCY';
  if (URGENT_PATTERNS.some((p) => p.test(text))) return 'URGENT';
  if (SUPPORT_PATTERNS.some((p) => p.test(text))) return 'SUPPORT';
  return 'NORMAL';
}

const RISK_RANK: Record<MessageRiskLevel, number> = { NORMAL: 0, SUPPORT: 1, URGENT: 2, EMERGENCY: 3 };

// The rule engine is deterministic and trusted; the AI's own classification
// is probabilistic and only ever allowed to escalate, never downgrade, the
// rule engine's read of the same message.
export function maxRiskLevel(a: MessageRiskLevel, b: MessageRiskLevel): MessageRiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}
