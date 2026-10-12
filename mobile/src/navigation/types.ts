export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  // survivorInfo is optional so a sign-in-triggered resend/re-navigation
  // to this same screen (no registration data in hand) stays valid —
  // every real call site from RegisterScreen always passes it.
  EmailVerification: {
    email: string;
    survivorInfo?: { dateOfBirth: string; gender: string; educationalAttainment: string };
  };
  ForgotPassword: undefined;
  ResetPassword: { email?: string } | undefined;
  // Pre-auth informational variant (module14) — shown when a
  // case-access QR/deep link is opened before the user is signed in.
  CaseAccess: { token: string };
  // Read-only in this stack (no session yet) — reached from Register's
  // consent checkbox. Same screen component also lives in
  // AppStackParamList below for the authenticated Profile entry point.
  Terms: undefined;
};

export type AppTabParamList = {
  HomeTab: undefined;
  CasesTab: undefined;
  SosTab: undefined;
  ChatTab: undefined;
  SheltersTab: undefined;
};

export type AppStackParamList = {
  // Optional nested-screen param — lets a plain stack screen (e.g.
  // Profile) navigate back into a specific tab (e.g. Home, to replay
  // the app tour) via navigation.navigate('Tabs', { screen: 'HomeTab' }).
  // Every existing call site passes no param at all, which stays valid
  // since this is optional.
  Tabs: { screen: keyof AppTabParamList } | undefined;
  ReportIncident: undefined;
  CaseDetail: { caseId: string };
  RequestShelter: { shelterId?: string };
  Notifications: undefined;
  Profile: undefined;
  EditProfile: undefined;
  SecuritySettings: undefined;
  ChangePassword: undefined;
  VerifyIdentity: undefined;
  // The real check-and-route workflow (module14) — calls
  // redeem_case_access_token and renders exactly one of the states
  // described in CaseAccessScreen. Never renders case data itself.
  CaseAccess: { token: string };
  ScanCaseQr: undefined;
  LinkedCaseDetail: { caseId: string };
  // module28 — Provincial Announcements live feed.
  Announcements: undefined;
  AnnouncementDetail: { announcementId: string };
  // Authenticated entry point (Profile > Legal & Privacy). Shows
  // acceptance status/re-consent in addition to the same document
  // AuthStackParamList's pre-auth Terms route renders.
  Terms: undefined;
};
