export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  RegistrationSuccess: undefined;
  ForgotPassword: undefined;
  ResetPassword: { email?: string } | undefined;
};

export type AppTabParamList = {
  HomeTab: undefined;
  CasesTab: undefined;
  SosTab: undefined;
  ChatTab: undefined;
  SheltersTab: undefined;
};

export type AppStackParamList = {
  Tabs: undefined;
  ReportIncident: undefined;
  CaseDetail: { caseId: string };
  Notifications: undefined;
  Profile: undefined;
  EditProfile: undefined;
  SecuritySettings: undefined;
};
