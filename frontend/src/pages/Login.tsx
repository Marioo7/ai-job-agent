
import { useState } from 'react';
import { Button, Field, Notice } from '../components/ui';
import { useAuth } from '../app/auth';
import { useI18n } from '../i18n';
import { firebaseConfigured, auth } from '../services/firebase';
import { reload } from 'firebase/auth';

export function Login() {
  const { t, lang, setLang } = useI18n();
  const {
    signInEmail,
    signInGoogle,
    sendVerificationEmail,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignIn = async () => {
    await signInEmail(email, password);

    if (auth?.currentUser && !auth.currentUser.emailVerified) {
      setVerificationPending(true);
      setMessage(
        'Your email is not verified yet. Send a verification email, then check your inbox.',
      );
    }
  };

  const handleSendVerification = async () => {
    await sendVerificationEmail();
    setMessage(
      'Verification email sent. Check your inbox and spam folder.',
    );
  };

  const handleCheckVerification = async () => {
    if (!auth?.currentUser) {
      throw new Error('Please sign in again first.');
    }

    await reload(auth.currentUser);

    if (auth.currentUser.emailVerified) {
      setMessage('Email verified. You can continue using the application.');
      setVerificationPending(false);
    } else {
      setMessage(
        'Your email is still not verified. Open the verification link in your email, then try again.',
      );
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Job Agent</h1>

      {!firebaseConfigured && (
        <Notice tone="warn">
          Firebase is not configured. Set the VITE_FIREBASE_* variables,
          or run in demo mode with VITE_DEMO_MODE=true (see README).
        </Notice>
      )}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(handleEmailSignIn);
        }}
      >
        <Field label={t('Email')}>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label={t('Password')}>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error && <Notice tone="bad">{error}</Notice>}
        {message && <Notice tone="warn">{message}</Notice>}

        <Button
          variant="primary"
          type="submit"
          className="w-full"
          disabled={busy}
        >
          {t('Sign in')}
        </Button>
      </form>

      {verificationPending && (
        <div className="space-y-3">
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => void run(handleSendVerification)}
          >
            Send verification email
          </Button>

          <Button
            className="w-full"
            disabled={busy}
            onClick={() => void run(handleCheckVerification)}
          >
            I've verified my email
          </Button>
        </div>
      )}

      <Button
        className="w-full"
        disabled={busy}
        onClick={() => void run(signInGoogle)}
      >
        {t('Sign in with Google')}
      </Button>

      <button
        className="text-sm text-brand underline"
        onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
      >
        {lang === 'ar' ? 'English' : 'العربية'}
      </button>
    </div>
  );
}
