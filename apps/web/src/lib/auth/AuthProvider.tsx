import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../supabase';
import { AuthContext } from './auth-context';
import type { AuthStatus, Profile } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const currentUserId = useRef<string | null | undefined>(undefined);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (currentUserId.current !== userId) return;
    setProfileLoading(false);
    if (error) {
      console.error('Ped-On: falha ao carregar perfil.', error.message);
      setProfile(null);
      return;
    }
    setProfile((data as Profile | null) ?? null);
  }, []);

  const applySession = useCallback(
    (nextSession: Session | null) => {
      const nextUser = nextSession?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      if (currentUserId.current === undefined) {
        currentUserId.current = nextUserId;
      } else if (currentUserId.current !== nextUserId) {
        currentUserId.current = nextUserId;
        queryClient.clear();
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('pedon:selectedUnitId');
        }
        setProfile(null);
        setProfileLoading(false);
      }
      setSession(nextSession);
      setUser(nextUser);
      setAuthStatus(nextUser === null ? 'signed-out' : 'signed-in');
      if (nextUser === null) {
        setProfile(null);
      } else {
        void loadProfile(nextUser.id);
      }
    },
    [loadProfile, queryClient],
  );

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        applySession(data.session);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        applySession(nextSession);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      return { error: error.message, needsEmailConfirmation: false };
    }
    const needsEmailConfirmation = data.session === null;
    return { error: null, needsEmailConfirmation };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const completeOnboarding = useCallback(
    async (organizationName: string) => {
      const { error } = await supabase.rpc('complete_onboarding', {
        p_organization_name: organizationName,
      });
      if (error) {
        return { error: error.message };
      }
      if (user !== null) {
        await loadProfile(user.id);
      }
      return { error: null };
    },
    [user, loadProfile],
  );

  const refreshProfile = useCallback(async () => {
    if (user !== null) {
      await loadProfile(user.id);
    }
  }, [user, loadProfile]);

  const value = useMemo(
    () => ({
      authStatus,
      user,
      session,
      profile,
      profileLoading,
      signIn,
      signUp,
      signOut,
      completeOnboarding,
      refreshProfile,
    }),
    [
      authStatus,
      user,
      session,
      profile,
      profileLoading,
      signIn,
      signUp,
      signOut,
      completeOnboarding,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
