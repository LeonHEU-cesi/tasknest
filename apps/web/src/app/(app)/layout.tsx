import Link from 'next/link';
import type { ReactNode } from 'react';

// Sprint 7 — Coquille de l'app authentifiée : barre latérale + zone
// principale. Styles Tailwind (fin des styles inline).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-[var(--color-border)] p-4">
        <Link href="/tasks" className="block text-lg font-semibold">
          Tasknest
        </Link>
        <nav className="mt-6 flex flex-col gap-1 text-sm">
          <Link href="/tasks" className="rounded px-2 py-1 hover:bg-[var(--color-border)]">
            Tasks
          </Link>
          <Link href="/calendar" className="rounded px-2 py-1 hover:bg-[var(--color-border)]">
            Calendar
          </Link>
          <Link href="/settings" className="rounded px-2 py-1 hover:bg-[var(--color-border)]">
            Settings
          </Link>
          <Link href="/security" className="rounded px-2 py-1 hover:bg-[var(--color-border)]">
            Security
          </Link>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
