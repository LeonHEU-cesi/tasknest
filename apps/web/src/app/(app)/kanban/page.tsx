'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { apiGet, apiPatch } from '@/lib/api-client';
import { STATUS_LABELS, type Task, type TaskStatus } from '@/lib/api-types';

const ALL_STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'postponed', 'canceled'];

// US-VW-03/04 — Kanban : colonnes par statut (personnalisables par liste),
// drag&drop d'une carte entre colonnes ⇒ PATCH du statut.
export default function KanbanPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <KanbanBoard />
    </Suspense>
  );
}

function KanbanBoard() {
  const listId = useSearchParams().get('listId') ?? '';
  const [columns, setColumns] = useState<TaskStatus[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!listId) return;
    try {
      const list = await apiGet<{ kanbanColumns: TaskStatus[] }>(`/lists/${listId}`);
      setColumns(list.kanbanColumns);
      setTasks(await apiGet<Task[]>(`/lists/${listId}/tasks`));
    } catch {
      setError('Sign in and pick a list (?listId=…).');
    }
  }, [listId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDragEnd = async (event: DragEndEvent) => {
    const taskId = String(event.active.id);
    const target = event.over?.id ? (String(event.over.id) as TaskStatus) : null;
    if (!target) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === target) return;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: target } : t)));
    await apiPatch(`/tasks/${taskId}`, { status: target });
  };

  const persistColumns = async (next: TaskStatus[]) => {
    setColumns(next);
    await apiPatch(`/lists/${listId}`, { kanbanColumns: next });
  };

  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Kanban</h1>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="ml-auto rounded border border-[var(--color-border)] px-3 py-1 text-sm"
        >
          {editing ? 'Done' : 'Edit columns'}
        </button>
      </header>

      {editing ? (
        <ColumnEditor columns={columns} onChange={persistColumns} />
      ) : null}

      <DndContext onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-4 overflow-x-auto">
          {columns.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={tasks.filter((t) => t.status === status)}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Column({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      data-testid={`col-${status}`}
      className={`flex w-72 shrink-0 flex-col rounded border border-[var(--color-border)] ${
        isOver ? 'bg-[var(--color-border)]/40' : ''
      }`}
    >
      <h2 className="border-b border-[var(--color-border)] px-3 py-2 text-sm font-medium">
        {STATUS_LABELS[status]} <span className="text-[var(--color-muted)]">({tasks.length})</span>
      </h2>
      <div className="flex flex-col gap-2 p-2">
        {tasks.map((t) => (
          <Card key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

function Card({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid="card"
      className="cursor-grab rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {task.title}
    </div>
  );
}

function ColumnEditor({
  columns,
  onChange,
}: {
  columns: TaskStatus[];
  onChange: (next: TaskStatus[]) => void;
}) {
  const move = (i: number, delta: number) => {
    const next = [...columns];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="rounded border border-[var(--color-border)] p-3 text-sm">
      <div className="flex flex-col gap-1">
        {columns.map((status, i) => (
          <div key={status} className="flex items-center gap-2">
            <span className="w-28">{STATUS_LABELS[status]}</span>
            <button type="button" onClick={() => move(i, -1)} aria-label={`up-${status}`}>
              ↑
            </button>
            <button type="button" onClick={() => move(i, 1)} aria-label={`down-${status}`}>
              ↓
            </button>
            <button
              type="button"
              onClick={() => onChange(columns.filter((s) => s !== status))}
              aria-label={`remove-${status}`}
              className="text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {ALL_STATUSES.filter((s) => !columns.includes(s)).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange([...columns, s])}
            className="rounded border border-[var(--color-border)] px-2 py-1"
          >
            + {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
