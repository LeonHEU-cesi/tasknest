'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api-client';

// US-NO-05 — Cloche header avec compteur non-lus (poll léger).
export function NotificationBell() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      apiGet<{ unreadCount: number }>('/notifications?limit=1')
        .then((r) => active && setCount(r.unreadCount))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={`Notifications (${count} unread)`}
      className="relative inline-flex items-center"
    >
      <span aria-hidden>🔔</span>
      {count > 0 ? (
        <span
          data-testid="bell-count"
          className="ml-1 rounded-full bg-[var(--color-accent)] px-1.5 text-xs text-white"
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
