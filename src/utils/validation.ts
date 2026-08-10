const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX
const PH_PHONE_REGEX = /^(?:\+63|0)9\d{9}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function isValidPhilippinePhone(phone: string): boolean {
  return PH_PHONE_REGEX.test(phone.trim().replace(/[\s-]/g, ''));
}

export function isNotEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export type PasswordStrengthLabel = 'Too Weak' | 'Weak' | 'Fair' | 'Strong';

export interface PasswordStrength {
  /** 0-4 filled segments, used to drive the strength meter bar */
  score: 0 | 1 | 2 | 3 | 4;
  label: PasswordStrengthLabel;
  color: 'error' | 'warning' | 'success';
  /** Minimum bar: at least 8 chars, one letter, one number */
  isValid: boolean;
}

export function getPasswordStrength(password: string): PasswordStrength {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const clamped = Math.min(score, 4) as PasswordStrength['score'];
  const isValid = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);

  let label: PasswordStrengthLabel = 'Too Weak';
  let color: PasswordStrength['color'] = 'error';

  if (clamped >= 4) {
    label = 'Strong';
    color = 'success';
  } else if (clamped === 3) {
    label = 'Fair';
    color = 'warning';
  } else if (clamped >= 1) {
    label = 'Weak';
    color = 'error';
  }

  return { score: clamped, label, color, isValid };
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password.length > 0 && password === confirmPassword;
}

export interface FieldErrors {
  [field: string]: string | undefined;
}

export function validateLoginForm(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!isNotEmpty(email)) errors.email = 'Email address is required.';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';

  if (!isNotEmpty(password)) errors.password = 'Password is required.';

  return errors;
}

export function validateCreateAccountForm(fields: {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  municipalityId: string;
  password: string;
  confirmPassword: string;
  agreedToTerms: boolean;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!isNotEmpty(fields.firstName)) errors.firstName = 'First name is required.';
  if (!isNotEmpty(fields.lastName)) errors.lastName = 'Last name is required.';

  if (!isNotEmpty(fields.email)) errors.email = 'Email address is required.';
  else if (!isValidEmail(fields.email)) errors.email = 'Enter a valid email address.';

  if (!isNotEmpty(fields.phoneNumber)) errors.phoneNumber = 'Phone number is required.';
  else if (!isValidPhilippinePhone(fields.phoneNumber)) {
    errors.phoneNumber = 'Enter a valid PH mobile number (e.g. 09171234567).';
  }

  if (!isNotEmpty(fields.municipalityId)) errors.municipalityId = 'Select your municipality.';

  if (!isNotEmpty(fields.password)) errors.password = 'Password is required.';
  else if (!getPasswordStrength(fields.password).isValid) {
    errors.password = 'Use at least 8 characters, including a letter and a number.';
  }

  if (!passwordsMatch(fields.password, fields.confirmPassword)) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (!fields.agreedToTerms) {
    errors.agreedToTerms = 'You must agree to the Privacy Policy and Terms & Conditions.';
  }

  return errors;
}

export function validateResetPasswordForm(newPassword: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};

  if (!isNotEmpty(newPassword)) errors.newPassword = 'New password is required.';
  else if (!getPasswordStrength(newPassword).isValid) {
    errors.newPassword = 'Use at least 8 characters, including a letter and a number.';
  }

  if (!passwordsMatch(newPassword, confirmPassword)) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some((message) => Boolean(message));
}
