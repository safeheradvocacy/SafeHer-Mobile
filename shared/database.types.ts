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
 * Table list (15 total, matches ERD exactly):
 *   municipalities, user_profiles, survivors, shelters, case_reports,
 *   case_assignments, case_status_history, shelter_referrals,
 *   evidence, sos_alerts, notifications, chat_sessions, chat_messages,
 *   audit_logs  (+ auth.users, managed by Supabase Auth)
 * ------------------------------------------------------------------
 */

// ---------- ENUMS (must match the Postgres ENUM types exactly) ----------

export type UserRole = 'survivor' | 'municipal_admin' | 'provincial_admin' | 'super_admin';

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

export type SosStatus = 'Triggered' | 'Responding' | 'Resolved';

export type NotificationType = 'Case Update' | 'SOS' | 'Assignment' | 'Referral' | 'Announcement';

export type ChatSenderType = 'User' | 'AI';

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

export interface UserProfile {
  profile_id: string; // uuid, PK
  auth_user_id: string; // FK -> auth.users.id, 1:1
  municipality_id: string | null; // FK -> municipalities.municipality_id
  role: UserRole;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  phone_number: string | null;
  profile_picture: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Survivor {
  survivor_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id, unique (1:1)
  municipality_id: string; // FK -> municipalities.municipality_id
  date_of_birth: string | null;
  gender: Gender | null;
  address: string | null;
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
  capacity: number;
  current_occupancy: number;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CaseReport {
  case_id: string; // uuid, PK
  survivor_id: string; // FK -> survivors.survivor_id
  municipality_id: string; // FK -> municipalities.municipality_id
  case_number: string; // unique
  case_type: CaseType;
  description: string;
  incident_date: string;
  incident_location: string;
  priority_level: PriorityLevel;
  status: CaseStatus;
  is_anonymous: boolean;
  reported_at: string;
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
  referred_at: string;
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
  latitude: number;
  longitude: number;
  location_address: string | null;
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
}

export interface ChatSession {
  session_id: string; // uuid, PK
  profile_id: string; // FK -> user_profiles.profile_id
  started_at: string;
  ended_at: string | null;
  is_active: boolean;
}

export interface ChatMessage {
  message_id: string; // uuid, PK
  session_id: string; // FK -> chat_sessions.session_id
  sender_type: ChatSenderType;
  message: string;
  created_at: string;
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
      user_profiles: { Row: UserProfile; Insert: Partial<UserProfile>; Update: Partial<UserProfile> } & NoRelationships;
      survivors: { Row: Survivor; Insert: Partial<Survivor>; Update: Partial<Survivor> } & NoRelationships;
      shelters: { Row: Shelter; Insert: Partial<Shelter>; Update: Partial<Shelter> } & NoRelationships;
      case_reports: { Row: CaseReport; Insert: Partial<CaseReport>; Update: Partial<CaseReport> } & NoRelationships;
      case_assignments: { Row: CaseAssignment; Insert: Partial<CaseAssignment>; Update: Partial<CaseAssignment> } & NoRelationships;
      case_status_history: { Row: CaseStatusHistory; Insert: Partial<CaseStatusHistory>; Update: Partial<CaseStatusHistory> } & NoRelationships;
      shelter_referrals: { Row: ShelterReferral; Insert: Partial<ShelterReferral>; Update: Partial<ShelterReferral> } & NoRelationships;
      evidence: { Row: Evidence; Insert: Partial<Evidence>; Update: Partial<Evidence> } & NoRelationships;
      sos_alerts: { Row: SosAlert; Insert: Partial<SosAlert>; Update: Partial<SosAlert> } & NoRelationships;
      notifications: { Row: Notification; Insert: Partial<Notification>; Update: Partial<Notification> } & NoRelationships;
      chat_sessions: { Row: ChatSession; Insert: Partial<ChatSession>; Update: Partial<ChatSession> } & NoRelationships;
      chat_messages: { Row: ChatMessage; Insert: Partial<ChatMessage>; Update: Partial<ChatMessage> } & NoRelationships;
      audit_logs: { Row: AuditLog; Insert: Partial<AuditLog>; Update: Partial<AuditLog> } & NoRelationships;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
