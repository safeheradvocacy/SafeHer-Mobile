import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { ageAt, classifyForGovernmentReport, mapCaseTypeToTemplateColumn, type GovernmentReportClassification } from './governmentReportMapping';
import { isServiceProvided } from './serviceTypes';
import type { CaseReport, CaseService, ServiceType, Survivor } from '../types/database.types';

/**
 * The Detailed Government Report row — the one place case-level PII
 * (name, address, birthdate, age, sex, educational attainment) is ever
 * joined onto a case for reporting purposes. Deliberately a SEPARATE
 * row builder from reportRows.ts's ReportRow (the existing, PII-free
 * Case Management Report), not a superset of it — the two surfaces
 * have genuinely different sensitivity, and keeping them structurally
 * separate is what makes it impossible to accidentally leak a name
 * into the general report by editing the wrong shared type.
 */
export interface GovernmentReportRow {
  caseId: string;
  caseNumber: string;
  dateReportedIso: string;
  classification: GovernmentReportClassification;
  nameOrAlias: string; // "Anonymous" when case_reports.is_anonymous; "—" when not resolvable under this role's RLS scope
  address: string; // "—" when not resolvable
  birthdateDisplay: string; // "—" when date_of_birth not on file / not resolvable
  age: number | null;
  sex: string; // "—" when not on file / not resolvable
  educationalAttainment: string; // "—" when not on file / not resolvable
  templateColumn: ReturnType<typeof mapCaseTypeToTemplateColumn>;
  sexualAbuseSubtype: string | null;
  statusRemarks: string;
  // module22 — only service_type codes with a case_services row whose
  // status is exactly 'Provided' ever appear here; a referral, request,
  // or in-progress service is never included (see isServiceProvided()).
  providedServices: Set<ServiceType>;
}

/**
 * RLS reality check (verified live against the project before writing
 * this): "Admins can view survivors in scope" (module3) only covers
 * is_provincial_admin() (-> provincial_staff/provincial_admin/
 * super_admin) and municipal_admin — barangay_admin is NOT in that
 * policy at all. A barangay_admin's query below will come back with
 * zero survivor rows, not an error (RLS filters rows, it doesn't
 * reject the request) — canAccessSurvivorPii distinguishes "no PII
 * because this role isn't authorized" from "no PII because it's
 * missing from the record", so the UI can say which one is true
 * instead of just showing blank cells with no explanation.
 */
export function canAccessSurvivorPii(roleTier: 'province' | 'municipality' | 'barangay' | null): boolean {
  return roleTier === 'province' || roleTier === 'municipality';
}

function formatBirthdate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function useGovernmentReportRows(cases: CaseReport[], roleTier: 'province' | 'municipality' | 'barangay' | null) {
  const [survivorsById, setSurvivorsById] = useState<Record<string, Survivor>>({});
  const [namesByProfileId, setNamesByProfileId] = useState<Record<string, string>>({});
  const [providedServicesByCase, setProvidedServicesByCase] = useState<Record<string, Set<ServiceType>>>({});
  const [loading, setLoading] = useState(false);

  const survivorIds = useMemo(
    () => Array.from(new Set(cases.map((c) => c.survivor_id).filter((id): id is string => !!id))),
    [cases]
  );
  const caseIds = useMemo(() => cases.map((c) => c.case_id), [cases]);

  // Services are case-management data, not survivor PII — fetched
  // independently of canAccessSurvivorPii. Only rows whose status is
  // exactly 'Provided' are kept; a referral/request/in-progress
  // service is dropped here, never surfaced as "provided" downstream.
  useEffect(() => {
    if (caseIds.length === 0) {
      setProvidedServicesByCase({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('case_services').select('*').in('case_id', caseIds);
      if (cancelled) return;
      const byCase: Record<string, Set<ServiceType>> = {};
      (data ?? []).forEach((s: CaseService) => {
        if (!isServiceProvided(s.status)) return;
        if (!byCase[s.case_id]) byCase[s.case_id] = new Set();
        byCase[s.case_id].add(s.service_type);
      });
      setProvidedServicesByCase(byCase);
    })();
    return () => {
      cancelled = true;
    };
  }, [caseIds]);

  useEffect(() => {
    if (!canAccessSurvivorPii(roleTier) || survivorIds.length === 0) {
      setSurvivorsById({});
      setNamesByProfileId({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: survivorRows } = await supabase.from('survivors').select('*').in('survivor_id', survivorIds);
      if (cancelled) return;
      const byId: Record<string, Survivor> = {};
      (survivorRows ?? []).forEach((s: Survivor) => {
        byId[s.survivor_id] = s;
      });
      setSurvivorsById(byId);

      const profileIds = Array.from(new Set((survivorRows ?? []).map((s: Survivor) => s.profile_id)));
      if (profileIds.length > 0) {
        const { data: profileRows } = await supabase.from('user_profiles').select('profile_id,first_name,last_name').in('profile_id', profileIds);
        if (cancelled) return;
        const names: Record<string, string> = {};
        (profileRows ?? []).forEach((p: any) => {
          names[p.profile_id] = `${p.first_name} ${p.last_name}`;
        });
        setNamesByProfileId(names);
      } else {
        setNamesByProfileId({});
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [survivorIds, roleTier]);

  const rows: GovernmentReportRow[] = useMemo(
    () =>
      cases.map((c) => {
        const survivor = c.survivor_id ? survivorsById[c.survivor_id] ?? null : null;
        const age = ageAt(survivor?.date_of_birth ?? null, c.reported_at);
        const hasPiiAccess = canAccessSurvivorPii(roleTier);
        const resolvedName = survivor ? namesByProfileId[survivor.profile_id] : undefined;

        return {
          caseId: c.case_id,
          caseNumber: c.case_number,
          dateReportedIso: c.reported_at.slice(0, 10),
          classification: classifyForGovernmentReport(c, survivor),
          nameOrAlias: c.is_anonymous ? 'Anonymous' : resolvedName ?? (hasPiiAccess ? '—' : 'Not authorized for this role'),
          address: survivor?.formatted_address || survivor?.address || (hasPiiAccess ? '—' : 'Not authorized for this role'),
          birthdateDisplay: hasPiiAccess ? formatBirthdate(survivor?.date_of_birth ?? null) : 'Not authorized for this role',
          age: hasPiiAccess ? age : null,
          sex: hasPiiAccess ? survivor?.gender ?? '—' : 'Not authorized for this role',
          educationalAttainment: hasPiiAccess ? survivor?.educational_attainment ?? '—' : 'Not authorized for this role',
          templateColumn: mapCaseTypeToTemplateColumn(c.case_type),
          sexualAbuseSubtype: c.sexual_abuse_subtype,
          statusRemarks: c.status,
          providedServices: providedServicesByCase[c.case_id] ?? new Set<ServiceType>(),
        };
      }),
    [cases, survivorsById, namesByProfileId, providedServicesByCase, roleTier]
  );

  return { rows, loading, canAccessSurvivorPii: canAccessSurvivorPii(roleTier) };
}
