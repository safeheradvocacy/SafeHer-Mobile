import React, { createContext, useState, useEffect, ReactNode } from 'react';
import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import * as authService from '../services/auth';
import { subscribeToAuthRedirects } from '../services/authDeepLink';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  /** True once a password-recovery link has been opened, until the new password is set. */
  isPasswordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    userData: Record<string, unknown>
  ) => Promise<{ user: User | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  clearPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    // supabase-js emits an INITIAL_SESSION event as soon as it finishes
    // reading storage, so a single listener covers both "what's the
    // current session" and "notify me when it changes" — no separate
    // getSession() call needed on mount, and no extra getUser() round trip
    // either, since the session object already carries the user.
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
        if (event === 'PASSWORD_RECOVERY') {
          setIsPasswordRecovery(true);
        }
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setIsLoading(false);
      }
    );

    // Belt-and-suspenders: some RN/Expo setups report INITIAL_SESSION
    // instead of PASSWORD_RECOVERY for a link that's already been applied
    // by the time the listener above registers. Checking the redirect
    // URL's own `type=recovery` param directly doesn't depend on that
    // event firing correctly.
    const unsubscribeRedirect = subscribeToAuthRedirects(
      (result) => {
        if (result === 'recovery') setIsPasswordRecovery(true);
      },
      (error) => console.error('Error handling auth redirect link:', error)
    );

    return () => {
      authListener?.subscription.unsubscribe();
      unsubscribeRedirect();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    await authService.signIn(email, password);
    // onAuthStateChange updates user/session state.
  };

  const signUp = async (email: string, password: string, userData: Record<string, unknown>) => {
    const data = await authService.signUp(email, password, userData);
    return { user: data.user };
  };

  const signOut = async () => {
    await authService.signOut();
  };

  const resetPassword = async (email: string) => {
    await authService.resetPassword(email);
  };

  const updatePassword = async (newPassword: string) => {
    await authService.updatePassword(newPassword);
    setIsPasswordRecovery(false);
  };

  const clearPasswordRecovery = () => setIsPasswordRecovery(false);

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    isPasswordRecovery,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    clearPasswordRecovery,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
