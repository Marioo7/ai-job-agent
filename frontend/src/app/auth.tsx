
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';

import { DEMO, auth } from '../services/firebase';

interface AuthState {
  user: { email: string | null } | null;
  loading: boolean;
  signInEmail: (e: string, p: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState['user']>(
    DEMO ? { email: 'demo' } : null,
  );

  const [loading, setLoading] = useState(!DEMO);

  useEffect(() => {
    if (DEMO || !auth) {
      setLoading(false);
      return;
    }

    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser ? { email: firebaseUser.email } : null);
      setLoading(false);
    });
  }, []);

  const need = () => {
    if (!auth) {
      throw new Error(
        'Firebase is not configured. Fill the VITE_FIREBASE_* variables (see README).',
      );
    }

    return auth;
  };

  const value: AuthState = {
    user,
    loading,

    signInEmail: async (email, password) => {
      await signInWithEmailAndPassword(need(), email, password);
    },

    signInGoogle: async () => {
      await signInWithPopup(need(), new GoogleAuthProvider());
    },

    sendVerificationEmail: async () => {
      const currentUser = need().currentUser;

      if (!currentUser) {
        throw new Error('Please sign in before requesting email verification.');
      }

      if (currentUser.emailVerified) {
        throw new Error('Your email address is already verified.');
      }

      await sendEmailVerification(currentUser);
    },

    logout: async () => {
      if (auth) {
        await signOut(auth);
      }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
