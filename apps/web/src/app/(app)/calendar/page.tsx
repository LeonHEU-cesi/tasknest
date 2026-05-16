'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { STATUS_LABELS, type Named, type Task } from '@/lib/api-types';

type CalView = 'month' | 'week' | 'day';

// US-VW-05 — Vue Calendrier (mois/semaine/jour). Tâches positionnées par
// dueAt ; drag d'une tâche sur un jour ⇒ PATCH dueAt ; clic ⇒ détail.
export default function CalendarPage() {
  const [projects, setProjects] = useState<Named[]>([]);
  const [lists, setLists] = useState<Named[]>([]);
  const [projectId, setProjectId] = useState('');
  const [listId, setListId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<CalView>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<Task | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newStart, setNewStart] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Named[]>('/projects')
      .then(setProjects)
      .catch(() => setError('Sign in to see your calendar.'));
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

  const days = useMemo<Date[]>(() => {
    if (view === 'day') return [cursor];
    if (view === 'week')
      return eachDayOfInterval({
        start: startOfWeek(cursor, { weekStartsOn: 1 }),
        end: endOfWeek(cursor, { weekStartsOn: 1 }),
      });
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
    });
  }, [view, cursor]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const key = format(new Date(t.dueAt), 'yyyy-MM-dd');
      const bucket = map.get(key);
      if (bucket) bucket.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [tasks]);

  const shift = (dir: number) =>
    setCursor((c) =>
      view === 'month' ? addMonths(c, dir) : view === 'week' ? addWeeks(c, dir) : addDays(c, dir),
    );

  // Contrainte de distance : un clic (sans déplacement) n'amorce pas de
  // drag ⇒ onClick (ouverture du détail) reste fiable.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const dayKey = e.over?.id ? String(e.over.id) : null;
    if (!dayKey) return;
    const dueAt = new Date(`${dayKey}T12:00:00.000Z`).toISOString();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueAt } : t)));
    await apiPatch(`/tasks/${taskId}`, { dueAt });
  };

  // US-VW-06 — Création depuis un créneau : clic sur un jour ⇒ formulaire
  // (titre + start optionnel pour définir start_at..due_at).
  const submitCreate = async () => {
    if (!listId || !creating || newTitle.trim().length === 0) return;
    const dueAt = new Date(`${creating}T12:00:00.000Z`).toISOString();
    const startAt = newStart
      ? new Date(`${newStart}T12:00:00.000Z`).toISOString()
      : undefined;
    await apiPost(`/lists/${listId}/tasks`, { title: newTitle.trim(), dueAt, startAt });
    setCreating(null);
    setNewTitle('');
    setNewStart('');
    setTasks(await apiGet<Task[]>(`/lists/${listId}/tasks`));
  };

  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Calendar</h1>
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
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => shift(-1)} aria-label="prev">
            ←
          </button>
          <button type="button" onClick={() => setCursor(new Date())}>
            Today
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="next">
            →
          </button>
          <span data-testid="cal-title" className="ml-2 font-medium">
            {format(cursor, view === 'day' ? 'd MMM yyyy' : 'MMMM yyyy')}
          </span>
          <select
            aria-label="Calendar view"
            value={view}
            onChange={(e) => setView(e.target.value as CalView)}
            className="ml-2 rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>
        </div>
      </header>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div
          data-testid="cal-grid"
          className={`grid flex-1 gap-px overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-border)] ${
            view === 'day' ? 'grid-cols-1' : 'grid-cols-7'
          }`}
        >
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            return (
              <DayCell
                key={key}
                day={day}
                dimmed={view === 'month' && !isSameMonth(day, cursor)}
                tasks={tasksByDay.get(key) ?? []}
                onSelect={setSelected}
                onCreate={listId ? setCreating : undefined}
              />
            );
          })}
        </div>
      </DndContext>

      {selected ? (
        <aside
          data-testid="task-detail"
          className="fixed right-4 top-4 w-72 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow"
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="float-right"
            aria-label="close detail"
          >
            ✕
          </button>
          <h2 className="font-semibold">{selected.title}</h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {STATUS_LABELS[selected.status]} · P{selected.priority}
          </p>
        </aside>
      ) : null}

      {creating ? (
        <div
          data-testid="create-slot"
          className="fixed left-1/2 top-1/3 w-80 -translate-x-1/2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow"
        >
          <h2 className="font-semibold">New task — {creating}</h2>
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
            }}
          >
            <input
              aria-label="New task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
              autoFocus
              className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
            />
            <label className="text-xs text-[var(--color-muted)]">
              Start date (optional, sets start_at)
              <input
                type="date"
                aria-label="Start date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded border border-[var(--color-border)] px-3 py-1"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(null);
                  setNewTitle('');
                  setNewStart('');
                }}
                className="rounded px-3 py-1 text-[var(--color-muted)]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function DayCell({
  day,
  tasks,
  dimmed,
  onSelect,
  onCreate,
}: {
  day: Date;
  tasks: Task[];
  dimmed: boolean;
  onSelect: (t: Task) => void;
  onCreate?: (dayKey: string) => void;
}) {
  const key = format(day, 'yyyy-MM-dd');
  const { setNodeRef, isOver } = useDroppable({ id: key });
  return (
    <div
      ref={setNodeRef}
      data-testid={`day-${key}`}
      onClick={() => onCreate?.(key)}
      className={`min-h-24 bg-[var(--color-surface)] p-1 text-xs ${dimmed ? 'opacity-40' : ''} ${
        onCreate ? 'cursor-pointer' : ''
      } ${isOver ? 'outline outline-[var(--color-accent)]' : ''} ${
        isSameDay(day, new Date()) ? 'ring-1 ring-[var(--color-accent)]' : ''
      }`}
    >
      <div className="mb-1 text-right text-[var(--color-muted)]">{format(day, 'd')}</div>
      <div className="flex flex-col gap-1">
        {tasks.map((t) => (
          <TaskChip key={t.id} task={t} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function TaskChip({ task, onSelect }: { task: Task; onSelect: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      data-testid="cal-task"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(task);
      }}
      className="truncate rounded bg-[var(--color-accent)]/15 px-1 text-left"
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {task.title}
    </button>
  );
}
