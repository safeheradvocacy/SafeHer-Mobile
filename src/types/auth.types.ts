/**
 * Types mirror the ERD exactly (municipalities, user_profiles).
 * Do not add fields that aren't in the ERD.
 */

export type UserRole =
  | 'survivor'
  | 'municipal_admin'
  | 'provincial_admin'
  | 'super_admin';

export interface Municipality {
  municipality_id: string;
  municipality_name: string;
  province: string;
  contact_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  profile_id: string;
  auth_user_id: string;
  municipality_id: string | null;
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

export interface SignUpPayload {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  municipalityId: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface ResetPasswordPayload {
  newPassword: string;
  confirmPassword: string;
}

/** Generic result wrapper returned by every authService function. */
export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}
