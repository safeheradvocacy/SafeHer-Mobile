export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: undefined;
  RegistrationSuccess: undefined;
};

// Lets every useNavigation()/navigation.navigate() call in the app resolve
// its route names against AuthStackParamList without a generic on every
// call site. Future modules can extend this the same way once AppStack
// grows real screens (e.g. `interface RootParamList extends
// AuthStackParamList, AppStackParamList {}`).
declare global {
  namespace ReactNavigation {
    interface RootParamList extends AuthStackParamList {}
  }
}
