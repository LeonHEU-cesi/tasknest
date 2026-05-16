'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useVirtualizer } from '@tanstack/react-virtual';
import { apiGet } from '@/lib/api-client';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type GroupBy,
  type Named,
  type Task,
} from '@/lib/api-types';

// US-VW-01/02 — Vue Liste : virtual scroll (grosses listes) + groupements
// collapsables (statut / priorité / tag).
type Row = { kind: 'header'; key: string; label: string; count: number } | { kind: 'task'; task: Task };

export default function TasksListPage() {
  const [projects, setProjects] = useState<Named[]>([]);
  const [lists, setLists] = useState<Named[]>([]);
  const [projectId, setProjectId] = useState('');
  const [listId, setListId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Named[]>('/projects')
      .then(setProjects)
      .catch(() => setError('Sign in to see your tasks.'));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    apiGet<Named[]>(`/projects/${projectId}/lists`).then(setLists);
    setListId('');
    setTasks([]);
  }, [projectId]);

  useEffect(() => {
    if (!listId) return;
    apiGet<Task[]>(`/lists/${listId}/tasks`).then(setTasks);
  }, [listId]);

  const groups = useMemo(() => groupTasks(tasks, groupBy), [tasks, groupBy]);

  const rows = useMemo<Row[]>(() => {
    if (groupBy === 'none') return tasks.map((task) => ({ kind: 'task', task }));
    const out: Row[] = [];
    for (const g of groups) {
      out.push({ kind: 'header', key: g.key, label: g.label, count: g.tasks.length });
      if (!collapsed.has(g.key)) for (const task of g.tasks) out.push({ kind: 'task', task });
    }
    return out;
  }, [groups, tasks, groupBy, collapsed]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (error) {
    return <p className="text-red-600">{error}</p>;
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">List view</h1>
        <select
          aria-label="Project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
        >
          <option value="">Project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="List"
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
        >
          <option value="">List…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Group by"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          className="ml-auto rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
        >
          <option value="none">No grouping</option>
          <option value="status">Group by status</option>
          <option value="priority">Group by priority</option>
          <option value="tag">Group by tag</option>
        </select>
        {listId ? (
          <Link
            href={`/kanban?listId=${listId}`}
            className="rounded border border-[var(--color-border)] px-3 py-1 text-sm"
          >
            Kanban →
          </Link>
        ) : null}
      </header>

      <div
        ref={parentRef}
        data-testid="task-scroll"
        className="flex-1 overflow-auto rounded border border-[var(--color-border)]"
      >
        {rows.length === 0 ? (
          <p className="p-4 text-[var(--color-muted)]">Pick a list to see its tasks.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  className="absolute left-0 w-full"
                  style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                >
                  {row.kind === 'header' ? (
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      className="flex w-full items-center gap-2 bg-[var(--color-border)]/40 px-3 py-2 text-left text-sm font-medium"
                    >
                      <span>{collapsed.has(row.key) ? '▸' : '▾'}</span>
                      <span>{row.label}</span>
                      <span className="text-[var(--color-muted)]">({row.count})</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 text-sm">
                      <span
                        className={
                          row.task.status === 'done'
                            ? 'line-through text-[var(--color-muted)]'
                            : ''
                        }
                      >
                        {row.task.title}
                      </span>
                      <span className="ml-auto text-xs text-[var(--color-muted)]">
                        {STATUS_LABELS[row.task.status]}
                      </span>
                      {row.task.tags.map((t) => (
                        <span
                          key={t.id}
                          className="rounded-full border border-[var(--color-border)] px-2 text-xs"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function groupTasks(tasks: Task[], groupBy: GroupBy) {
  if (groupBy === 'none') return [];
  const map = new Map<string, { key: string; label: string; tasks: Task[] }>();
  const push = (key: string, label: string, task: Task) => {
    const g = map.get(key) ?? { key, label, tasks: [] };
    g.tasks.push(task);
    map.set(key, g);
  };
  for (const task of tasks) {
    if (groupBy === 'status') push(task.status, STATUS_LABELS[task.status], task);
    else if (groupBy === 'priority')
      push(`p${task.priority}`, PRIORITY_LABELS[task.priority] ?? `P${task.priority}`, task);
    else if (task.tags.length === 0) push('untagged', 'Untagged', task);
    else for (const tag of task.tags) push(`tag:${tag.id}`, tag.name, task);
  }
  return [...map.values()];
}
