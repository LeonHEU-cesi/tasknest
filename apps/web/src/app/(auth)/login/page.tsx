'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from '@/lib/auth-client';

// US-AU-03 / US-AU-05 — Connexion e-mail/mot de passe + « Continue with
// Google » (OAuth 2.0). La session est posée par Better Auth (cookie).
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callbackURL =
    typeof window !== 'undefined' ? `${window.location.origin}/settings` : '/settings';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('submitting');
    setErrorMessage(null);

    const { error } = await signIn.email({ email, password });
    if (error) {
      setStatus('idle');
      if (error.status === 403) {
        setErrorMessage('Please confirm your email before signing in.');
      } else if (error.status === 401) {
        setErrorMessage('Invalid email or password.');
      } else {
        setErrorMessage(error.message ?? 'Unexpected error, please retry.');
      }
      return;
    }
    setStatus('success');
  };

  const handleGoogle = async () => {
    setErrorMessage(null);
    await signIn.social({ provider: 'google', callbackURL });
  };

  if (status === 'success') {
    return (
      <main style={pageStyle}>
        <h1>You&apos;re signed in</h1>
        <p>The dashboard arrives in upcoming sprints.</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>Sign in to Tasknest</h1>

      <button type="button" onClick={handleGoogle} style={buttonStyle}>
        Continue with Google
      </button>

      <p style={{ textAlign: 'center', opacity: 0.6, margin: '1rem 0' }}>or</p>

      <form onSubmit={handleSubmit} noValidate style={formStyle}>
        <label style={labelStyle}>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
            style={inputStyle}
          />
        </label>

        <button
          type="submit"
          disabled={status === 'submitting'}
          style={{ ...buttonStyle, opacity: status === 'submitting' ? 0.6 : 1 }}
        >
          {status === 'submitting' ? 'Signing in…' : 'Sign in'}
        </button>

        {errorMessage ? <p style={errorStyle}>{errorMessage}</p> : null}
      </form>
    </main>
  );
}

const pageStyle = {
  padding: '2rem',
  maxWidth: '480px',
  margin: '0 auto',
  fontFamily: 'system-ui, sans-serif',
} as const;

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
} as const;

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.95rem',
} as const;

const inputStyle = {
  padding: '0.5rem 0.75rem',
  borderRadius: '6px',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  fontSize: '1rem',
} as const;

const buttonStyle = {
  padding: '0.75rem 1rem',
  borderRadius: '6px',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: '1rem',
  fontWeight: 600,
  width: '100%',
} as const;

const errorStyle = {
  color: '#c0392b',
  margin: 0,
} as const;
