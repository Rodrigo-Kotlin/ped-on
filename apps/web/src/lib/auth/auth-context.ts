import { createContext, useContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export type OnboardingStatus = 'pending' | 'completed';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  onboarding_status: OnboardingStatus;
  created_at: string;
  updated_at: string;
}

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthContextValue {
  authStatus: AuthStatus;
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{
    error: string | null;
    needsEmailConfirmation: boolean;
  }>;
  signOut: () => Promise<void>;
  completeOnboarding: (organizationName: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  }
  return context;
}
