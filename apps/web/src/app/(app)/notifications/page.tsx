'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

// US-NO-05 — Centre de notifications : liste + mark-as-read.
interface Notif {
  id: string;
  type: string;
  channel: string;
  payload: { title?: string } & Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiGet<{ items: Notif[]; unreadCount: number }>('/notifications')
      .then((r) => {
        setItems(r.items);
        setUnread(r.unreadCount);
      })
      .catch(() => setError('Sign in to see notifications.'));

  useEffect(() => {
    void load();
  }, []);

  const markRead = async (id: string) => {
    await apiPatch(`/notifications/${id}/read`, {});
    await load();
  };
  const markAll = async () => {
    await apiPost('/notifications/read-all', {});
    await load();
  };

  if (error) return <main className="p-6 text-red-600">{error}</main>;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <span className="text-sm text-[var(--color-muted)]">({unread} unread)</span>
        <button
          type="button"
          onClick={markAll}
          className="ml-auto rounded border border-[var(--color-border)] px-3 py-1 text-sm"
        >
          Mark all read
        </button>
      </header>

      <ul className="mt-6 flex flex-col gap-2">
        {items.length === 0 ? (
          <li className="text-[var(--color-muted)]">No notifications.</li>
        ) : (
          items.map((n) => (
            <li
              key={n.id}
              data-testid="notif"
              className={`flex items-center gap-3 rounded border border-[var(--color-border)] p-3 text-sm ${
                n.readAt ? 'opacity-50' : ''
              }`}
            >
              <span className="rounded bg-[var(--color-border)]/40 px-2 text-xs">{n.type}</span>
              <span>{n.payload?.title ?? n.type}</span>
              {!n.readAt ? (
                <button
                  type="button"
                  onClick={() => markRead(n.id)}
                  className="ml-auto text-xs underline"
                >
                  Mark read
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
