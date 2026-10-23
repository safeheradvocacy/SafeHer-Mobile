// Layer 1 — deterministic, rule-based safety classification. Runs BEFORE
// any AI call, on every message, so an emergency-sounding message never
// depends on a third-party AI provider being reachable at all.
//
// =====================================================================
// WHY THIS WAS REWRITTEN — measured gaps in the previous version
// =====================================================================
// The previous rule set was English-only and had no self-harm patterns
// whatsoever. Run against the phrase list this module is required to
// handle, 17 of 20 came back NORMAL — meaning no safety response, no
// escalation, nothing:
//
//   "I want to die"            -> NORMAL
//   "I want to kill myself"    -> NORMAL
//   "Magpapakamatay ako"       -> NORMAL
//   "Sinasaktan niya ako"      -> NORMAL
//   "Papatayin niya ako"       -> NORMAL
//   "Hindi ako ligtas"         -> NORMAL
//
// On a VAWC platform serving Aurora province — where Filipino and
// Taglish are the everyday languages — an English-only classifier is
// not a partial solution, it is a classifier that misses most real
// disclosures. Self-harm being absent entirely was the sharper problem:
// a user writing "I want to die" received an ordinary chatbot reply.
//
// =====================================================================
// DESIGN
// =====================================================================
// Two things must be true at once, and they pull against each other:
//   * a message in Filipino, Taglish, or obfuscated spelling must still
//     be caught; and
//   * "this homework is killing me" must NOT page a support expert.
//
// So matching is layered rather than a single keyword list:
//   1. normalize()      — fold obfuscation (d1e, m4matay, diiiie, d i e)
//   2. FIGURATIVE guard — idioms that look violent but are not
//   3. category rules   — self-harm / active violence / threat / unsafe
//   4. reported-speech  — third-party disclosures still escalate, one
//                         level lower, because the subject is not the
//                         person typing
//
// Categories are returned alongside the level because the escalation
// path needs them: a self-harm disclosure and a "he has a knife"
// disclosure are both EMERGENCY but need different wording back.

import type { MessageRiskLevel } from './types.ts';

export type RiskCategory =
  | 'SELF_HARM'
  | 'ACTIVE_VIOLENCE'
  | 'THREAT_TO_LIFE'
  | 'UNSAFE'
  | 'DISTRESS'
  | null;

export interface SafetyClassification {
  level: MessageRiskLevel;
  category: RiskCategory;
  /** True when the danger is described as happening to someone else. */
  reported: boolean;
  /** Which rule fired, for audit metadata. Never contains message text. */
  rule: string | null;
}

// Digit/symbol substitutions, applied ONLY when the character sits
// against a letter. Guarded that way so ordinary numbers survive: "I
// have 2 kids" must not become "I have z kids", and "nasa 5 ako" must
// stay a number. "d1e" and "m4matay" do get folded, which is the point.
const LEET: Record<string, string> = { '1': 'i', '3': 'e', '4': 'a', '0': 'o', '5': 's', '7': 't', '@': 'a', '$': 's' };

export function normalize(text: string): string {
  let t = text.toLowerCase().replace(/['’`]/g, '');

  // Leet folding, letter-adjacent only.
  t = t.replace(/[13450 7@$]/g, (ch, idx: number) => {
    const mapped = LEET[ch];
    if (!mapped) return ch;
    const prev = t[idx - 1] ?? '';
    const next = t[idx + 1] ?? '';
    const touchesLetter = /[a-z]/.test(prev) || /[a-z]/.test(next);
    return touchesLetter ? mapped : ch;
  });

  t = t.replace(/[^a-z0-9\s]/g, ' ');

  // "d i e" / "k i l l" — single letters separated by spaces, three or
  // more in a row, rejoined. A real sentence almost never looks like
  // this; a deliberately spaced-out word always does.
  t = t.replace(/\b(?:[a-z]\s){2,}[a-z]\b/g, (run) => run.replace(/\s/g, ''));

  // "diiiie" -> "die". Runs of 3+ identical letters collapse to one;
  // genuine doubles (letter, happy) are left alone.
  t = t.replace(/([a-z])\1{2,}/g, '$1');

  // Contractions lose their apostrophe above, so "I'm" arrives as the
  // single token "im" and no /i\s+(am|m)/ pattern can match it. Expanded
  // here rather than patched into each rule: the same gap silently
  // affected "im scared", "im not safe" and "im being attacked".
  t = t.replace(/\bim\b/g, 'i am');

  return t.replace(/\s+/g, ' ').trim();
}

// Idioms that contain violent words but describe frustration. Checked
// FIRST and, on their own, short-circuit to NORMAL — otherwise every
// "this homework is killing me" becomes an expert request and the queue
// stops meaning anything.
const FIGURATIVE_PATTERNS: RegExp[] = [
  /\b(homework|assignment|thesis|work|job|exam|review(er)?|deadline|traffic|heat|diet|class|subject)\s+is\s+killing\s+me\b/,
  /\b(killing|kills)\s+me\b(?=.*\b(funny|laugh|lol|haha|joke|hilarious)\b)/,
  /\bdying\s+(of|from)\s+(laughter|boredom|hunger|kilig|excitement)\b/,
  /\bdead\s+tired\b/,
  /\bpatay\s+na\s+(ang\s+)?(baterya|battery|cellphone|phone|laptop|signal|ilaw)\b/,
  /\bnamamatay\s+(ang\s+)?(baterya|battery|signal|ilaw|phone)\b/,
];

// ---------------------------------------------------------------------
// SELF-HARM / SUICIDAL INTENT — absent entirely from the previous rules.
// English, Filipino and Taglish.
// ---------------------------------------------------------------------
const SELF_HARM_PATTERNS: RegExp[] = [
  // English. "wanna" already contains the "to", so it needs its own
  // pattern — /want|wanna\s+to\s+die/ never matches "i wanna die".
  /\bi\s+(want|wish|need)\s+to\s+die\b/,
  /\bi\s+wanna\s+die\b/,
  /\bi\s+(want|wanna)\s+to\s+(kill|hurt|harm)\s+my\s*self\b/,
  /\bi\s+wanna\s+(kill|hurt|harm)\s+my\s*self\b/,
  // Third person — a disclosure about someone else. Still self-harm,
  // graded down to URGENT by the reported-speech check below, because
  // the brief is explicit that "my friend said she wants to die" must
  // reach a human rather than be dismissed as not-first-person.
  /\b(he|she|they)\s+(wants?|wanted)\s+to\s+die\b/,
  /\b(he|she|they)\s+(wants?|wanted)\s+to\s+(kill|hurt|harm)\s+(him|her|them)\s*self\b/,
  /\b(he|she|they)\s+(is|are)\s+suicidal\b/,
  /\bi\s+(am|m)\s+going\s+to\s+(kill|end)\s+my\s*self\b/,
  /\bi\s+(will|ll)\s+(kill|end)\s+my\s*self\b/,
  /\bkill\s+my\s*self\b/,
  /\bend\s+(my\s+life|it\s+all)\b/,
  /\bi\s+(want|wanna)\s+to\s+end\s+(my\s+life|it\s+all)\b/,
  /\bi\s+dont\s+want\s+to\s+(live|be\s+alive)\b/,
  /\bno\s+reason\s+to\s+live\b/,
  /\bbetter\s+off\s+(dead|without\s+me)\b/,
  /\bi\s+(am|m)\s+going\s+to\s+die\b/,
  /\bsuicide\b/,
  /\bsuicidal\b/,
  // Filipino — "mamatay" (to die), "magpakamatay" (to kill oneself),
  // "magpatiwakal"/"mapatiwakal" (to commit suicide), "wakasan ang buhay".
  /\bmagpapakamatay\s+(na\s+)?ako\b/,
  /\bmagpakamatay\b/,
  /\bpakamatay\b/,
  /\bma?gpa?patiwakal\b/,
  /\bmapapatiwakal\b/,
  /\bpatiwakal\b/,
  /\bgusto\s+ko\s+(na|nang)?\s*mamatay\b/,
  /\bgusto\s+ko\s+na(ng)?\s+mawala\b/,
  /\bgusto\s+kong\s+mamatay\b/,
  /\bmamamatay\s+(na\s+)?ako\b/,
  /\bayoko\s+na(ng)?\s+mabuhay\b/,
  /\bwala\s+na\s+akong\s+(silbi|dahilan)\b/,
  /\bwakasan\s+ko\s+(ang\s+)?buhay\s+ko\b/,
  /\btatapusin\s+ko\s+(na\s+)?(ang\s+)?buhay\s+ko\b/,
  // Taglish
  /\bi\s+want\s+to\s+die\s+na\b/,
  /\bgusto\s+ko\s+na(ng)?\s+mag\s*end\b/,
];

// ---------------------------------------------------------------------
// ACTIVE VIOLENCE — happening now, to the person writing.
// ---------------------------------------------------------------------
const ACTIVE_VIOLENCE_PATTERNS: RegExp[] = [
  // English
  /\b(he|she|they)(\s+is|\s+are|s)?\s*(attacking|hurting|hitting|beating|choking|strangling|stabbing)\s+me\b/,
  /\bsomeone\s+is\s+(attacking|hurting|hitting|beating|choking|strangling|stabbing)\s+me\b/,
  /\bi\s+(am|m)\s+(being\s+)?(attacked|beaten|stabbed|strangled|choked|raped|assaulted)\b/,
  // Past tense. Graded to URGENT rather than EMERGENCY by the
  // past-tense check below — a disclosure of historical abuse still
  // needs a human, it just isn't an in-progress emergency.
  /\bi\s+(was|were|been)\s+(attacked|beaten|stabbed|strangled|choked|raped|assaulted|abused|hurt)\b/,
  /\bbeing\s+hurt\b/,
  /\bviolence\s+is\s+happening\s+(now|right\s+now)\b/,
  // Filipino — "sinasaktan" (being hurt), "binubugbog" (being beaten),
  // "pinapalo"/"pinagsasaktan", "ginagahasa" (being raped).
  /\bsinasaktan\s+(niya\s+)?(na\s+)?ako\b/,
  /\bsinasaktan\s+ako\b/,
  /\bsinasakta?n\b/,
  /\bbinubugbog\s+(niya\s+)?ako\b/,
  /\bbinubugbog\b/,
  /\bbinugbog\s+(niya\s+)?ako\b/,
  /\bpinapalo\s+(niya\s+)?ako\b/,
  /\bpinagsasaktan\b/,
  /\bginagahasa\b/,
  /\bninanakit\b/,
  /\bmay\s+(nananakit|nanakit|nanggugulo)\s+sa\s+akin\b/,
  /\bsaktan\s+niya\s+ako\b/,
];

// ---------------------------------------------------------------------
// THREAT TO LIFE — someone has said or shown they will kill/seriously
// harm. Distinct from SELF_HARM: "papatayin ako" is a threat FROM
// someone, "magpapakamatay ako" is self-harm. Conflating them would
// send the wrong safety message back.
// ---------------------------------------------------------------------
const THREAT_TO_LIFE_PATTERNS: RegExp[] = [
  /\b(he|she|they)(\s+is|s)?\s*going\s+to\s+kill\s+me\b/,
  /\b(he|she|they)\s+(will|ll)\s+kill\s+me\b/,
  /\b(he|she|they)\s+(said|says)\s+(he|she|they)\s+(will|would)\s+kill\s+me\b/,
  /\bthey\s+will\s+kill\s+me\b/,
  /\b(he|she|they)\s+has\s+a\s+(knife|gun|weapon|bolo|itak)\b/,
  /\bthreatened\s+to\s+kill\b/,
  // Filipino — "papatayin" (will be killed), "pinagbantaan" (threatened),
  // "may baril/kutsilyo siya" (he has a gun/knife).
  /\bpapatayin\s+(niya\s+)?ako\b/,
  /\bpapatayin\s+daw\s+(niya\s+)?ako\b/,
  /\bpapatayin\s+ako\b/,
  /\bpapatay(in)?\s+niya\b/,
  /\bbabarilin\s+(niya\s+)?ako\b/,
  /\bsasaksakin\s+(niya\s+)?ako\b/,
  /\bpinagbantaan\s+(niya\s+)?ako\b/,
  /\bbinabantaan\s+(niya\s+)?ako\b/,
  /\bmay\s+(baril|kutsilyo|itak|bolo|patalim)\s+(siya|sila)\b/,
  /\btinatakot\s+(niya\s+)?ako\b/,
];

// ---------------------------------------------------------------------
// UNSAFE — frightened, threatened, or unwilling to go home, without a
// statement that violence is happening at this moment.
// ---------------------------------------------------------------------
const UNSAFE_PATTERNS: RegExp[] = [
  // English
  /\bi\s+(am|m)\s+(scared|afraid|terrified|frightened)\b/,
  /\bi\s+(dont|do\s+not)\s+feel\s+safe\b/,
  /\bi\s+(am|m)\s+not\s+safe\b/,
  /\bnot\s+safe\s+(right\s+now|at\s+home|here)\b/,
  /\b(he|she|they)\s+(threatened|is\s+threatening|keeps\s+threatening)\s+me\b/,
  /\bi\s+(am|m)\s+being\s+threatened\b/,
  /\bsomeone\s+is\s+following\s+me\b/,
  /\b(he|she|they)(s|\s+is)?\s+going\s+to\s+hurt\s+me\b/,
  /\bafraid\s+to\s+go\s+home\b/,
  /\bscared\s+to\s+go\s+home\b/,
  /\bi\s+need\s+help\s+(now|right\s+now|immediately)\b/,
  // Filipino
  /\bhindi\s+ako\s+ligtas\b/,
  /\bdi\s+ako\s+ligtas\b/,
  /\bhindi\s+(ako\s+)?safe\b/,
  /\btakot\s+ako(ng)?\s+umuwi\b/,
  /\bnatakot\s+ako(ng)?\s+umuwi\b/,
  /\bnatatakot\s+ako(ng)?\s+umuwi\b/,
  /\bayoko\s+(na(ng)?\s+)?umuwi\b/,
  /\btakot\s+ako\s+(sa\s+kanya|sa\s+asawa|sa\s+tatay|sa\s+partner)\b/,
  /\bnatatakot\s+ako\b/,
  /\btumatakas\s+ako\b/,
  /\bkailangan\s+ko\s+ng\s+tulong\s+(ngayon|agad)\b/,
];

// Broad topical signals — a difficult subject with none of the
// specificity above. Worth a gentler reply and a visible route to a
// human, not an automatic escalation.
const DISTRESS_PATTERNS: RegExp[] = [
  /\babuse(d|r|ive)?\b/,
  /\bviolence\b/,
  /\bhurt(ing)?\b/,
  /\bthreat(en|ened|s)?\b/,
  /\bafraid\b/,
  /\bscared\b/,
  /\bunsafe\b/,
  /\bdanger(ous)?\b/,
  /\bdepress(ed|ion|ing)?\b/,
  /\bhopeless\b/,
  /\balone\b/,
  /\bhit\s+(me|us)\b/,
  // Bare death words, with none of the intent context the self-harm
  // rules require. Deliberately SUPPORT, not an escalation: a lone
  // "die" could be a bereavement, a typo, or a fragment, and auto-paging
  // an expert on a single keyword is exactly the over-escalation that
  // makes a queue worth ignoring. SUPPORT still surfaces the "talk to a
  // person" route, so a fragment is met with a human offer rather than
  // silence. (Obfuscated forms reach here too: "d1e" normalizes to
  // "die" before matching.)
  /\bdie\b/,
  /\bdying\b/,
  /\bmamatay\b/,
  /\bkamatayan\b/,
  /\bkarahasan\b/,
  /\bpang\s*aabuso\b/,
  /\bnalulungkot\b/,
  /\bmag\s*isa\s+ako\b/,
  /\bwalang\s+tumutulong\b/,
];

// Reported speech — the danger is described as happening to someone
// else, or in the past. These still escalate (the brief is explicit:
// "quoted statements, reported threats, and descriptions of past abuse
// must not be dismissed"), but one level down, because the person
// typing is not the one described as being in danger right now.
const REPORTED_SPEECH_PATTERNS: RegExp[] = [
  /\b(my|a)\s+(friend|sister|kapatid|kaibigan|neighbor|kapitbahay|cousin|pinsan|classmate|nanay|mother|tita|aunt)\b/,
  /\b(she|he|they)\s+(said|says|told\s+me|sabi)\b/,
  /\bsabi\s+(niya|nila)\b/,
  /\bkaibigan\s+ko\b/,
  /\bmay\s+kakilala\s+ako\b/,
];

const PAST_TENSE_PATTERNS: RegExp[] = [
  /\b(last|noong)\s+(year|month|week|taon|buwan|linggo)\b/,
  /\bwhen\s+i\s+was\s+(a\s+)?(child|kid|young|bata)\b/,
  /\bnoong\s+bata\s+ako\b/,
  /\bused\s+to\b/,
  /\bdati\b/,
];

function anyMatch(patterns: RegExp[], text: string): RegExp | null {
  for (const p of patterns) if (p.test(text)) return p;
  return null;
}

/**
 * Full classification. `classifyMessageRuleBased` below preserves the
 * original level-only signature for existing callers.
 */
export function classifyMessage(rawText: string): SafetyClassification {
  const text = normalize(rawText);
  const none: SafetyClassification = { level: 'NORMAL', category: null, reported: false, rule: null };
  if (!text) return none;

  const reported = anyMatch(REPORTED_SPEECH_PATTERNS, text) !== null;
  const past = anyMatch(PAST_TENSE_PATTERNS, text) !== null;

  // Severity order matters: a message containing both a self-harm
  // statement and a topical word must classify on the self-harm.
  const selfHarm = anyMatch(SELF_HARM_PATTERNS, text);
  const activeViolence = anyMatch(ACTIVE_VIOLENCE_PATTERNS, text);
  const threat = anyMatch(THREAT_TO_LIFE_PATTERNS, text);
  const unsafe = anyMatch(UNSAFE_PATTERNS, text);

  const hasSevere = selfHarm || activeViolence || threat;

  // The figurative guard only applies when NOTHING severe matched.
  // "this homework is killing me" is an idiom; "he is hurting me, this
  // is killing me" is a disclosure that happens to contain an idiom,
  // and must not be downgraded by it.
  if (!hasSevere && !unsafe && anyMatch(FIGURATIVE_PATTERNS, text)) {
    return none;
  }

  if (selfHarm) {
    // Reported self-harm ("my friend said she wants to die") still
    // escalates — it is a disclosure needing a human — but at URGENT,
    // since the person typing is not the one at risk.
    return {
      level: reported ? 'URGENT' : 'EMERGENCY',
      category: 'SELF_HARM',
      reported,
      rule: `self_harm:${selfHarm.source.slice(0, 40)}`,
    };
  }

  if (activeViolence) {
    // Past-tense disclosure of abuse is support-worthy, not an
    // in-progress emergency.
    const level: MessageRiskLevel = past ? 'URGENT' : reported ? 'URGENT' : 'EMERGENCY';
    return { level, category: 'ACTIVE_VIOLENCE', reported, rule: `active_violence:${activeViolence.source.slice(0, 40)}` };
  }

  if (threat) {
    return {
      level: reported ? 'URGENT' : 'EMERGENCY',
      category: 'THREAT_TO_LIFE',
      reported,
      rule: `threat:${threat.source.slice(0, 40)}`,
    };
  }

  if (unsafe) {
    return { level: 'URGENT', category: 'UNSAFE', reported, rule: `unsafe:${unsafe.source.slice(0, 40)}` };
  }

  const distress = anyMatch(DISTRESS_PATTERNS, text);
  if (distress) {
    return { level: 'SUPPORT', category: 'DISTRESS', reported, rule: `distress:${distress.source.slice(0, 40)}` };
  }

  return none;
}

/** Level-only wrapper — preserves the original exported signature. */
export function classifyMessageRuleBased(rawText: string): MessageRiskLevel {
  return classifyMessage(rawText).level;
}

const RISK_RANK: Record<MessageRiskLevel, number> = { NORMAL: 0, SUPPORT: 1, URGENT: 2, EMERGENCY: 3 };

// The rule engine is deterministic and trusted; the AI's own classification
// is probabilistic and only ever allowed to escalate, never downgrade, the
// rule engine's read of the same message.
export function maxRiskLevel(a: MessageRiskLevel, b: MessageRiskLevel): MessageRiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

/** URGENT and EMERGENCY are the levels that trigger an automatic expert handoff. */
export function requiresExpertHandoff(level: MessageRiskLevel): boolean {
  return RISK_RANK[level] >= RISK_RANK.URGENT;
}

/** Maps a risk level onto the existing support_priority enum (NORMAL/HIGH/URGENT). */
export function priorityForLevel(level: MessageRiskLevel): 'NORMAL' | 'HIGH' | 'URGENT' {
  if (level === 'EMERGENCY') return 'URGENT';
  if (level === 'URGENT') return 'HIGH';
  return 'NORMAL';
}
