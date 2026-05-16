'use client';

import { useEffect, useState } from 'react';
import { ApiClientError, apiDelete, apiGet, apiPost } from '@/lib/api-client';

// US-SY-01 / US-SY-04 — Connexion des agendas externes (Google, Outlook).
// Le consentement OAuth (scopes calendar) a été donné au sign-in du
// provider ; ces boutons ne font qu'activer la synchronisation Tasknest.
interface ConnStatus {
  connected: boolean;
  calendarId?: string;
}

function IntegrationCard({
  name,
  slug,
  base,
}: {
  name: string;
  slug: string;
  base: string;
}) {
  const [status, setStatus] = useState<ConnStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    apiGet<ConnStatus>(`${base}/status`)
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
      const next = await apiPost<undefined, ConnStatus>(`${base}/connect`, undefined);
      setStatus(next);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : `Could not connect ${name}.`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(base);
      await refresh();
    } catch {
      setError('Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mt-4 rounded border border-[var(--color-border)] p-4"
      data-testid={`integration-${slug}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-sm text-[var(--color-muted)]" data-testid={`${slug}-state`}>
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
        Tasks with a due date are pushed to {name} and changes made there are
        synced back.
      </p>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}

export default function IntegrationsPage() {
  return (
    <main className="mx-auto max-w-xl p-6" data-testid="integrations">
      <h1 className="text-xl font-semibold">Integrations</h1>
      <IntegrationCard name="Google Calendar" slug="google" base="/integrations/google" />
      <IntegrationCard
        name="Microsoft Outlook"
        slug="microsoft"
        base="/integrations/microsoft"
      />
    </main>
  );
}
