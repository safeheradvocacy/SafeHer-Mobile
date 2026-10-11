import * as LocalAuthentication from 'expo-local-authentication';

/** Whether this device can actually back an App Lock preference — no
 * enrolled Face ID/Touch ID/fingerprint means the toggle would either do
 * nothing or lock the user out with no way back in, so callers should
 * check this before letting someone turn App Lock on. */
export async function isAppLockAvailable(): Promise<boolean> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  } catch {
    return false;
  }
}

export async function authenticate(promptMessage: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancel' });
    if (result.success) return { success: true };
    return { success: false, error: result.error };
  } catch {
    return { success: false, error: 'unknown' };
  }
}
