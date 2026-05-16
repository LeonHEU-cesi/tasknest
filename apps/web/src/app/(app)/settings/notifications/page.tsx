'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

// US-NO-01/06 — Préférences notifications + activation Web Push.
interface Prefs {
  notifyReminders: boolean;
  notifyDigest: boolean;
  notifyWebPush: boolean;
  notifyEmail: boolean;
}

const LABELS: Record<keyof Prefs, string> = {
  notifyReminders: 'Due-date reminders',
  notifyDigest: 'Daily email digest',
  notifyWebPush: 'Web push notifications',
  notifyEmail: 'Email notifications',
};

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Prefs>('/me/notification-prefs')
      .then(setPrefs)
      .catch(() => setError('Sign in to manage notifications.'));
  }, []);

  const toggle = async (key: keyof Prefs) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await apiPatch('/me/notification-prefs', { [key]: next[key] });
  };

  const enablePush = async () => {
    setPushMsg(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushMsg('Push not supported by this browser.');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const { publicKey } = await apiGet<{ publicKey: string }>('/push/vapid-public-key');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await apiPost('/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      setPushMsg('Web push enabled on this device.');
    } catch {
      setPushMsg('Could not enable web push (permission denied or unsupported).');
    }
  };

  if (error) return <main className="p-6 text-red-600">{error}</main>;
  if (!prefs) return <main className="p-6">Loading…</main>;

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Notifications</h1>

      <section className="mt-6 flex flex-col gap-3">
        {(Object.keys(LABELS) as (keyof Prefs)[]).map((key) => (
          <label key={key} className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs[key]}
              onChange={() => toggle(key)}
              aria-label={LABELS[key]}
            />
            <span>{LABELS[key]}</span>
          </label>
        ))}
      </section>

      <section className="mt-8">
        <button
          type="button"
          onClick={enablePush}
          className="rounded border border-[var(--color-border)] px-3 py-1"
        >
          Enable web push on this device
        </button>
        {pushMsg ? <p className="mt-2 text-sm text-[var(--color-muted)]">{pushMsg}</p> : null}
      </section>
    </main>
  );
}
