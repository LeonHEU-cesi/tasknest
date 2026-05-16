'use client';

import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

// US-AU-04 — Demande de réinitialisation. Message neutre quel que soit le
// résultat (anti-énumération). redirectTo = page /reset côté web.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('submitting');
    setErrorMessage(null);

    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/reset` : '/reset';
    const { error } = await authClient.requestPasswordReset({ email, redirectTo });
    if (error) {
      setStatus('idle');
      setErrorMessage(error.message ?? 'Unexpected error, please retry.');
      return;
    }
    setStatus('success');
  };

  return (
    <main style={pageStyle}>
      <h1>Reset your password</h1>

      {status === 'success' ? (
        <p>
          If <strong>{email}</strong> matches a Tasknest account, we&apos;ve sent a reset link.
          Check your inbox.
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate style={formStyle}>
          <p>Enter the email address linked to your account.</p>
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
          <button
            type="submit"
            disabled={status === 'submitting'}
            style={{ ...buttonStyle, opacity: status === 'submitting' ? 0.6 : 1 }}
          >
            {status === 'submitting' ? 'Sending…' : 'Send reset link'}
          </button>
          {errorMessage ? <p style={errorStyle}>{errorMessage}</p> : null}
        </form>
      )}
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
  marginTop: '1.5rem',
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
} as const;
const errorStyle = { color: '#c0392b', margin: 0 } as const;
