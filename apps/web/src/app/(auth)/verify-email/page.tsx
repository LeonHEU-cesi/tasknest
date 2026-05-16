'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// US-AU-02 — Page de retour après vérification. Le lien e-mail pointe sur
// l'API Better Auth (GET /verify-email) qui valide le token puis redirige
// ici (callbackURL). On reflète juste le résultat ; en cas d'erreur Better
// Auth ajoute `?error=...`.
export default function VerifyEmailPage() {
  return (
    <main style={pageStyle}>
      <h1>Email verification</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <VerifyEmailResult />
      </Suspense>
    </main>
  );
}

function VerifyEmailResult() {
  const params = useSearchParams();
  const error = params.get('error');

  if (error) {
    return (
      <p style={{ color: '#c0392b' }}>
        Verification failed ({error}). The link may have expired — request a new one from the
        sign-in page.
      </p>
    );
  }

  return <p>Your email is confirmed. You can now sign in.</p>;
}

const pageStyle = {
  padding: '2rem',
  maxWidth: '480px',
  margin: '0 auto',
  fontFamily: 'system-ui, sans-serif',
} as const;
