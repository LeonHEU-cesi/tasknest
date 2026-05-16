'use client';

import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { authClient } from '@/lib/auth-client';

// US-SEC-01 — Activation de la 2FA TOTP : QR code (Google Authenticator,
// Authy…), validation d'un code à 6 chiffres avant activation, 10 codes
// de récupération à conserver.
export default function SecurityPage() {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [step, setStep] = useState<'idle' | 'pending' | 'enabled'>('idle');
  const [error, setError] = useState<string | null>(null);

  const startEnable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({ password });
    if (err || !data) {
      setError(err?.message ?? 'Could not start 2FA setup. Check your password.');
      return;
    }
    setBackupCodes(data.backupCodes ?? []);
    setQr(await QRCode.toDataURL(data.totpURI));
    setStep('pending');
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code });
    if (err) {
      setError('Invalid code. Open your authenticator app and try the current 6-digit code.');
      return;
    }
    setStep('enabled');
  };

  if (step === 'enabled') {
    return (
      <main style={pageStyle}>
        <h1>Two-factor authentication enabled</h1>
        <p>
          Your account is now protected by TOTP. You&apos;ll be asked for a code at every sign-in.
          Keep your recovery codes safe — each works once if you lose your device.
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>Security — Two-factor authentication</h1>

      {step === 'idle' ? (
        <form onSubmit={startEnable} noValidate style={formStyle}>
          <p>Confirm your password to start enabling 2FA.</p>
          <label style={labelStyle}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={inputStyle}
            />
          </label>
          <button type="submit" style={buttonStyle}>
            Start 2FA setup
          </button>
        </form>
      ) : (
        <>
          <p>Scan this QR code with your authenticator app:</p>
          {qr ? <img src={qr} alt="TOTP QR code" width={200} height={200} /> : null}

          <h2 style={{ fontSize: '1rem' }}>Recovery codes (store them now)</h2>
          <ul style={{ fontFamily: 'monospace', lineHeight: 1.7 }}>
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>

          <form onSubmit={confirm} noValidate style={formStyle}>
            <label style={labelStyle}>
              Enter the 6-digit code to confirm
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                style={inputStyle}
              />
            </label>
            <button type="submit" style={buttonStyle}>
              Confirm & enable
            </button>
          </form>
        </>
      )}

      {error ? <p style={errorStyle}>{error}</p> : null}
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
