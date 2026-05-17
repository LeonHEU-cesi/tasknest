'use client';

import { useEffect, useState, type FormEvent } from 'react';
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

interface CaldavStatus {
  connected: boolean;
  kind?: string;
  url?: string;
}

// US-SY-07 — CalDAV : pas de bouton OAuth, un formulaire (URL + identifiant
// + app-password). Le mot de passe est chiffré au repos côté serveur.
function CaldavCard() {
  const [status, setStatus] = useState<CaldavStatus | null>(null);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    apiGet<CaldavStatus>('/integrations/caldav/status')
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));

  useEffect(() => {
    void refresh();
  }, []);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await apiPost<
        { url: string; username: string; password: string },
        CaldavStatus
      >('/integrations/caldav/connect', { url, username, password });
      setStatus(next);
      setPassword('');
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Could not connect CalDAV.',
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await apiDelete('/integrations/caldav');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mt-4 rounded border border-[var(--color-border)] p-4"
      data-testid="integration-caldav"
    >
      <p className="font-medium">CalDAV (iCloud, Nextcloud, Samsung…)</p>
      <p className="text-sm text-[var(--color-muted)]" data-testid="caldav-state">
        {status?.connected
          ? `Connected (${status.kind ?? 'generic'})`
          : 'Not connected'}
      </p>

      {status?.connected ? (
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="mt-3 rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-60"
        >
          Disconnect
        </button>
      ) : (
        <form onSubmit={connect} className="mt-3 flex flex-col gap-2">
          <input
            type="url"
            required
            placeholder="CalDAV calendar URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="rounded border border-[var(--color-border)] px-2 py-1"
          />
          <input
            type="text"
            required
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded border border-[var(--color-border)] px-2 py-1"
          />
          <input
            type="password"
            required
            placeholder="App password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-[var(--color-border)] px-2 py-1"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-60"
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      )}
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        The app password is encrypted at rest and only used to reach your
        CalDAV server.
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
      <CaldavCard />
    </main>
  );
}
