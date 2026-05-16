import { createHash } from 'node:crypto';
import type { Task } from '@prisma/client';
import type { GoogleEvent } from './google-calendar.transport';

// US-SY-02 — Projection tâche → événement Google. Clé de réconciliation au
// pull : on tague nos événements via extendedProperties.private (invisible
// dans l'agenda) plutôt que de se fier à un mapping qui peut être perdu.
export const TASKNEST_TASK_ID = 'tasknestTaskId';

// Durée par défaut d'un créneau si la tâche n'a pas d'estimation.
const DEFAULT_DURATION_MIN = 30;

export function taskToGoogleEvent(task: Task): GoogleEvent {
  if (!task.dueAt) {
    throw new Error('taskToGoogleEvent: tâche sans dueAt (non éligible)');
  }
  const start = task.startAt ?? task.dueAt;
  const minutes = task.estimatedMinutes ?? DEFAULT_DURATION_MIN;
  // Si startAt < dueAt on respecte l'intervalle réel ; sinon créneau
  // [dueAt, dueAt + estimation].
  const end =
    task.startAt && task.startAt < task.dueAt
      ? task.dueAt
      : new Date(start.getTime() + minutes * 60_000);

  return {
    summary: task.title,
    description: task.description ?? undefined,
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: 'UTC' },
    extendedProperties: { private: { [TASKNEST_TASK_ID]: task.id } },
  };
}

// Empreinte stable des champs poussés : un re-push sans changement réel ne
// déclenche aucun appel Google (idempotence + économie de quota).
export function taskPushHash(task: Task): string {
  const start = task.startAt ?? task.dueAt;
  const payload = JSON.stringify({
    t: task.title,
    d: task.description ?? null,
    s: start?.toISOString() ?? null,
    e: task.dueAt?.toISOString() ?? null,
    m: task.estimatedMinutes ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

// Une tâche est synchronisable si elle a une échéance, n'est pas archivée
// et n'est pas un simple modèle de récurrence (les occurrences, elles, le
// sont — elles portent occurrenceDate).
export function isSyncEligible(task: Pick<
  Task,
  'dueAt' | 'archivedAt' | 'recurrenceRuleId' | 'occurrenceDate'
>): boolean {
  if (!task.dueAt || task.archivedAt) return false;
  if (task.recurrenceRuleId && !task.occurrenceDate) return false;
  return true;
}
