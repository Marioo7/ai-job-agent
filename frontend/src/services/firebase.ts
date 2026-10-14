import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = !!(cfg.apiKey && cfg.projectId);
export const auth = !DEMO && firebaseConfigured ? getAuth(initializeApp(cfg)) : null;
