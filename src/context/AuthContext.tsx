'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/supabase/client';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // État d'auth : abonnement monté UNE SEULE FOIS (plus de re-souscription / re-getSession
  // à chaque navigation, qui relançait toute la cascade user → shop → emplacement → fetch).
  // On dédoublonne `user` par id : Supabase émet plusieurs events au démarrage
  // (INITIAL_SESSION, parfois TOKEN_REFRESHED) ; sans ça chaque event recréait un nouvel
  // objet `user` et déclenchait des refetch inutiles partout dans l'app.
  useEffect(() => {
    const apply = (s: Session | null) => {
      setSession(s);
      const nextId = s?.user?.id ?? null;
      setUser((prev) => (prev?.id === nextId ? prev : s?.user ?? null));
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data: { session } }) => apply(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        apply(session);
        if (event === 'SIGNED_OUT') {
          router.push('/login');
        }
      }
    );

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Garde de route : redirige vers /login si non authentifié. Effet séparé et léger —
  // se ré-évalue à chaque navigation sans toucher à l'abonnement auth.
  useEffect(() => {
    if (loading) return;
    const publicPaths = ['/login', '/signup'];
    if (!session && !publicPaths.includes(pathname)) {
      router.push('/login');
    }
  }, [loading, session, pathname, router]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
