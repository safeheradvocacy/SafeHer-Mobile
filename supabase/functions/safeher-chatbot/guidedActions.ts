// Guided assistance — intent detection that doesn't need an AI call at
// all. Runs after FAQ matching, before falling through to the AI
// provider. CASE_STATUS_INTENT deliberately never answers with a
// fabricated status — it only ever points at the real Track My Cases
// feature, since the AI must never invent database information.

import {
  CASE_TRACKING_ACTION,
  EXPERT_ACTION,
  REPORT_ACTION,
  SHELTER_ACTION,
  SHELTER_REQUEST_ACTION,
  SOS_ACTION,
  type SafeHerAction,
} from './types.ts';

export interface GuidedMatch {
  reply: string;
  actions: SafeHerAction[];
}

function normalize(text: string): string {
  return text.toLowerCase();
}

const SHELTER_INTENT = /somewhere safe|need shelter|need a shelter|nowhere to go|no place to stay|need a place to stay/;
const REPORT_INTENT = /report (what happened|this|an incident|him|her|them)|file a (report|complaint)|want to report/;
const CASE_STATUS_INTENT = /where is my case|case status|status of my (case|report)|track my case|what happened to my (case|report)/;

export function detectGuidedIntent(rawText: string): GuidedMatch | null {
  const text = normalize(rawText);

  if (CASE_STATUS_INTENT.test(text)) {
    return {
      reply:
        "I can't look up your case details directly here, so I won't guess — Track My Cases shows your real, up-to-date status. I can take you there now.",
      actions: [CASE_TRACKING_ACTION, EXPERT_ACTION],
    };
  }

  if (SHELTER_INTENT.test(text)) {
    return {
      reply:
        'I can help you find a safe place. You can browse nearby SafeSpace shelters, or send a direct request and a shelter will follow up with you.',
      actions: [SHELTER_ACTION, SHELTER_REQUEST_ACTION, EXPERT_ACTION],
    };
  }

  if (REPORT_INTENT.test(text)) {
    return {
      reply:
        "You can submit a confidential incident report — an anonymous option is available too. If you're in immediate danger, please use Emergency SOS instead.",
      actions: [REPORT_ACTION, SOS_ACTION, EXPERT_ACTION],
    };
  }

  return null;
}
