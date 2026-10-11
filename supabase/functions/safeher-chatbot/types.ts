// Shared types for the safeher-chatbot Edge Function. Kept dependency-free
// (no imports from mobile/admin) since Edge Functions bundle in isolation.

export type MessageRiskLevel = 'NORMAL' | 'SUPPORT' | 'URGENT' | 'EMERGENCY';

// The ONLY actions the AI (or any other layer) may ever return. Never
// execute arbitrary AI-generated text as an action — everything the
// server hands back is checked against this exact list, and the mobile
// client re-validates against its own matching allowlist before
// navigating anywhere.
export const ALLOWED_ACTION_TYPES = [
  'OPEN_INCIDENT_REPORT',
  'OPEN_CASE_TRACKING',
  'OPEN_SHELTER_LOCATOR',
  'OPEN_SHELTER_REQUEST',
  'OPEN_EMERGENCY_SOS',
  'REQUEST_EXPERT_HELP',
] as const;
export type ActionType = (typeof ALLOWED_ACTION_TYPES)[number];

export interface SafeHerAction {
  type: ActionType;
  label: string;
}

export function isAllowedActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && (ALLOWED_ACTION_TYPES as readonly string[]).includes(value);
}

// What the function returns to the client. `source` tells the client
// which layer produced the reply — purely informational, never exposed
// as raw internal reasoning.
export interface ChatbotResponse {
  reply: string;
  senderType: 'AI' | 'System';
  source: 'faq' | 'guided' | 'ai' | 'safety' | 'unavailable';
  riskLevel: MessageRiskLevel;
  actions: SafeHerAction[];
  needsHumanSupport: boolean;
  messageId: string | null;
}

export const EXPERT_ACTION: SafeHerAction = { type: 'REQUEST_EXPERT_HELP', label: 'Talk to an Expert' };
export const SOS_ACTION: SafeHerAction = { type: 'OPEN_EMERGENCY_SOS', label: 'Emergency SOS' };
export const SHELTER_ACTION: SafeHerAction = { type: 'OPEN_SHELTER_LOCATOR', label: 'Find Shelter' };
export const SHELTER_REQUEST_ACTION: SafeHerAction = { type: 'OPEN_SHELTER_REQUEST', label: 'Request Shelter' };
export const REPORT_ACTION: SafeHerAction = { type: 'OPEN_INCIDENT_REPORT', label: 'Report an Incident' };
export const CASE_TRACKING_ACTION: SafeHerAction = { type: 'OPEN_CASE_TRACKING', label: 'Track My Case' };

export const ACTION_LOOKUP: Record<ActionType, SafeHerAction> = {
  OPEN_INCIDENT_REPORT: REPORT_ACTION,
  OPEN_CASE_TRACKING: CASE_TRACKING_ACTION,
  OPEN_SHELTER_LOCATOR: SHELTER_ACTION,
  OPEN_SHELTER_REQUEST: SHELTER_REQUEST_ACTION,
  OPEN_EMERGENCY_SOS: SOS_ACTION,
  REQUEST_EXPERT_HELP: EXPERT_ACTION,
};
