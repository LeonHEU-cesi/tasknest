'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiClientError, apiPost } from '@/lib/api-client';

interface VerifyEmailResponse {
  id: string;
  email: string;
  alreadyVerified: boolean;
}

interface VerifyEmailBody {
  token: string;
}

export default function VerifyEmailPage() {
  return (
    <main style={pageStyle}>
      <h1>Email verification</h1>
      <Suspense fallback={<p>Verifying your email…</p>}>
        <VerifyEmailContent />
      </Suspense>
    </main>
  );
}

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'already' | 'error'>(
    'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Missing verification token.');
      return;
    }

    let cancelled = false;
    setStatus('verifying');

    apiPost<VerifyEmailBody, VerifyEmailResponse>('/auth/verify-email', { token })
      .then((response) => {
        if (cancelled) return;
        setEmail(response.email);
        setStatus(response.alreadyVerified ? 'already' : 'success');
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Unexpected error, please retry.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === 'verifying' || status === 'idle') {
    return <p>Verifying your email…</p>;
  }

  if (status === 'success') {
    return (
      <p>
        Email <strong>{email}</strong> confirmed. You can now sign in.
      </p>
    );
  }

  if (status === 'already') {
    return (
      <p>
        Email <strong>{email}</strong> was already confirmed earlier — nothing to do.
      </p>
    );
  }

  return <p style={{ color: '#c0392b' }}>{errorMessage ?? 'Verification failed.'}</p>;
}

const pageStyle = {
  padding: '2rem',
  maxWidth: '480px',
  margin: '0 auto',
  fontFamily: 'system-ui, sans-serif',
} as const;
