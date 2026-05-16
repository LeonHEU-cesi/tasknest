'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiClientError, apiGet, apiPatch } from '@/lib/api-client';

// US-US-01 — Profil aligné sur le schéma Better Auth (name/image/emailVerified).
interface Profile {
  id: string;
  email: string;
  name: string;
  locale: 'fr' | 'en';
  timezone: string;
  image: string | null;
  emailVerified: boolean;
}

interface UpdateBody {
  name?: string;
  locale?: 'fr' | 'en';
  timezone?: string;
  image?: string;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [locale, setLocale] = useState<'fr' | 'en'>('fr');
  const [timezone, setTimezone] = useState('Europe/Paris');
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<Profile>('/me')
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setName(data.name);
        setLocale(data.locale);
        setTimezone(data.timezone);
        setStatus('idle');
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus('error');
        if (error instanceof ApiClientError && error.status === 401) {
          setErrorMessage('You need to sign in to access your settings.');
        } else {
          setErrorMessage('Unable to load your profile.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('saving');
    setErrorMessage(null);

    try {
      const updated = await apiPatch<UpdateBody, Profile>('/me', { name, locale, timezone });
      setProfile(updated);
      setStatus('saved');
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Unexpected error, please retry.',
      );
    }
  };

  if (status === 'loading') {
    return (
      <main style={pageStyle}>
        <p>Loading your settings…</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={pageStyle}>
        <p style={{ color: '#c0392b' }}>{errorMessage ?? 'Profile unavailable.'}</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>Settings</h1>
      <p style={{ opacity: 0.8 }}>Signed in as {profile.email}</p>

      <form onSubmit={handleSubmit} noValidate style={formStyle}>
        <label style={labelStyle}>
          Display name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Language
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as 'fr' | 'en')}
            style={inputStyle}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
        <label style={labelStyle}>
          Timezone (IANA)
          <input
            type="text"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            required
            maxLength={64}
            style={inputStyle}
          />
          <small>Examples: Europe/Paris, America/New_York, Asia/Tokyo</small>
        </label>
        <button
          type="submit"
          disabled={status === 'saving'}
          style={{ ...buttonStyle, opacity: status === 'saving' ? 0.6 : 1 }}
        >
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
        {status === 'saved' ? <p style={{ color: '#2e7d32' }}>Profile updated.</p> : null}
        {status === 'error' && errorMessage ? <p style={errorStyle}>{errorMessage}</p> : null}
      </form>
    </main>
  );
}

const pageStyle = {
  padding: '2rem',
  maxWidth: '560px',
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
