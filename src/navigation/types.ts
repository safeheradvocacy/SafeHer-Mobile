export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Welcome: undefined;
  Login: undefined;
  CreateAccount: undefined;
  RegistrationSuccess: undefined;
  ForgotPassword: undefined;
  // accessToken/refreshToken arrive from the Supabase recovery deep link
  ResetPassword: { accessToken?: string; refreshToken?: string } | undefined;
};

declare global {
  // Lets useNavigation() infer route types without passing generics everywhere
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends AuthStackParamList {}
  }
}
