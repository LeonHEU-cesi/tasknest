'use client';

import { useState, type FormEvent } from 'react';
import { ApiClientError, apiPost } from '@/lib/api-client';

interface LoginResponse {
  id: string;
  email: string;
  displayName: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<LoginResponse | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('submitting');
    setErrorMessage(null);

    try {
      const response = await apiPost<LoginBody, LoginResponse>('/auth/login', { email, password });
      setWelcome(response);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      if (error instanceof ApiClientError && error.status === 403) {
        setErrorMessage('Please confirm your email before signing in.');
      } else if (error instanceof ApiClientError && error.status === 401) {
        setErrorMessage('Invalid email or password.');
      } else {
        setErrorMessage('Unexpected error, please retry.');
      }
    }
  };

  if (status === 'success' && welcome) {
    return (
      <main style={pageStyle}>
        <h1>Welcome back, {welcome.displayName}!</h1>
        <p>
          You are signed in as <strong>{welcome.email}</strong>. The dashboard arrives in upcoming
          sprints.
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>Sign in to Tasknest</h1>

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

const errorStyle = {
  color: '#c0392b',
  margin: 0,
} as const;
