// Runnable assertions for the rule-based safety classifier.
//
//   npx --yes deno@2.1.4 test --allow-read supabase/functions/safeher-chatbot/safety.test.ts
//
// Every phrase the governing brief names is asserted here, in English,
// Filipino and Taglish, alongside the false-positive guards. The guards
// matter as much as the detections: a classifier that escalates
// "this homework is killing me" trains experts to ignore the queue,
// which costs more lives than it saves.
//
// These run offline — no Supabase, no Groq, no network. That is the
// point: this layer must keep working when the AI provider does not.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { classifyMessage, normalize, priorityForLevel, requiresExpertHandoff } from './safety.ts';

function expectLevel(message: string, level: string, note?: string) {
  const got = classifyMessage(message);
  assertEquals(
    got.level,
    level,
    `"${message}" -> expected ${level}, got ${got.level} (category=${got.category}, rule=${got.rule})${note ? ` — ${note}` : ''}`
  );
}

function expectCategory(message: string, category: string) {
  const got = classifyMessage(message);
  assertEquals(got.category, category, `"${message}" -> expected category ${category}, got ${got.category}`);
}

// ---------------------------------------------------------------------
// Self-harm / suicidal intent — entirely absent from the previous rules.
// ---------------------------------------------------------------------
Deno.test('self-harm: English', () => {
  expectLevel('I want to die', 'EMERGENCY');
  expectLevel('i wanna die', 'EMERGENCY');
  expectLevel('I want to kill myself', 'EMERGENCY');
  expectLevel('I am going to kill myself', 'EMERGENCY');
  expectLevel("I'm going to die", 'EMERGENCY');
  expectLevel('I dont want to live anymore', 'EMERGENCY');
  expectLevel('there is no reason to live', 'EMERGENCY');
  expectLevel('everyone is better off without me', 'EMERGENCY');
  expectLevel('I want to end my life', 'EMERGENCY');
  expectCategory('I want to die', 'SELF_HARM');
});

Deno.test('self-harm: Filipino', () => {
  expectLevel('Mamamatay ako', 'EMERGENCY');
  expectLevel('Gusto ko nang mamatay', 'EMERGENCY');
  expectLevel('Gusto kong mamatay', 'EMERGENCY');
  expectLevel('Magpapakamatay ako', 'EMERGENCY');
  expectLevel('Mapapatiwakal ako', 'EMERGENCY');
  expectLevel('ayoko nang mabuhay', 'EMERGENCY');
  expectLevel('tatapusin ko na ang buhay ko', 'EMERGENCY');
  expectCategory('Magpapakamatay ako', 'SELF_HARM');
});

Deno.test('self-harm: Taglish', () => {
  expectLevel('I want to die na', 'EMERGENCY');
  expectLevel('gusto ko na mag end', 'EMERGENCY');
});

// ---------------------------------------------------------------------
// Obfuscation — the brief requires d1e / m4matay style variants.
// ---------------------------------------------------------------------
Deno.test('obfuscation: leetspeak, repeats and spacing', () => {
  expectLevel('i want to d1e', 'EMERGENCY', 'leetspeak 1->i');
  expectLevel('i want to diiiie', 'EMERGENCY', 'repeated characters');
  expectLevel('i want to d i e', 'EMERGENCY', 'spaced-out letters');
  expectLevel('m4gp4p4k4m4t4y ako', 'EMERGENCY', 'leetspeak 4->a');
  expectLevel('k1ll myself', 'EMERGENCY');
});

Deno.test('obfuscation: ordinary numbers survive normalization', () => {
  // The leet fold is letter-adjacent only, so counts stay counts.
  assertEquals(normalize('I have 2 kids'), 'i have 2 kids');
  assertEquals(normalize('nasa 5 ako'), 'nasa 5 ako');
});

// ---------------------------------------------------------------------
// Active violence.
// ---------------------------------------------------------------------
Deno.test('active violence: English and Filipino', () => {
  expectLevel('He is hurting me', 'EMERGENCY');
  expectLevel('someone is hurting me', 'EMERGENCY');
  expectLevel('I am being hurt', 'EMERGENCY');
  expectLevel('Sinasaktan ako', 'EMERGENCY');
  expectLevel('Sinasaktan niya ako', 'EMERGENCY');
  expectLevel('Binubugbog niya ako', 'EMERGENCY');
  expectLevel('May nananakit sa akin', 'EMERGENCY');
  expectCategory('Sinasaktan niya ako', 'ACTIVE_VIOLENCE');
});

// ---------------------------------------------------------------------
// Threat to life — distinct from self-harm. "papatayin ako" is someone
// threatening the user; "magpapakamatay ako" is the user. Same severity,
// different safety response.
// ---------------------------------------------------------------------
Deno.test('threat to life: English and Filipino', () => {
  expectLevel('They will kill me', 'EMERGENCY');
  expectLevel('he is going to kill me', 'EMERGENCY');
  expectLevel('he has a knife', 'EMERGENCY');
  expectLevel('Papatayin niya ako', 'EMERGENCY');
  expectLevel('Papatayin ako', 'EMERGENCY');
  expectLevel('Papatayin daw niya ako', 'EMERGENCY');
  expectLevel('may baril siya', 'EMERGENCY');
  expectCategory('Papatayin niya ako', 'THREAT_TO_LIFE');
});

Deno.test('threat and self-harm are not conflated', () => {
  expectCategory('Papatayin niya ako', 'THREAT_TO_LIFE');
  expectCategory('Magpapakamatay ako', 'SELF_HARM');
});

// ---------------------------------------------------------------------
// Unsafe.
// ---------------------------------------------------------------------
Deno.test('unsafe: English, Filipino, Taglish', () => {
  expectLevel('I am not safe', 'URGENT');
  expectLevel('Hindi ako ligtas', 'URGENT');
  expectLevel('Natakot akong umuwi', 'URGENT');
  expectLevel('takot ako umuwi', 'URGENT');
  expectLevel('I am afraid to go home', 'URGENT');
  expectLevel('he threatened me', 'URGENT');
  expectLevel('I am scared, sinasaktan niya ako', 'EMERGENCY', 'severe match wins over the milder one');
});

// ---------------------------------------------------------------------
// Reported speech — must escalate, one level down.
// ---------------------------------------------------------------------
Deno.test('reported: third-party disclosures still escalate', () => {
  const got = classifyMessage('My friend said she wants to die');
  assertEquals(got.level, 'URGENT', 'a reported suicide disclosure must still reach a human');
  assertEquals(got.category, 'SELF_HARM');
  assertEquals(got.reported, true);

  expectLevel('kaibigan ko sinasaktan ng asawa niya', 'URGENT');
});

Deno.test('past-tense abuse is supported, not treated as in-progress', () => {
  const got = classifyMessage('I was beaten when I was a child');
  assertEquals(got.level, 'URGENT', 'still needs a human, but not an active-emergency response');
});

// ---------------------------------------------------------------------
// FALSE POSITIVES — these must NOT escalate.
// ---------------------------------------------------------------------
Deno.test('figurative language does not escalate', () => {
  expectLevel('This homework is killing me', 'NORMAL');
  expectLevel('this thesis is killing me', 'NORMAL');
  expectLevel('traffic is killing me', 'NORMAL');
  expectLevel('dead tired na ako', 'NORMAL');
  expectLevel('patay na ang baterya ko', 'NORMAL');
  expectLevel('namamatay ang signal dito', 'NORMAL');
});

Deno.test('"depressed" alone is SUPPORT, never an emergency', () => {
  // The brief calls this out specifically: context decides, and a bare
  // mention is not an immediate danger.
  expectLevel('I was depressed last year', 'SUPPORT');
  expectLevel('I feel depressed', 'SUPPORT');
  expectLevel('nalulungkot ako', 'SUPPORT');
});

Deno.test('ordinary messages stay NORMAL', () => {
  expectLevel('How do I report an incident?', 'NORMAL');
  expectLevel('Saan ang pinakamalapit na shelter?', 'NORMAL');
  expectLevel('thank you po', 'NORMAL');
  expectLevel('what is safespace', 'NORMAL');
});

// ---------------------------------------------------------------------
// Escalation mapping.
// ---------------------------------------------------------------------
Deno.test('handoff threshold and priority mapping', () => {
  assertEquals(requiresExpertHandoff('EMERGENCY'), true);
  assertEquals(requiresExpertHandoff('URGENT'), true);
  assertEquals(requiresExpertHandoff('SUPPORT'), false, 'SUPPORT offers a human, it does not auto-escalate');
  assertEquals(requiresExpertHandoff('NORMAL'), false);

  assertEquals(priorityForLevel('EMERGENCY'), 'URGENT');
  assertEquals(priorityForLevel('URGENT'), 'HIGH');
  assertEquals(priorityForLevel('SUPPORT'), 'NORMAL');
});

Deno.test('classification rule never leaks message text', () => {
  // `rule` is persisted as escalation metadata, so it must identify the
  // pattern, never quote what the user wrote.
  const got = classifyMessage('Magpapakamatay ako dahil kay Juan');
  assertEquals(got.rule?.includes('Juan'), false);
  assertEquals(got.rule?.startsWith('self_harm:'), true);
});
