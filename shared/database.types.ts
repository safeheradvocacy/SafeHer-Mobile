/**
 * SafeHer — Canonical Database Types
 * ------------------------------------------------------------------
 * Generated directly from the SafeHer ERD. This file is the SINGLE
 * SOURCE OF TRUTH for the shape of every table in the existing
 * Supabase project. It is copied verbatim (byte-for-byte) into both
 * `mobile/src/types/database.types.ts` and `admin/src/types/database.types.ts`.
 *
 * DO NOT hand-edit the copies independently — if the real schema
 * changes, regenerate here first, then re-copy. This is what
 * guarantees the mobile app and both admin dashboards can never
 * drift into conflicting assumptions about column names, enums, or
 * foreign keys.
 *
 * Table list (20 total — matches supabase/00_schema.sql plus the
 * Phase 1 barangay hierarchy (module3), shelter_admin + direct survivor
 * requests (module4), SOS location accuracy (module5), and the AI
 * support assistant / FAQ / expert handoff system (module6):
 *   municipalities, barangays, user_profiles, survivors, shelters,
 *   case_reports, case_assignments, case_status_history, case_referrals,
 *   shelter_referrals, shelter_requests, evidence, sos_alerts, notifications,
 *   chat_sessions, chat_messages, expert_support_requests, faqs, audit_logs
 *   (+ auth.users, managed by Supabase Auth)
 * ------------------------------------------------------------------
 */

// ---------- ENUMS (must match the Postgres ENUM types exactly) ----------

// 'super_admin' is RETIRED (2026-09-08 RBAC finalization) — confirmed
// 100% functionally identical to 'provincial_admin' in every RLS
// policy and authorization check in this codebase. It is kept here
// (never removed from the type or the live Postgres enum) purely for
// backward compatibility with any pre-existing account; it is no
// longer offered anywhere as a creatable role. Use 'provincial_admin'.
//
// 'provincial_staff' (2026-09-10 RBAC separation, module11) is a new,
// genuinely distinct role — NOT a synonym for provincial_admin. It
// carries the same province-wide OPERATIONAL database access
// provincial_admin has (case/SOS/shelter/verification/municipality/
// barangay work — see is_provincial_admin() in module11), while
// provincial_admin itself is redefined as technical/system
// administration (administrator accounts, audit trail, permission
// model) — see module11_provincial_staff_rbac.sql.
export type UserRole =
  | 'survivor'
  | 'municipal_admin'
  | 'provincial_admin'
  | 'super_admin'
  | 'barangay_admin'
  | 'shelter_admin'
  | 'shelter_staff'
  | 'support_expert'
  | 'law_enforcement'
  | 'provincial_staff';

// Which organizational tier currently owns/is actively handling a case.
// Deliberately separate from CaseStatus — 'Referred' status already means
// "referred to a shelter" (see ShelterReferral) and would collide if
// reused here. Admin UI displays 'Municipality' as "MSWDO" and
// 'Province' as "PSWDO" — there's no separate provinces table, "Province"
// just means "escalated to the provincial tier".
export type CaseOwnerLevel = 'Barangay' | 'Municipality' | 'Province';

export type Gender = 'Male' | 'Female' | 'Other';

export type CaseType =
  | 'Physical Abuse'
  | 'Psychological Abuse'
  | 'Sexual Abuse'
  | 'Economic Abuse'
  | 'Neglect'
  | 'Others';

export type PriorityLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type CaseStatus =
  | 'Pending'
  | 'Under Review'
  | 'Assigned'
  | 'In Progress'
  | 'Referred'
  | 'Resolved'
  | 'Closed';

export type ReferralStatus = 'Pending' | 'Accepted' | 'Declined' | 'Completed';

// Status for a direct survivor shelter request (ShelterRequest) — a
// deliberately separate, richer enum from ReferralStatus: "accepted" and
// "the survivor is physically at the shelter" must never be conflated,
// which ReferralStatus's 4 states can't express.
export type ShelterRequestStatus =
  | 'Submitted'
  | 'Under Review'
  | 'Awaiting Information'
  | 'Accepted'
  | 'Declined'
  | 'Cancelled'
  | 'Placement Confirmed'
  | 'Completed';

export type ShelterRequestUrgency = 'Standard' | 'Urgent' | 'Emergency';

export type SosStatus = 'Triggered' | 'Responding' | 'Resolved';
// CURRENT = a fresh GPS/network fix taken for this alert; LAST_KNOWN = the
// device's cached last position, clearly labeled as such rather than
// pretending it's current; UNAVAILABLE = no location could be obtained,
// but the alert was still sent.
export type SosLocationSource = 'CURRENT' | 'LAST_KNOWN' | 'UNAVAILABLE';

// 'Support' and 'Verification' both correct pre-existing drift/additions
// against the live Postgres enum (module6_ai_support.sql added 'Support',
// module10_identity_verification.sql added 'Verification' — this union
// had fallen behind on the former until now).
export type NotificationType = 'Case Update' | 'SOS' | 'Assignment' | 'Referral' | 'Announcement' | 'Support' | 'Verification';

// Overall identity-verification state on a profile — 4 values, includes
// 'unverified' for "never submitted anything". Mirrored from the latest
// UserVerification row by a DB trigger (module10) — never client-writable.
export type IdentityVerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

// Per-submission status on a single UserVerification row — 3 values
// (a row only ever exists once a submission has happened, so there is
// no 'unverified' row state, unlike IdentityVerificationStatus above).
export type VerificationStatus = 'pending' | 'verified' | 'rejected';

// HOW a location (registered address or incident location) was
// captured — distinct from SosLocationSource above, which is about
// GPS-fix freshness/accuracy, not the capture method. 'manually_confirmed'
// covers a location resolved from structured municipality/barangay
// selection without ever opening the map picker.
export type AddressLocationSource = 'map_pin' | 'current_location' | 'manually_confirmed';

export type ChatSenderType = 'User' | 'AI' | 'Expert' | 'System';

// Shared by ChatSession.status AND ExpertSupportRequest.status — a
// request's lifecycle and its linked conversation's lifecycle are the
// same lifecycle viewed from two tables (kept in sync server-side by
// sync_chat_session_from_request(), see module6_ai_support.sql).
export type ChatSessionStatus = 'AI_ASSISTED' | 'WAITING_FOR_EXPERT' | 'EXPERT_ASSIGNED' | 'EXPERT_ACTIVE' | 'CLOSED';
export type ChatMode = 'AI' | 'HUMAN';
export type SupportPriority = 'NORMAL' | 'HIGH' | 'URGENT';
// A conservative, message-level safety read — never an official
// emergency determination (that's still only ever the survivor's own
// action via the existing sos_alerts/Emergency SOS flow).
export type MessageRiskLevel = 'NORMAL' | 'SUPPORT' | 'URGENT' | 'EMERGENCY';

// Admin-UI transition map, same convention as SOS_STATUS_FLOW below.
export const CHAT_SESSION_STATUS_FLOW: Record<ChatSessionStatus, ChatSessionStatus[]> = {
  AI_ASSISTED: [],
  WAITING_FOR_EXPERT: ['EXPERT_ASSIGNED'],
  EXPERT_ASSIGNED: ['EXPERT_ACTIVE', 'CLOSED'],
  EXPERT_ACTIVE: ['CLOSED'],
  CLOSED: [],
};

// Valid forward transitions — used by both apps so status changes can
// never be written that the ERD / UI don't agree on.
export const CASE_STATUS_FLOW: Record<CaseStatus, CaseStatus[]> = {
  'Pending': ['Under Review'],
  'Under Review': ['Assigned', 'Referred'],
  'Assigned': ['In Progress'],
  'In Progress': ['Referred', 'Resolved'],
  'Referred': ['In Progress', 'Resolved'],
  'Resolved': ['Closed'],
  'Closed': [],
};

export const REFERRAL_STATUS_FLOW: Record<ReferralStatus, ReferralStatus[]> = {
  Pending: ['Accepted', 'Declined'],
  Accepted: ['Completed'],
  Declined: [],
  Completed: [],
};

// Mirrors the brief's own recommended flow: Submitted -> Under Review ->
// Accepted -> Placement Confirmed -> Completed, with Declined/Cancelled as
// terminal off-ramps and Awaiting Information as a detour back to review.
export const SHELTER_REQUEST_STATUS_FLOW: Record<ShelterRequestStatus, ShelterRequestStatus[]> = {
  Submitted: ['Under Review', 'Declined', 'Cancelled'],
  'Under Review': ['Awaiting Information', 'Accepted', 'Declined', 'Cancelled'],
  'Awaiting Information': ['Under Review', 'Declined', 'Cancelled'],
  Accepted: ['Placement Confirmed', 'Cancelled'],
  Declined: [],
  Cancelled: [],
  'Placement Confirmed': ['Completed'],
  Completed: [],
};

export const SOS_STATUS_FLOW: Record<SosStatus, SosStatus[]> = {
  Triggered: ['Responding'],
  Responding: ['Resolved'],
  Resolved: [],
};

// ---------- TABLES ----------

export interface Municipality {
  municipality_id: string; // uuid, PK
  municipality_name: string; // unique
  province: string;
  contact_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Barangay {
  barangay_id: string; // uuid, PK
  municipality_id: string; // FK -> municipalities.municipality_id
  barangay_name: string; // unique per municipality
  contact_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  profile_id: string; // uuid, PK
  auth_user_id: string; // FK -> auth.users.id, 1:1
  municipality_id: string | null; // FK -> municipalities.municipality_id
  barangay_id: string | null; // FK -> barangays.barangay_id, set only for barangay_admin
  shelter_id: string | null; // FK -> shelters.shelter_id, set only for shelter_admin
  role: UserRole;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  phone_number: string | null;
  profile_picture: string | null;
  is_active: boolean;
  // Confirms control of the phone number — flipped to true only by a
  // successful supabase.auth.verifyOtp({type:'sms'}) call client-side,
  // never merely because the number passed format validation.
  phone_verified: boolean;
  // Identity verification — the sole gate on incident-report submission
  // (see CaseReport RLS). Kept deliberately separate from email/phone
  // verification (see module10_identity_verification.sql header notes).
  identity_verification_status: IdentityVerificationStatus;
  created_at: string;
  updated_at: string;
}

// Registered-address fields (module12) — deliberately live here, not on
// UserProfile, which has its own unrelated municipality_id/barangay_id
// meaning (admin jurisdiction assignment). `address` is the existing
// column, reinterpreted as the street/house-number line. Every new
// field is nullable — the map-pin step is optional at registration, so
// a survivor may have a structured municipality/barangay/street with no
// coordinates yet.
export interface Survivor {
  survivor_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id, unique (1:1)
  municipality_id: string; // FK -> municipalities.municipality_id — self-editable (module12)
  barangay_id: string | null; // FK -> barangays.barangay_id
  date_of_birth: string | null;
  gender: Gender | null;
  address: string | null; // street / house number
  purok_sitio: string | null;
  latitude: number | null;
  longitude: number | null;
  formatted_address: string | null; // reverse-geocoded or map-confirmed display address
  location_source: AddressLocationSource | null;
  address_updated_at: string | null;
  emergency_contact_name: string | null;
  emergency_contact_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shelter {
  shelter_id: string; // uuid, PK
  municipality_id: string; // FK -> municipalities.municipality_id
  shelter_name: string;
  address: string;
  contact_number: string | null;
  email: string | null;
  capacity: number;
  current_occupancy: number;
  services_available: string | null; // free text, e.g. "Counseling, Childcare, Medical"
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CaseReport {
  case_id: string; // uuid, PK
  survivor_id: string; // FK -> survivors.survivor_id
  municipality_id: string; // FK -> municipalities.municipality_id — permanent geographic anchor, never changes as a case escalates
  case_number: string; // unique
  case_type: CaseType;
  description: string;
  incident_date: string;
  incident_location: string;
  priority_level: PriorityLevel;
  status: CaseStatus;
  is_anonymous: boolean;
  owner_level: CaseOwnerLevel; // which tier currently owns/handles this case — changes only via CaseReferral inserts
  owner_barangay_id: string | null; // FK -> barangays.barangay_id, set only when owner_level === 'Barangay' — case ROUTING owner, unrelated to incident_barangay_id below
  // Incident location (module12) — set once at report submission,
  // never updated afterward (no UPDATE grant exists for these columns
  // at the database level — editing a profile address later can never
  // rewrite a past incident's recorded location). Purely descriptive/
  // display fields; municipality_id above still drives case routing/
  // jurisdiction and is untouched by these.
  incident_barangay_id: string | null; // FK -> barangays.barangay_id — WHERE it happened, not who currently owns the case
  incident_latitude: number | null;
  incident_longitude: number | null;
  incident_formatted_address: string | null;
  incident_location_source: AddressLocationSource | null;
  reported_at: string;
  updated_at: string;
}

export interface CaseReferral {
  referral_id: string; // uuid, PK
  case_id: string; // FK -> case_reports.case_id
  from_level: CaseOwnerLevel;
  from_barangay_id: string | null; // set iff from_level === 'Barangay'
  to_level: CaseOwnerLevel;
  to_barangay_id: string | null; // set iff to_level === 'Barangay'
  referred_by: string; // FK -> user_profiles.profile_id
  reason: string | null;
  status: ReferralStatus; // Phase 1 always 'Completed' — immediate transfer, no accept/reject step yet
  responded_by: string | null; // unused in Phase 1, reserved for a future accept/reject workflow
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseAssignment {
  assignment_id: string; // uuid, PK
  case_id: string; // FK -> case_reports.case_id
  assigned_by: string; // FK -> user_profiles.profile_id
  assigned_to: string; // FK -> user_profiles.profile_id
  assignment_notes: string | null;
  assigned_at: string;
  updated_at: string;
}

export interface CaseStatusHistory {
  history_id: string; // uuid, PK
  case_id: string; // FK -> case_reports.case_id
  changed_by: string; // FK -> user_profiles.profile_id
  previous_status: string | null;
  new_status: string;
  remarks: string | null;
  changed_at: string;
}

export interface ShelterReferral {
  referral_id: string; // uuid, PK
  case_id: string; // FK -> case_reports.case_id
  shelter_id: string; // FK -> shelters.shelter_id
  referred_by: string; // FK -> user_profiles.profile_id
  referral_status: ReferralStatus;
  notes: string | null;
  assigned_staff_id: string | null; // FK -> user_profiles.profile_id (shelter_staff), settable only by shelter_admin
  referred_at: string;
  updated_at: string;
}

// A survivor's DIRECT shelter request — deliberately a separate table from
// ShelterReferral (agency-initiated, always tied to a case). This path
// never requires an existing case; case_id is nullable and reserved for a
// future escalation flow, unused by any code today. No precise lat/lng —
// municipality_id is the survivor's general area only, never their exact
// device location. contact_name/contact_preference are survivor-chosen
// (defaulted from their own profile client-side, but editable) rather
// than the shelter_admin getting any automatic read access to the
// survivor's registered profile — this is deliberate data minimization
// enforced at the schema level, not just in the UI.
export interface ShelterRequest {
  request_id: string; // uuid, PK
  shelter_id: string; // FK -> shelters.shelter_id
  profile_id: string; // FK -> user_profiles.profile_id — the requesting survivor
  case_id: string | null; // FK -> case_reports.case_id, reserved for future escalation
  status: ShelterRequestStatus;
  urgency: ShelterRequestUrgency;
  people_count: number;
  children_count: number;
  municipality_id: string | null; // FK -> municipalities.municipality_id — general area only
  contact_name: string;
  contact_preference: string | null;
  message: string | null;
  reviewed_by: string | null; // FK -> user_profiles.profile_id (the shelter_admin who reviewed it)
  reviewed_at: string | null;
  review_notes: string | null;
  assigned_staff_id: string | null; // FK -> user_profiles.profile_id (shelter_staff), settable only by shelter_admin
  created_at: string;
  updated_at: string;
}

export interface Evidence {
  evidence_id: string; // uuid, PK
  case_id: string; // FK -> case_reports.case_id
  uploaded_by: string; // FK -> user_profiles.profile_id
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
}

export interface SosAlert {
  sos_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id
  latitude: number | null;
  longitude: number | null;
  location_address: string | null;
  location_accuracy: number | null; // meters
  location_timestamp: string | null; // when this fix was taken, distinct from triggered_at
  location_source: SosLocationSource;
  status: SosStatus;
  triggered_at: string;
  resolved_at: string | null;
}

export interface Notification {
  notification_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id
  case_id: string | null; // FK -> case_reports.case_id
  sos_id: string | null; // FK -> sos_alerts.sos_id
  notification_type: NotificationType;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  // Set only by the send-push-notification Edge Function's service-role
  // client (module8_notifications_push.sql) — never authenticated-
  // writable. null means push was never attempted (either this
  // notification_type isn't high-priority, or push dispatch isn't
  // configured on this database yet).
  push_dispatched_at: string | null;
  push_delivery_status: 'sent' | 'no_recipients' | 'error' | null;
}

// One row per (profile, device) — a user may be signed in on more than
// one device, and logging out on one must never deactivate another's
// registration. Only ever readable/writable by the owning profile via
// RLS; send-push-notification reads across profiles using the service
// role key, never the client.
export interface PushToken {
  token_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id
  expo_push_token: string;
  platform: string; // 'ios' | 'android' | 'unknown'
  is_active: boolean; // set false once Expo reports DeviceNotRegistered
  last_seen_at: string;
  created_at: string;
}

// Assignment/referral-scoped: becomes visible to assigned_officer_id
// only once a case-management admin explicitly sets it (never
// self-assigned by law_enforcement — mirrors ShelterRequest/
// ShelterReferral's assigned_staff_id precedent). Exactly one of
// case_id/sos_id is populated (enforced by a DB CHECK constraint).
// status reuses ReferralStatus rather than a new enum; action_notes is
// deliberately free text — no authoritative law-enforcement action
// taxonomy exists in this codebase to draw a constrained type from.
export interface LawEnforcementReferral {
  referral_id: string; // uuid, PK
  case_id: string | null; // FK -> case_reports.case_id
  sos_id: string | null; // FK -> sos_alerts.sos_id
  referred_by: string; // FK -> user_profiles.profile_id (the referring case-admin)
  assigned_officer_id: string | null; // FK -> user_profiles.profile_id (law_enforcement), settable only by the case-admin chain
  status: ReferralStatus;
  reason: string | null;
  action_notes: string | null; // settable only by the assigned officer
  action_taken_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  session_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id
  started_at: string;
  ended_at: string | null; // set when status becomes CLOSED — doubles as "closed_at"
  is_active: boolean;
  status: ChatSessionStatus;
  mode: ChatMode;
  assigned_expert_id: string | null; // FK -> user_profiles.profile_id (support_expert)
}

export interface ChatMessage {
  message_id: string; // uuid, PK
  session_id: string; // FK -> chat_sessions.session_id
  sender_type: ChatSenderType;
  sender_profile_id: string | null; // null for AI/System messages
  message: string;
  message_metadata: Record<string, unknown> | null; // e.g. detected actions — never prompts/keys
  risk_level: MessageRiskLevel | null; // only ever set on the survivor's own messages
  created_at: string;
}

// "User Requested Support" (no elaboration) is a fully valid, sufficient
// reason — reason is optional free text, never required from the survivor.
export interface ExpertSupportRequest {
  request_id: string; // uuid, PK
  conversation_id: string; // FK -> chat_sessions.session_id
  profile_id: string; // FK -> user_profiles.profile_id
  reason: string | null;
  priority: SupportPriority;
  status: ChatSessionStatus;
  assigned_expert_id: string | null; // FK -> user_profiles.profile_id (support_expert)
  requested_at: string;
  assigned_at: string | null;
  accepted_at: string | null;
  closed_at: string | null;
}

// Verified, admin-authored content — the AI must never invent or modify
// official SafeHer procedures; it can only surface a matched row's answer.
export interface Faq {
  faq_id: string; // uuid, PK
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  is_active: boolean;
  created_by: string | null; // FK -> user_profiles.profile_id
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  log_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id
  action: string;
  table_name: string;
  record_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

// A reusable REPORT DEFINITION (filters + metadata), never a fixed
// historical snapshot — reopening one always re-queries current,
// currently-authorized data (see module13_case_reports_saved_reports.sql).
// Private to its creator (RLS: created_by = current_profile_id()), not
// shared across users. `filters` is a loosely-typed jsonb bag on the DB
// side; the admin app's own `CaseReportFilters` shape (see
// admin/src/lib/reportFilters.ts) is what actually gets read/written
// into it — kept as `Record<string, unknown>` here since this file only
// describes the raw table shape, not the application-level contract.
export interface SavedReport {
  report_id: string; // uuid, PK
  created_by: string; // FK -> user_profiles.profile_id (owner — private, not shared)
  report_name: string;
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// One row per submission attempt — full history kept, never deleted.
// document_path is a private-bucket storage path, never a public URL
// (see module10_identity_verification.sql for the identity-documents
// bucket + RLS). The current overall status is mirrored onto
// UserProfile.identity_verification_status by a DB trigger — this table
// is the append-only history, that column is the fast-read summary.
export interface UserVerification {
  verification_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id
  document_path: string;
  document_type: string; // e.g. 'National ID', 'Passport', 'Driver\'s License'
  status: VerificationStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null; // FK -> user_profiles.profile_id (the reviewing admin)
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Supabase generic Database type (for supabase-js typing) ----------
//
// supabase-js (>=2.45) requires each table to satisfy `GenericTable` from
// @supabase/postgrest-js: { Row, Insert, Update, Relationships }, and the
// schema to declare `Tables`, `Views`, and `Functions`. Omitting
// `Relationships` (even as an empty array) makes every query's inferred
// row type silently collapse to `never` — that is intentionally never
// left out below.

type NoRelationships = { Relationships: [] };

export interface Database {
  public: {
    Tables: {
      municipalities: { Row: Municipality; Insert: Partial<Municipality>; Update: Partial<Municipality> } & NoRelationships;
      barangays: { Row: Barangay; Insert: Partial<Barangay>; Update: Partial<Barangay> } & NoRelationships;
      user_profiles: { Row: UserProfile; Insert: Partial<UserProfile>; Update: Partial<UserProfile> } & NoRelationships;
      survivors: { Row: Survivor; Insert: Partial<Survivor>; Update: Partial<Survivor> } & NoRelationships;
      shelters: { Row: Shelter; Insert: Partial<Shelter>; Update: Partial<Shelter> } & NoRelationships;
      case_reports: { Row: CaseReport; Insert: Partial<CaseReport>; Update: Partial<CaseReport> } & NoRelationships;
      case_assignments: { Row: CaseAssignment; Insert: Partial<CaseAssignment>; Update: Partial<CaseAssignment> } & NoRelationships;
      case_status_history: { Row: CaseStatusHistory; Insert: Partial<CaseStatusHistory>; Update: Partial<CaseStatusHistory> } & NoRelationships;
      case_referrals: { Row: CaseReferral; Insert: Partial<CaseReferral>; Update: Partial<CaseReferral> } & NoRelationships;
      shelter_referrals: { Row: ShelterReferral; Insert: Partial<ShelterReferral>; Update: Partial<ShelterReferral> } & NoRelationships;
      shelter_requests: { Row: ShelterRequest; Insert: Partial<ShelterRequest>; Update: Partial<ShelterRequest> } & NoRelationships;
      evidence: { Row: Evidence; Insert: Partial<Evidence>; Update: Partial<Evidence> } & NoRelationships;
      sos_alerts: { Row: SosAlert; Insert: Partial<SosAlert>; Update: Partial<SosAlert> } & NoRelationships;
      notifications: { Row: Notification; Insert: Partial<Notification>; Update: Partial<Notification> } & NoRelationships;
      push_tokens: { Row: PushToken; Insert: Partial<PushToken>; Update: Partial<PushToken> } & NoRelationships;
      law_enforcement_referrals: { Row: LawEnforcementReferral; Insert: Partial<LawEnforcementReferral>; Update: Partial<LawEnforcementReferral> } & NoRelationships;
      chat_sessions: { Row: ChatSession; Insert: Partial<ChatSession>; Update: Partial<ChatSession> } & NoRelationships;
      chat_messages: { Row: ChatMessage; Insert: Partial<ChatMessage>; Update: Partial<ChatMessage> } & NoRelationships;
      audit_logs: { Row: AuditLog; Insert: Partial<AuditLog>; Update: Partial<AuditLog> } & NoRelationships;
      user_verifications: { Row: UserVerification; Insert: Partial<UserVerification>; Update: Partial<UserVerification> } & NoRelationships;
      saved_reports: { Row: SavedReport; Insert: Partial<SavedReport>; Update: Partial<SavedReport> } & NoRelationships;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
