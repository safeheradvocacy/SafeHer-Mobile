export const STATUS_COLORS: Record<string, string> = {
  Pending: '#D98A24',
  'Under Review': '#4C82B3',
  Assigned: '#1456A0',
  'In Progress': '#4C82B3',
  Referred: '#1456A0',
  Resolved: '#4D9272',
  Closed: '#526070',
  Low: '#4D9272',
  Medium: '#D98A24',
  High: '#D94B63',
  Critical: '#AD3549',
  Triggered: '#D94B63',
  Responding: '#D98A24',
  Accepted: '#4D9272',
  Declined: '#526070',
  Completed: '#4D9272',
  Active: '#4D9272',
  Inactive: '#526070',
  Submitted: '#D98A24',
  'Awaiting Information': '#D98A24',
  Cancelled: '#526070',
  'Placement Confirmed': '#1456A0',
  Standard: '#526070',
  Urgent: '#D98A24',
  Emergency: '#D94B63',

  // module23 — backup integrity + restore lifecycle. 'Completed'/
  // 'Active'/'Cancelled' above are already reused where their meaning
  // matches exactly (e.g. a restore's terminal 'verified' maps to its
  // own 'Verified' label below, not reused from elsewhere, since
  // "verified" means something load-bearing here).
  Running: '#4C82B3',
  Failed: '#D94B63',
  Verified: '#4D9272',
  Unverified: '#D98A24',
  Corrupted: '#AD3549',
  Expired: '#526070',
  'Awaiting Confirmation': '#D98A24',
  Confirmed: '#4C82B3',
  'Creating Safety Backup': '#4C82B3',
  'Safety Backup Failed': '#AD3549',
  Restoring: '#D98A24',
  'Restore Failed': '#AD3549',
  Verifying: '#4C82B3',
  'Verification Failed': '#AD3549',

  // module24 — expert_support_requests.status (ChatSessionStatus), used
  // by the new Support Expert Reports & Analytics page. Distinct keys
  // from the title-case ones above since this enum's values are
  // UPPER_SNAKE_CASE at the database layer, not a display label.
  AI_ASSISTED: '#526070',
  WAITING_FOR_EXPERT: '#D98A24',
  EXPERT_ASSIGNED: '#4C82B3',
  EXPERT_ACTIVE: '#1456A0',
  CLOSED: '#4D9272',

  // module28 — announcement lifecycle status + priority. 'Urgent' and
  // 'Expired' are already defined above (shelter_request_urgency /
  // backup verification, respectively) and reused as-is.
  Draft: '#526070',
  Scheduled: '#4C82B3',
  Published: '#4D9272',
  Archived: '#526070',
  Unpublished: '#D98A24',
  Important: '#D98A24',
  Normal: '#526070',
};
