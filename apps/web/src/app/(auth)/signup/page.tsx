'use client';

import { useState, type FormEvent } from 'react';
import { signIn, signUp } from '@/lib/auth-client';

// US-AU-01 / US-AU-05 — Création de compte e-mail/mot de passe (vérification
// e-mail requise) + « Continue with Google ».
export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callbackURL =
    typeof window !== 'undefined' ? `${window.location.origin}/settings` : '/settings';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('submitting');
    setErrorMessage(null);

    const { error } = await signUp.email({ email, password, name });
    if (error) {
      setStatus('idle');
      setErrorMessage(error.message ?? 'Unexpected error, please retry.');
      return;
    }
    setStatus('success');
  };

  const handleSocial = async (provider: 'google' | 'microsoft' | 'apple') => {
    setErrorMessage(null);
    await signIn.social({ provider, callbackURL });
  };

  if (status === 'success') {
    return (
      <main style={pageStyle}>
        <h1>Almost there!</h1>
        <p>
          We&apos;ve sent a verification link to <strong>{email}</strong>. Click it to activate
          your account.
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>Create your Tasknest account</h1>

      <div style={socialStyle}>
        <button type="button" onClick={() => handleSocial('google')} style={buttonStyle}>
          Continue with Google
        </button>
        <button type="button" onClick={() => handleSocial('microsoft')} style={buttonStyle}>
          Continue with Microsoft
        </button>
        <button type="button" onClick={() => handleSocial('apple')} style={buttonStyle}>
          Sign in with Apple
        </button>
      </div>

      <p style={{ textAlign: 'center', opacity: 0.6, margin: '1rem 0' }}>or</p>

      <form onSubmit={handleSubmit} noValidate style={formStyle}>
        <label style={labelStyle}>
          Display name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            autoComplete="name"
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
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
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />
          <small>At least 8 characters.</small>
        </label>

        <button
          type="submit"
          disabled={status === 'submitting'}
          style={{ ...buttonStyle, opacity: status === 'submitting' ? 0.6 : 1 }}
        >
          {status === 'submitting' ? 'Creating account…' : 'Create account'}
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

const socialStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
} as const;
