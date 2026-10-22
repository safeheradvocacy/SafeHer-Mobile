import type { AppLanguage } from '../../lib/preferences';

// Same caveat as onboardingContent.ts/welcomeContent.ts: this Filipino
// copy is written directly, not machine-translated, but hasn't been
// reviewed by a native speaker — worth that pass before this reaches
// production. "SafeHer", "Email", and "Password" are kept as-is in
// Filipino since they're already how Filipino users commonly encounter
// these terms in everyday apps.

export interface LoginStrings {
  title: string;
  subtitle: string;
  emailLabel: string;
  emailInvalid: string;
  passwordLabel: string;
  passwordRequired: string;
  loginErrorTitle: string;
  rememberMe: string;
  forgotPassword: string;
  logIn: string;
  signingIn: string;
  noAccount: string;
  createOne: string;
  privacyBody: string;
}

export interface RegisterStrings {
  stepTitles: [string, string, string, string];
  step0Title: string;
  // Step 1 is the new Survivor Information step — DOB/Sex/Educational
  // Attainment, now required at registration (previously Profile-only).
  step1Title: string;
  step2Title: string;
  step3Title: string;
  step3Subtitle: string;
  firstNameLabel: string;
  lastNameLabel: string;
  phoneLabel: string;
  survivorInfoIntro: string;
  dateOfBirthLabel: string;
  yearPlaceholder: string;
  monthPlaceholder: string;
  dayPlaceholder: string;
  sexLabel: string;
  sexPlaceholder: string;
  educationalAttainmentLabel: string;
  educationalAttainmentPlaceholder: string;
  pleaseSelectDateOfBirth: string;
  pleaseSelectSex: string;
  pleaseSelectEducationalAttainment: string;
  reviewDateOfBirthLabel: string;
  reviewSexLabel: string;
  reviewEducationalAttainmentLabel: string;
  municipalityLabel: string;
  municipalityLoading: string;
  municipalitySelectPlaceholder: string;
  municipalityErrorTitle: string;
  municipalityErrorMsg: string;
  municipalityEmptyTitle: string;
  municipalityEmptyMsg: string;
  barangayLabel: string;
  barangaySelectPlaceholder: string;
  pleaseSelectBarangay: string;
  purokLabel: string;
  mapSectionTitle: string;
  mapSectionBody: string;
  setLocationBtn: string;
  editLocationBtn: string;
  locationSetLabel: string;
  reviewBarangayLabel: string;
  reviewAddressLabel: string;
  checkFieldsTitle: string;
  continueBtn: string;
  emailLabel: string;
  emailInvalid: string;
  passwordLabel: string;
  confirmPasswordLabel: string;
  passwordsMismatch: string;
  passwordsMatch: string;
  passwordTooShort: string;
  pleaseEnterNames: string;
  pleaseSelectMunicipality: string;
  reviewNameLabel: string;
  reviewPhoneLabel: string;
  reviewMunicipalityLabel: string;
  reviewEmailLabel: string;
  editLink: string;
  privacyHeading: string;
  privacyBody: string;
  // The consent row reads as one sentence with "Terms and Conditions"
  // rendered as a tappable inline link between prefix and suffix (see
  // RegisterScreen's ConsentCheckbox usage) — split into three parts
  // rather than one string so the link text can be embedded without
  // string-matching/parsing a single localized sentence.
  consentPrefix: string;
  termsLinkText: string;
  consentSuffix: string;
  oneMoreThingTitle: string;
  pleaseAgree: string;
  createAccountBtn: string;
  creatingAccount: string;
  couldntCreateTitle: string;
  alreadyHaveAccount: string;
  logIn: string;
}

export interface ForgotPasswordStrings {
  title: string;
  subtitle: string;
  emailLabel: string;
  emailInvalid: string;
  sendCode: string;
  sending: string;
  somethingWrongTitle: string;
  backToLogin: string;
  privacyHeading: string;
  privacyBody: string;
}

export interface RecoveryCodeStrings {
  title: string;
  explanation: string;
  errorTitle: string;
  verify: string;
  verifying: string;
  didntReceive: string;
  resendCode: string;
  resending: string;
  resendSentBody: string;
  resendInSeconds: (seconds: number) => string;
  tooManyAttempts: string;
  backToLogin: string;
}

export interface ResetPasswordStrings {
  title: string;
  forEmail: string;
  passwordUpdated: string;
  newPasswordLabel: string;
  confirmNewPasswordLabel: string;
  passwordTooShort: string;
  passwordsMismatch: string;
  updatePassword: string;
  couldntUpdateTitle: string;
  logIn: string;
}

export interface EmailVerificationStrings {
  title: string;
  explanation: string;
  errorTitle: string;
  verify: string;
  verifying: string;
  didntReceive: string;
  resendCode: string;
  resending: string;
  resendSentBody: string;
  resendInSeconds: (seconds: number) => string;
  backToLogin: string;
}

const LOGIN: Record<AppLanguage, LoginStrings> = {
  en: {
    title: 'Welcome back',
    subtitle: 'Log in to continue to SafeSpace.',
    emailLabel: 'Email',
    emailInvalid: 'Enter a valid email address.',
    passwordLabel: 'Password',
    passwordRequired: 'Enter your password.',
    loginErrorTitle: "Couldn't log in",
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    logIn: 'Log in',
    signingIn: 'Signing in...',
    noAccount: "Don't have an account? ",
    createOne: 'Create one',
    privacyBody: 'Your information is handled securely.',
  },
  fil: {
    title: 'Maligayang pagbabalik',
    subtitle: 'Mag-log in para magpatuloy sa SafeSpace.',
    emailLabel: 'Email',
    emailInvalid: 'Maglagay ng tamang email address.',
    passwordLabel: 'Password',
    passwordRequired: 'Ilagay ang iyong password.',
    loginErrorTitle: 'Hindi makapag-log in',
    rememberMe: 'Tandaan ako',
    forgotPassword: 'Nakalimutan ang password?',
    logIn: 'Mag-log in',
    signingIn: 'Nagla-log in...',
    noAccount: 'Wala pang account? ',
    createOne: 'Gumawa ng isa',
    privacyBody: 'Ligtas na hinahawakan ang iyong impormasyon.',
  },
};

const REGISTER: Record<AppLanguage, RegisterStrings> = {
  en: {
    stepTitles: ['Personal Information', 'Survivor Information', 'Account Information', 'Review & Privacy'],
    step0Title: "Let's get to know you.",
    step1Title: 'Your survivor information.',
    step2Title: 'Secure your account.',
    step3Title: 'Review & Privacy',
    step3Subtitle: 'Make sure everything looks right before you continue.',
    firstNameLabel: 'First name *',
    lastNameLabel: 'Last name *',
    phoneLabel: 'Phone number',
    survivorInfoIntro: 'This information helps SafeSpace provide appropriate case support and reporting. You can review and update it later from your Profile.',
    dateOfBirthLabel: 'Date of birth *',
    yearPlaceholder: 'Year',
    monthPlaceholder: 'Month',
    dayPlaceholder: 'Day',
    sexLabel: 'Sex *',
    sexPlaceholder: 'Select',
    educationalAttainmentLabel: 'Educational attainment *',
    educationalAttainmentPlaceholder: 'Select',
    pleaseSelectDateOfBirth: 'Please select your date of birth.',
    pleaseSelectSex: 'Please select your sex.',
    pleaseSelectEducationalAttainment: 'Please select your educational attainment.',
    reviewDateOfBirthLabel: 'Date of birth',
    reviewSexLabel: 'Sex',
    reviewEducationalAttainmentLabel: 'Educational attainment',
    municipalityLabel: 'Municipality *',
    municipalityLoading: 'Loading municipalities...',
    municipalitySelectPlaceholder: 'Select municipality',
    municipalityErrorTitle: 'Unable to load municipalities',
    municipalityErrorMsg: 'Check your connection and try again.',
    municipalityEmptyTitle: 'No municipalities available',
    municipalityEmptyMsg: 'There are no municipalities set up yet. Please check back later.',
    barangayLabel: 'Barangay *',
    barangaySelectPlaceholder: 'Select barangay',
    pleaseSelectBarangay: 'Please select your barangay.',
    purokLabel: 'Purok / Sitio',
    mapSectionTitle: 'Location (optional)',
    mapSectionBody: 'You can confirm your exact location on a map now, or add it later from your profile.',
    setLocationBtn: 'Set Location on Map',
    editLocationBtn: 'Edit Location',
    locationSetLabel: 'Location set',
    reviewBarangayLabel: 'Barangay',
    reviewAddressLabel: 'Purok / Sitio',
    checkFieldsTitle: 'Check the fields above',
    continueBtn: 'Continue',
    emailLabel: 'Email *',
    emailInvalid: 'Enter a valid email address.',
    passwordLabel: 'Password *',
    confirmPasswordLabel: 'Confirm password *',
    passwordsMismatch: 'Passwords do not match.',
    passwordsMatch: 'Passwords match',
    passwordTooShort: 'Password must be at least 8 characters.',
    pleaseEnterNames: 'Please enter your first and last name.',
    pleaseSelectMunicipality: 'Please select your municipality.',
    reviewNameLabel: 'Name',
    reviewPhoneLabel: 'Phone number',
    reviewMunicipalityLabel: 'Municipality',
    reviewEmailLabel: 'Email',
    editLink: 'Edit',
    privacyHeading: 'Your privacy matters',
    privacyBody: 'Your information is encrypted and accessible only to authorized SafeSpace staff within your municipality.',
    consentPrefix: 'I have read and agree to the SafeSpace ',
    termsLinkText: 'Terms and Conditions',
    consentSuffix: '.',
    oneMoreThingTitle: 'One more thing',
    pleaseAgree: 'Please read and agree to the Terms and Conditions before creating your account.',
    createAccountBtn: 'Create account',
    creatingAccount: 'Creating account...',
    couldntCreateTitle: "Couldn't create your account",
    alreadyHaveAccount: 'Already have an account? ',
    logIn: 'Log in',
  },
  fil: {
    stepTitles: ['Personal na Impormasyon', 'Impormasyon ng Survivor', 'Impormasyon ng Account', 'Suriin at Privacy'],
    step0Title: 'Kilalanin ka namin.',
    step1Title: 'Iyong impormasyon bilang survivor.',
    step2Title: 'I-secure ang iyong account.',
    step3Title: 'Suriin at Privacy',
    step3Subtitle: 'Siguraduhing tama ang lahat bago magpatuloy.',
    firstNameLabel: 'Pangalan *',
    lastNameLabel: 'Apelyido *',
    phoneLabel: 'Numero ng telepono',
    survivorInfoIntro: 'Nakakatulong ang impormasyong ito sa SafeSpace na magbigay ng naaangkop na suporta at ulat para sa iyong kaso. Maaari mo itong suriin at i-update mamaya mula sa iyong Profile.',
    dateOfBirthLabel: 'Petsa ng kapanganakan *',
    yearPlaceholder: 'Taon',
    monthPlaceholder: 'Buwan',
    dayPlaceholder: 'Araw',
    sexLabel: 'Kasarian *',
    sexPlaceholder: 'Pumili',
    educationalAttainmentLabel: 'Pinakamataas na naabot na edukasyon *',
    educationalAttainmentPlaceholder: 'Pumili',
    pleaseSelectDateOfBirth: 'Pakipili ang iyong petsa ng kapanganakan.',
    pleaseSelectSex: 'Pakipili ang iyong kasarian.',
    pleaseSelectEducationalAttainment: 'Pakipili ang iyong pinakamataas na naabot na edukasyon.',
    reviewDateOfBirthLabel: 'Petsa ng kapanganakan',
    reviewSexLabel: 'Kasarian',
    reviewEducationalAttainmentLabel: 'Naabot na edukasyon',
    municipalityLabel: 'Munisipalidad *',
    municipalityLoading: 'Nilo-load ang mga munisipalidad...',
    municipalitySelectPlaceholder: 'Pumili ng munisipalidad',
    municipalityErrorTitle: 'Hindi ma-load ang mga munisipalidad',
    municipalityErrorMsg: 'Tingnan ang iyong koneksyon at subukang muli.',
    municipalityEmptyTitle: 'Walang available na munisipalidad',
    municipalityEmptyMsg: 'Wala pang naka-set up na munisipalidad. Bumalik mamaya.',
    barangayLabel: 'Barangay *',
    barangaySelectPlaceholder: 'Pumili ng barangay',
    pleaseSelectBarangay: 'Pakipili ang iyong barangay.',
    purokLabel: 'Purok / Sitio',
    mapSectionTitle: 'Lokasyon (opsyonal)',
    mapSectionBody: 'Maaari mong kumpirmahin ang eksaktong lokasyon sa mapa ngayon, o idagdag ito mamaya sa iyong profile.',
    setLocationBtn: 'Itakda ang Lokasyon sa Mapa',
    editLocationBtn: 'I-edit ang Lokasyon',
    locationSetLabel: 'Naitakda na ang lokasyon',
    reviewBarangayLabel: 'Barangay',
    reviewAddressLabel: 'Purok / Sitio',
    checkFieldsTitle: 'Suriin ang mga field sa itaas',
    continueBtn: 'Magpatuloy',
    emailLabel: 'Email *',
    emailInvalid: 'Maglagay ng tamang email address.',
    passwordLabel: 'Password *',
    confirmPasswordLabel: 'Kumpirmahin ang password *',
    passwordsMismatch: 'Hindi magkatugma ang mga password.',
    passwordsMatch: 'Magkatugma ang mga password',
    passwordTooShort: 'Dapat hindi bababa sa 8 na karakter ang password.',
    pleaseEnterNames: 'Pakilagay ang iyong pangalan at apelyido.',
    pleaseSelectMunicipality: 'Pakipili ang iyong munisipalidad.',
    reviewNameLabel: 'Pangalan',
    reviewPhoneLabel: 'Numero ng telepono',
    reviewMunicipalityLabel: 'Munisipalidad',
    reviewEmailLabel: 'Email',
    editLink: 'I-edit',
    privacyHeading: 'Mahalaga ang iyong privacy',
    privacyBody: 'Naka-encrypt ang iyong impormasyon at maa-access lamang ng mga awtorisadong tauhan ng SafeSpace sa iyong munisipalidad.',
    consentPrefix: 'Nabasa ko at sumasang-ayon ako sa ',
    termsLinkText: 'Mga Tuntunin at Kundisyon ng SafeSpace',
    consentSuffix: '.',
    oneMoreThingTitle: 'Isa pang bagay',
    pleaseAgree: 'Pakibasa at sumang-ayon sa Mga Tuntunin at Kundisyon bago gumawa ng account.',
    createAccountBtn: 'Gumawa ng account',
    creatingAccount: 'Gumagawa ng account...',
    couldntCreateTitle: 'Hindi nagawa ang iyong account',
    alreadyHaveAccount: 'May account ka na? ',
    logIn: 'Mag-log in',
  },
};

const FORGOT_PASSWORD: Record<AppLanguage, ForgotPasswordStrings> = {
  en: {
    title: 'Forgot your password?',
    subtitle: "Enter your email and we'll send a verification code to reset your password.",
    emailLabel: 'Email',
    emailInvalid: 'Enter a valid email address.',
    sendCode: 'Send verification code',
    sending: 'Sending...',
    somethingWrongTitle: 'Something went wrong',
    backToLogin: 'Back to log in',
    privacyHeading: 'Your privacy matters',
    privacyBody: 'Your information is handled securely.',
  },
  fil: {
    title: 'Nakalimutan ang password?',
    subtitle: 'Ilagay ang iyong email at magpapadala kami ng verification code para i-reset ang iyong password.',
    emailLabel: 'Email',
    emailInvalid: 'Maglagay ng tamang email address.',
    sendCode: 'Ipadala ang verification code',
    sending: 'Nagpapadala...',
    somethingWrongTitle: 'May nangyaring mali',
    backToLogin: 'Bumalik sa pag-log in',
    privacyHeading: 'Mahalaga ang iyong privacy',
    privacyBody: 'Ligtas na hinahawakan ang iyong impormasyon.',
  },
};

const RECOVERY_CODE: Record<AppLanguage, RecoveryCodeStrings> = {
  en: {
    title: 'Enter recovery code',
    explanation: "We've sent a password recovery code to",
    errorTitle: "Couldn't verify code",
    verify: 'Verify code',
    verifying: 'Verifying...',
    didntReceive: "Didn't receive it?",
    resendCode: 'Resend code',
    resending: 'Sending...',
    resendSentBody: 'A new code has been sent.',
    resendInSeconds: (s: number) => `Resend in ${s}s`,
    tooManyAttempts: 'Too many incorrect attempts. Please request a new code.',
    backToLogin: 'Back to Login',
  },
  fil: {
    title: 'Ilagay ang recovery code',
    explanation: 'Nagpadala kami ng password recovery code sa',
    errorTitle: 'Hindi na-verify ang code',
    verify: 'I-verify ang code',
    verifying: 'Vine-verify...',
    didntReceive: 'Hindi natanggap?',
    resendCode: 'Ipadala ulit ang code',
    resending: 'Nagpapadala...',
    resendSentBody: 'Naipadala na ang bagong code.',
    resendInSeconds: (s: number) => `Ipadala ulit sa ${s}s`,
    tooManyAttempts: 'Sobra na ang maling pagsubok. Pakihiling ng bagong code.',
    backToLogin: 'Bumalik sa Pag-log in',
  },
};

const RESET_PASSWORD: Record<AppLanguage, ResetPasswordStrings> = {
  en: {
    title: 'Set a new password',
    forEmail: 'for ',
    passwordUpdated: 'Your password has been updated.',
    newPasswordLabel: 'New password',
    confirmNewPasswordLabel: 'Confirm new password',
    passwordTooShort: 'Password must be at least 8 characters.',
    passwordsMismatch: 'Passwords do not match.',
    updatePassword: 'Update password',
    couldntUpdateTitle: "Couldn't update password",
    logIn: 'Log in',
  },
  fil: {
    title: 'Magtakda ng bagong password',
    forEmail: 'para sa ',
    passwordUpdated: 'Na-update na ang iyong password.',
    newPasswordLabel: 'Bagong password',
    confirmNewPasswordLabel: 'Kumpirmahin ang bagong password',
    passwordTooShort: 'Dapat hindi bababa sa 8 na karakter ang password.',
    passwordsMismatch: 'Hindi magkatugma ang mga password.',
    updatePassword: 'I-update ang password',
    couldntUpdateTitle: 'Hindi na-update ang password',
    logIn: 'Mag-log in',
  },
};

const EMAIL_VERIFICATION: Record<AppLanguage, EmailVerificationStrings> = {
  en: {
    title: 'Verify your email',
    explanation: "We've sent a verification code to",
    errorTitle: "Couldn't verify code",
    verify: 'Verify',
    verifying: 'Verifying...',
    didntReceive: "Didn't receive it?",
    resendCode: 'Resend code',
    resending: 'Sending...',
    resendSentBody: 'A new code has been sent.',
    resendInSeconds: (s: number) => `Resend in ${s}s`,
    backToLogin: 'Back to Login',
  },
  fil: {
    title: 'I-verify ang iyong email',
    explanation: 'Nagpadala kami ng verification code sa',
    errorTitle: 'Hindi na-verify ang code',
    verify: 'I-verify',
    verifying: 'Vine-verify...',
    didntReceive: 'Hindi natanggap?',
    resendCode: 'Ipadala ulit ang code',
    resending: 'Nagpapadala...',
    resendSentBody: 'Naipadala na ang bagong code.',
    resendInSeconds: (s: number) => `Ipadala ulit sa ${s}s`,
    backToLogin: 'Bumalik sa Pag-log in',
  },
};

export function getLoginStrings(lang: AppLanguage): LoginStrings {
  return LOGIN[lang];
}

export function getRegisterStrings(lang: AppLanguage): RegisterStrings {
  return REGISTER[lang];
}

export function getForgotPasswordStrings(lang: AppLanguage): ForgotPasswordStrings {
  return FORGOT_PASSWORD[lang];
}

export function getRecoveryCodeStrings(lang: AppLanguage): RecoveryCodeStrings {
  return RECOVERY_CODE[lang];
}

export function getResetPasswordStrings(lang: AppLanguage): ResetPasswordStrings {
  return RESET_PASSWORD[lang];
}

export function getEmailVerificationStrings(lang: AppLanguage): EmailVerificationStrings {
  return EMAIL_VERIFICATION[lang];
}

// Shared across every screen that opens the Settings sheet — same label
// Welcome/Onboarding already use, kept in one place instead of repeating
// it in every screen's own strings interface.
const SETTINGS_TITLE: Record<AppLanguage, string> = { en: 'Settings', fil: 'Mga Setting' };

export function getSettingsTitle(lang: AppLanguage): string {
  return SETTINGS_TITLE[lang];
}
