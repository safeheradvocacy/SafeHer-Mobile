export interface UserProfile {
  profile_id: string;
  auth_user_id: string;
  municipality_id: string | null;
  role: 'survivor' | 'municipal_admin' | 'provincial_admin' | 'super_admin';
  first_name: string;
  middle_name?: string;
  last_name: string;
  phone_number: string;
  profile_picture?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Municipality {
  municipality_id: string;
  municipality_name: string;
  province: string;
  contact_number?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SignUpData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  municipalityId: string;
}
