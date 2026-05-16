'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';

// US-ST-02 — Nœud d'arbre de sous-tâches : expandable/collapsable + badge
// de progression « done/total ». Récursif, profondeur illimitée (l'UI de
// liste polie arrive au Sprint 7 ; ce composant y est réutilisé).
interface TaskNode {
  id: string;
  title: string;
  status: string;
}

interface Progress {
  done: number;
  total: number;
}

export function TaskTree({ task }: { task: TaskNode }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<TaskNode[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const loadProgress = useCallback(async () => {
    try {
      setProgress(await apiGet<Progress>(`/tasks/${task.id}/progress`));
    } catch {
      setProgress(null);
    }
  }, [task.id]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      try {
        setChildren(await apiGet<TaskNode[]>(`/tasks/${task.id}/subtasks`));
      } catch {
        setChildren([]);
      }
    }
  };

  const hasChildren = (progress?.total ?? 0) > 0;

  return (
    <li style={{ listStyle: 'none' }}>
      <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={open ? 'Collapse' : 'Expand'}
            style={triangleStyle}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span style={{ width: '1rem' }} />
        )}
        <span style={{ textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
          {task.title}
        </span>
        {progress && progress.total > 0 ? (
          <span style={badgeStyle}>
            {progress.done}/{progress.total}
          </span>
        ) : null}
      </span>

      {open && children ? (
        <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
          {children.map((child) => (
            <TaskTree key={child.id} task={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const triangleStyle = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  width: '1rem',
  padding: 0,
  fontSize: '0.9rem',
} as const;

const badgeStyle = {
  fontSize: '0.75rem',
  opacity: 0.7,
  border: '1px solid currentColor',
  borderRadius: '999px',
  padding: '0 0.4rem',
} as const;
