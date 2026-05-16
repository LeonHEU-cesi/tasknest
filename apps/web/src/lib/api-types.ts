// Sprint 7 — Types partagés des vues (alignés sur l'API).
export interface Named {
  id: string;
  name: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'postponed' | 'canceled';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  dueAt: string | null;
  parentTaskId: string | null;
  position: number;
  tags: Tag[];
}

export type GroupBy = 'none' | 'status' | 'priority' | 'tag';

export const PRIORITY_LABELS = ['P0 — Critique', 'P1 — Haute', 'P2 — Normale', 'P3 — Basse'];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
  postponed: 'Postponed',
  canceled: 'Canceled',
};
