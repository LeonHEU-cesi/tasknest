'use client';

import { useEffect, useState } from 'react';
import { ApiClientError, apiDelete, apiGet, apiPost } from '@/lib/api-client';

// US-SY-01 — Connexion de l'agenda Google. Le consentement OAuth (scopes
// calendar) a été donné au sign-in Google ; ce bouton ne fait que
// matérialiser/activer la synchronisation côté Tasknest.
interface GoogleStatus {
  connected: boolean;
  calendarId?: string;
  connectedAt?: string;
  lastSyncedAt?: string | null;
}

export default function IntegrationsPage() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    apiGet<GoogleStatus>('/integrations/google/status')
      .then(setStatus)
      .catch((e) =>
        setError(
          e instanceof ApiClientError && e.status === 401
            ? 'Sign in to manage integrations.'
            : 'Unable to load integration status.',
        ),
      );

  useEffect(() => {
    void refresh();
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiPost<undefined, GoogleStatus>(
        '/integrations/google/connect',
        undefined,
      );
      setStatus(next);
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : 'Could not connect Google Calendar.',
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete('/integrations/google');
      await refresh();
    } catch {
      setError('Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl p-6" data-testid="integrations">
      <h1 className="text-xl font-semibold">Integrations</h1>

      <section className="mt-6 rounded border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Google Calendar</p>
            <p className="text-sm text-[var(--color-muted)]" data-testid="google-state">
              {status?.connected
                ? `Connected (${status.calendarId ?? 'primary'})`
                : 'Not connected'}
            </p>
          </div>
          {status?.connected ? (
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-60"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-60"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Tasks with a due date are pushed to your Google Calendar and changes
          made in Google are synced back.
        </p>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </section>
    </main>
  );
}
