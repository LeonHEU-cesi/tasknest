'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiClientError, apiPost } from '@/lib/api-client';

interface ResetPasswordBody {
  token: string;
  password: string;
}

interface ResetPasswordResponse {
  id: string;
  email: string;
}

export default function ResetPasswordPage() {
  return (
    <main style={pageStyle}>
      <h1>Choose a new password</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <ResetContent />
      </Suspense>
    </main>
  );
}

function ResetContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!token) {
    return <p style={{ color: '#c0392b' }}>Missing or invalid reset token.</p>;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirm) {
      setErrorMessage('Passwords do not match.');
      setStatus('error');
      return;
    }

    setStatus('submitting');
    setErrorMessage(null);

    try {
      await apiPost<ResetPasswordBody, ResetPasswordResponse>('/auth/reset-password', {
        token,
        password,
      });
      setStatus('success');
    } catch (error) {
      setStatus('error');
      if (error instanceof ApiClientError && error.status === 410) {
        setErrorMessage('This reset link has expired. Please request a new one.');
      } else {
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Unexpected error, please retry.',
        );
      }
    }
  };

  if (status === 'success') {
    return <p>Your password has been updated. You can now sign in with the new one.</p>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={formStyle}>
      <label style={labelStyle}>
        New password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
          style={inputStyle}
        />
        <small>At least 10 characters with upper, lower and a digit.</small>
      </label>
      <label style={labelStyle}>
        Confirm new password
        <input
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
          style={inputStyle}
        />
      </label>
      <button
        type="submit"
        disabled={status === 'submitting'}
        style={{ ...buttonStyle, opacity: status === 'submitting' ? 0.6 : 1 }}
      >
        {status === 'submitting' ? 'Updating…' : 'Update password'}
      </button>
      {errorMessage ? <p style={errorStyle}>{errorMessage}</p> : null}
    </form>
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
