'use client';

import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

// US-SEC-02 — Écran de challenge 2FA après l'étape 1 (mot de passe / magic
// link / OAuth). Accepte un code TOTP (6 chiffres) OU un code de
// récupération (usage unique).
export default function TwoFactorChallengePage() {
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('submitting');
    setError(null);

    const { error: err } =
      mode === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });

    if (err) {
      setStatus('idle');
      setError(
        mode === 'totp'
          ? 'Invalid code. Check your authenticator app.'
          : 'Invalid or already-used recovery code.',
      );
      return;
    }
    setStatus('success');
  };

  if (status === 'success') {
    return (
      <main style={pageStyle}>
        <h1>Verified</h1>
        <p>You&apos;re signed in. The dashboard arrives in upcoming sprints.</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>Two-factor verification</h1>
      <p>
        {mode === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of your recovery codes (each works once).'}
      </p>

      <form onSubmit={handleSubmit} noValidate style={formStyle}>
        <label style={labelStyle}>
          {mode === 'totp' ? 'Authenticator code' : 'Recovery code'}
          <input
            type="text"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoComplete="one-time-code"
            style={inputStyle}
          />
        </label>
        <button
          type="submit"
          disabled={status === 'submitting'}
          style={{ ...buttonStyle, opacity: status === 'submitting' ? 0.6 : 1 }}
        >
          {status === 'submitting' ? 'Verifying…' : 'Verify'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'totp' ? 'recovery' : 'totp');
          setCode('');
          setError(null);
        }}
        style={{ ...buttonStyle, marginTop: '0.75rem' }}
      >
        {mode === 'totp' ? 'Use a recovery code instead' : 'Use authenticator code instead'}
      </button>

      {error ? <p style={errorStyle}>{error}</p> : null}
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
  marginTop: '1rem',
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
const errorStyle = { color: '#c0392b', margin: '1rem 0 0' } as const;
