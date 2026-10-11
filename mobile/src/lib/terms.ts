// The current Terms & Conditions — version, effective date, and the
// document body itself. Kept as a static, versioned app resource rather
// than a database table: nothing here is admin-editable yet (unlike
// FAQs, which have a real management UI), so there is no reader/writer
// split that would justify a DB-backed document store for a prototype.
// What DOES live in the database is the ACCEPTANCE record — see
// supabase/module18_terms_acceptance.sql and AuthContext.verifyEmailOtp.
//
// Bumping the version: change CURRENT_TERMS_VERSION (e.g. '1.0' ->
// '1.1'), update TERMS_EFFECTIVE_DATE, and edit TERMS_SECTIONS. Existing
// terms_acceptances rows for '1.0' are never touched or deleted — a
// user who already accepted 1.0 simply has no row yet for 1.1, which is
// exactly the signal TermsAndConditionsScreen uses to offer re-consent.
export const CURRENT_TERMS_VERSION = '1.2';
export const TERMS_EFFECTIVE_DATE = 'October 8, 2026';

export interface TermsSection {
  heading: string;
  body: string[];
}

// Every claim below is written to match what SafeSpace actually does, per
// the implemented mobile app and its Supabase backend — no capability
// is described that isn't real. In particular: SOS is described as a
// direct alert to authorized police officers (module19 — unconditional,
// no referral step) as well as municipal/provincial staff, never as a
// guarantee of emergency dispatch, since SafeSpace has no direct
// integration with 911/emergency-hotline dispatch systems. Incident
// (case) reporting, by contrast, genuinely is still a referral-routed
// workflow — see Section 6 — that distinction is intentional, not an
// inconsistency.
export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: '1. Introduction',
    body: [
      'SafeSpace is a mobile and web platform that helps survivors of violence against women and children (VAWC) in Aurora Province report incidents, request emergency assistance, track the status of their case, and connect with barangay, municipal, and provincial social welfare offices, shelters, and law enforcement.',
      'These Terms and Conditions ("Terms") govern your use of the SafeSpace mobile application. Please read them fully before creating an account.',
    ],
  },
  {
    heading: '2. Acceptance of Terms',
    body: [
      'By checking the consent box during registration and creating a SafeSpace account, you confirm that you have read, understood, and agree to these Terms.',
      'Your acceptance is recorded against your account, together with the Terms version you agreed to and the date and time of your acceptance. If these Terms are updated in a way that requires renewed consent, you will be asked to review and accept the new version before continuing to use features that require it.',
    ],
  },
  {
    heading: '3. Eligibility and Account Registration',
    body: [
      'SafeSpace accounts are intended for survivors seeking support and for authorized personnel of partner offices and agencies. When you register, you agree to provide accurate information, including your municipality and barangay, so that your report or request can reach the correct office.',
      'You must verify your email address before your account is fully activated, and you may be asked to verify your identity where required for certain services.',
    ],
  },
  {
    heading: '4. SafeSpace Service Description',
    body: [
      'SafeSpace provides: confidential incident reporting (with an option to report anonymously); an SOS feature to alert authorized responders with your location; case status tracking; shelter search and shelter placement requests; identity verification; a QR-based way to link a walk-in report to your account; and an AI assistant that can answer common questions and, where appropriate, connect you with a human support specialist.',
      'SafeSpace is a coordination and communication tool. It does not replace the professional judgment, procedures, or legal authority of the social welfare offices, law enforcement, healthcare providers, or other agencies it connects you with.',
    ],
  },
  {
    heading: '5. User Responsibilities',
    body: [
      'You agree to use SafeSpace honestly and in good faith — including when submitting reports, evidence, or other information — and to keep your login credentials confidential.',
      'You are responsible for the accuracy of the information you submit. Knowingly false reports may be referred to the appropriate authorities and may result in suspension of your account.',
    ],
  },
  {
    heading: '6. Case Reporting and Information Submission',
    body: [
      'When you submit an incident report, it is routed to the barangay or municipal office responsible for your registered or reported location. That office (and, where a case is referred, the provincial office, a shelter, or a law-enforcement officer specifically assigned to your case) can view the details of your report in order to respond to it.',
      'You may choose to report anonymously. An anonymous report is still routed to the appropriate office for review, but is not linked to your identity in the same way a standard report is.',
      'You can track your case’s status and history from within the app. Only the office currently responsible for your case can update that status.',
    ],
  },
  {
    heading: '7. Emergency and SOS Features',
    body: [
      'The SOS feature sends an alert containing your live or last-known location directly to authorized police officers, as well as municipal and provincial staff authorized to monitor SOS alerts in your area, so that they can respond as quickly as possible. A police officer does not need to wait for a referral to see or act on your alert.',
      'SOS in SafeSpace is an alert mechanism, not a direct connection to 911, a police dispatch system, or any other emergency hotline. SafeSpace does not itself dispatch police, medical, or fire responders, and it does not guarantee a response within any particular time. Response depends on the responsible agency’s own availability and operating conditions, and on network/location conditions on your device.',
      'If you are in immediate danger, contact your local emergency hotline or law enforcement directly in addition to, or instead of, using SafeSpace’s SOS feature.',
    ],
  },
  {
    heading: '8. Limitations of the SafeSpace Platform',
    body: [
      'SafeSpace depends on network connectivity, device location services, and the availability and responsiveness of partner offices and agencies, none of which SafeSpace controls. Location accuracy varies by device and environment and is labeled in the app accordingly (for example, when only a last-known location is available).',
      'SafeSpace does not provide legal advice, medical advice, psychological treatment, or law-enforcement action itself. It is a channel for reaching people and offices that do.',
    ],
  },
  {
    heading: '9. Confidentiality and Information Handling',
    body: [
      'Your account and case information are protected by access controls enforced at the database level: only the specific office, tier (barangay, municipal, or provincial), or individually assigned specialist relevant to your case can view it. SafeSpace staff and partner-agency accounts see only what their role and jurisdiction authorize them to see.',
      'Information you submit is used to provide you support and to coordinate your case among authorized offices and, where you request it, a shelter or law-enforcement referral. It is not sold, and it is not shared with parties outside this authorized chain except where required by law or to prevent serious harm.',
    ],
  },
  {
    heading: '10. User-Submitted Evidence',
    body: [
      'You may attach photos, documents, or other files as evidence to an incident report. Evidence you submit is stored in a restricted, access-controlled location and is visible only to offices authorized to review your case.',
      'Do not upload evidence that is not yours to share or that would put another person’s safety at risk by being submitted.',
    ],
  },
  {
    heading: '11. Prohibited Use',
    body: [
      'You agree not to: submit knowingly false reports; use SafeSpace to harass, impersonate, or falsely accuse another person; attempt to access another user’s account or information; interfere with or attempt to circumvent SafeSpace’s security controls; or use the platform for any purpose other than seeking or providing legitimate VAWC-related support.',
    ],
  },
  {
    heading: '12. Account Security',
    body: [
      'You are responsible for keeping your password confidential and for all activity under your account. Notify SafeSpace support if you believe your account has been accessed without your permission.',
      'SafeSpace verifies sensitive account changes (such as a password change) with a one-time code sent to your registered email, and supports device-level authentication (such as Face ID or fingerprint unlock) where your device provides it.',
    ],
  },
  {
    heading: '13. Third-Party Services',
    body: [
      'SafeSpace relies on third-party infrastructure to operate — including cloud hosting and database services, mapping services for shelter locations and location display, and push-notification delivery. These providers process data only as needed to provide their service to SafeSpace and are not authorized to use it for their own purposes.',
    ],
  },
  {
    heading: '14. Service Availability',
    body: [
      'SafeSpace is provided on an "as available" basis. Maintenance, connectivity issues, or circumstances outside SafeSpace’s control may make the app or specific features temporarily unavailable. SafeSpace does not guarantee uninterrupted or error-free operation.',
    ],
  },
  {
    heading: '15. Disclaimer',
    body: [
      'SafeSpace is a support and coordination platform. It does not replace emergency services, law enforcement, healthcare professionals, legal professionals, social workers, or other appropriate authorities, and using SafeSpace does not create a guarantee of any particular outcome, response time, or result.',
      'SafeSpace does not guarantee your safety, does not guarantee an immediate emergency response, and does not automatically contact police, medical responders, or any other authority on your behalf beyond directly alerting the SafeSpace-authorized staff and police officers described in Section 7. If you are in immediate danger, contact your local emergency hotline or law enforcement directly.',
    ],
  },
  {
    heading: '16. Limitation of Liability',
    body: [
      'To the fullest extent permitted by applicable law, SafeSpace and the offices operating it are not liable for delays, unavailability, or outcomes arising from network failures, device limitations, third-party service outages, or the independent actions (or inaction) of the partner offices, agencies, or individuals SafeSpace connects you with.',
    ],
  },
  {
    heading: '17. Changes to the Terms',
    body: [
      'These Terms may be updated from time to time. When a change requires your renewed consent, SafeSpace will present the updated Terms and record your acceptance of the new version, without deleting the record of any version you accepted previously.',
      'The current version number and effective date are always shown at the top of this screen and in your Profile.',
    ],
  },
  {
    heading: '18. Termination or Account Deactivation',
    body: [
      'You may request deactivation of your account by contacting SafeSpace support. SafeSpace may suspend or deactivate an account that violates these Terms, including the Prohibited Use section above, or that is used in a way that puts another person at risk.',
    ],
  },
  {
    heading: '19. Contact / Support Information',
    body: [
      'For questions about these Terms, or to request account support, contact the Provincial Social Welfare and Development Office (PSWDO), Aurora Province, through the channels provided in the SafeSpace app or on official PSWDO communications.',
    ],
  },
  {
    heading: '20. Legal Review Notice',
    body: [
      'This document has been written to accurately describe SafeSpace’s implemented features and limitations. It has not yet been reviewed by a qualified legal adviser and should not be treated as a final, legally binding document until that review is complete.',
    ],
  },
];
