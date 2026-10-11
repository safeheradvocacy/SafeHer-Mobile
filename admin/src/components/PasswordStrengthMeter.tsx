import React from 'react';
import { Check, X } from 'lucide-react';

export interface PasswordRequirement {
  key: string;
  label: string;
  met: boolean;
}

export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { key: 'length', label: 'Minimum 8 characters', met: password.length >= 8 },
    { key: 'upper', label: 'Uppercase letter', met: /[A-Z]/.test(password) },
    { key: 'lower', label: 'Lowercase letter', met: /[a-z]/.test(password) },
    { key: 'number', label: 'Number', met: /[0-9]/.test(password) },
    { key: 'special', label: 'Special character', met: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function allRequirementsMet(password: string): boolean {
  return getPasswordRequirements(password).every((r) => r.met);
}

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLORS = ['var(--color-danger)', 'var(--color-danger)', 'var(--color-warning)', 'var(--color-info)', 'var(--color-success)'];

/**
 * Requirement checklist + a 5-segment strength bar. Strength is simply
 * "how many of the 5 requirements are met" rather than a separate
 * entropy calculation — keeps the bar and the checklist always telling
 * the same story instead of two slightly different opinions about the
 * same password.
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const requirements = getPasswordRequirements(password);
  const metCount = requirements.filter((r) => r.met).length;
  const level = password.length === 0 ? -1 : Math.max(0, metCount - 1);

  return (
    <div>
      <div className="pw-strength-track" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="pw-strength-seg"
            style={{ background: i <= level ? STRENGTH_COLORS[level] : undefined }}
          />
        ))}
      </div>
      {password.length > 0 && (
        <span className="pw-strength-label" style={{ color: STRENGTH_COLORS[level] }}>
          {STRENGTH_LABELS[level]}
        </span>
      )}
      <div className="pw-requirements" role="list" aria-label="Password requirements">
        {requirements.map((r) => (
          <span key={r.key} className={`pw-requirement${r.met ? ' met' : ''}`} role="listitem">
            {r.met ? <Check size={13} /> : <X size={13} />}
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}
