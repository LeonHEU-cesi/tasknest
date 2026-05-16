'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  max as maxDate,
  min as minDate,
  startOfDay,
} from 'date-fns';
import { apiGet, apiPatch } from '@/lib/api-client';
import { STATUS_LABELS, type Named, type Task } from '@/lib/api-types';

type Zoom = 'day' | 'week' | 'month' | 'quarter';
const PX_PER_DAY: Record<Zoom, number> = { day: 36, week: 14, month: 6, quarter: 3 };

// US-VW-07 — Vue Timeline/Gantt : tâches en barres horizontales
// (startAt→dueAt) sur un axe de dates, échelle de zoom.
export default function TimelinePage() {
  const [projects, setProjects] = useState<Named[]>([]);
  const [lists, setLists] = useState<Named[]>([]);
  const [projectId, setProjectId] = useState('');
  const [listId, setListId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [zoom, setZoom] = useState<Zoom>('week');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Named[]>('/projects')
      .then(setProjects)
      .catch(() => setError('Sign in to see your timeline.'));
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

  const scheduled = useMemo(
    () => tasks.filter((t) => t.dueAt || t.startAt),
    [tasks],
  );

  const span = useMemo(() => {
    if (scheduled.length === 0) {
      const today = startOfDay(new Date());
      return { start: today, end: addDays(today, 14) };
    }
    const dates = scheduled.flatMap((t) => [
      startOfDay(new Date(t.startAt ?? t.dueAt!)),
      startOfDay(new Date(t.dueAt ?? t.startAt!)),
    ]);
    return { start: addDays(minDate(dates), -2), end: addDays(maxDate(dates), 2) };
  }, [scheduled]);

  const px = PX_PER_DAY[zoom];
  const totalDays = differenceInCalendarDays(span.end, span.start) + 1;

  const ticks = useMemo(() => {
    const days = eachDayOfInterval({ start: span.start, end: span.end });
    return days.filter((d) => {
      if (zoom === 'day') return true;
      if (zoom === 'week') return d.getDay() === 1;
      if (zoom === 'month') return d.getDate() === 1;
      return d.getDate() === 1 && d.getMonth() % 3 === 0;
    });
  }, [span, zoom]);

  const barFor = (t: Task) => {
    const s = startOfDay(new Date(t.startAt ?? t.dueAt!));
    const e = startOfDay(new Date(t.dueAt ?? t.startAt!));
    const left = differenceInCalendarDays(s, span.start) * px;
    const width = Math.max((differenceInCalendarDays(e, s) + 1) * px, px);
    return { left, width };
  };

  // US-VW-08 (préparé ici, édition complète à l'issue suivante) : décalage
  // accessible d'une tâche d'un jour.
  const nudge = async (t: Task, deltaDays: number) => {
    const s = t.startAt ? addDays(new Date(t.startAt), deltaDays) : undefined;
    const d = t.dueAt ? addDays(new Date(t.dueAt), deltaDays) : undefined;
    setTasks((prev) =>
      prev.map((x) =>
        x.id === t.id
          ? { ...x, startAt: s?.toISOString() ?? null, dueAt: d?.toISOString() ?? null }
          : x,
      ),
    );
    await apiPatch(`/tasks/${t.id}`, {
      ...(s ? { startAt: s.toISOString() } : {}),
      ...(d ? { dueAt: d.toISOString() } : {}),
    });
  };

  // US-VW-08 — redimensionner : décale un seul bord (start OU due).
  const resize = async (t: Task, edge: 'start' | 'due', deltaDays: number) => {
    const base = edge === 'start' ? (t.startAt ?? t.dueAt) : (t.dueAt ?? t.startAt);
    if (!base) return;
    const next = addDays(new Date(base), deltaDays).toISOString();
    const field = edge === 'start' ? 'startAt' : 'dueAt';
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, [field]: next } : x)));
    await apiPatch(`/tasks/${t.id}`, { [field]: next });
  };

  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Timeline</h1>
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
          aria-label="Zoom"
          value={zoom}
          onChange={(e) => setZoom(e.target.value as Zoom)}
          className="ml-auto rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
        >
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="quarter">Quarter</option>
        </select>
      </header>

      <p className="text-xs text-[var(--color-muted)]" data-testid="deps-flag">
        Dependencies between tasks are coming in a later version.
      </p>

      <div
        data-testid="timeline-grid"
        className="flex-1 overflow-auto rounded border border-[var(--color-border)]"
      >
        {scheduled.length === 0 ? (
          <p className="p-4 text-[var(--color-muted)]">
            Pick a list with scheduled tasks (start/due dates).
          </p>
        ) : (
          <div style={{ width: totalDays * px, minWidth: '100%' }}>
            <div
              className="sticky top-0 flex border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-muted)]"
              style={{ height: 24 }}
            >
              {ticks.map((d) => (
                <div
                  key={d.toISOString()}
                  className="absolute border-l border-[var(--color-border)] pl-1"
                  style={{ left: differenceInCalendarDays(d, span.start) * px }}
                >
                  {format(d, zoom === 'day' ? 'd MMM' : zoom === 'quarter' ? 'QQQ yyyy' : 'd MMM')}
                </div>
              ))}
            </div>
            <ul className="relative">
              {scheduled.map((t) => {
                const { left, width } = barFor(t);
                return (
                  <li
                    key={t.id}
                    data-testid="tl-row"
                    className="relative border-b border-[var(--color-border)]"
                    style={{ height: 36 }}
                  >
                    <div
                      data-testid={`bar-${t.id}`}
                      className="absolute top-1 flex items-center gap-1 rounded bg-[var(--color-accent)]/20 px-2 text-xs"
                      style={{ left, width, height: 28 }}
                      title={`${t.title} · ${STATUS_LABELS[t.status]}`}
                    >
                      <button
                        type="button"
                        aria-label={`resize-start-${t.id}`}
                        title="Extend start (−1 day)"
                        onClick={() => resize(t, 'start', -1)}
                      >
                        ⇤
                      </button>
                      <button
                        type="button"
                        aria-label={`move-back-${t.id}`}
                        onClick={() => nudge(t, -1)}
                      >
                        ◀
                      </button>
                      <span className="truncate">{t.title}</span>
                      <button
                        type="button"
                        aria-label={`move-fwd-${t.id}`}
                        className="ml-auto"
                        onClick={() => nudge(t, 1)}
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        aria-label={`resize-due-${t.id}`}
                        title="Extend due (+1 day)"
                        onClick={() => resize(t, 'due', 1)}
                      >
                        ⇥
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
