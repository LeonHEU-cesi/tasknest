import type { Task } from '@prisma/client';
import { MS_TASK_PROP_ID, type MicrosoftEvent } from './microsoft-calendar.transport';

// US-SY-05 — Projection tâche → événement Microsoft Graph. Le hash
// d'idempotence et l'éligibilité sont **provider-neutres** : on réutilise
// tels quels ceux du Sprint 12 (pas de duplication de logique métier).
export { taskPushHash, isSyncEligible } from './google-sync.mapper';

const DEFAULT_DURATION_MIN = 30;

// Graph attend un dateTime local + timeZone séparé (pas d'offset 'Z').
function graphDateTime(d: Date): { dateTime: string; timeZone: string } {
  return { dateTime: d.toISOString().replace('Z', ''), timeZone: 'UTC' };
}

export function taskToMicrosoftEvent(task: Task): MicrosoftEvent {
  if (!task.dueAt) {
    throw new Error('taskToMicrosoftEvent: tâche sans dueAt (non éligible)');
  }
  const start = task.startAt ?? task.dueAt;
  const minutes = task.estimatedMinutes ?? DEFAULT_DURATION_MIN;
  const end =
    task.startAt && task.startAt < task.dueAt
      ? task.dueAt
      : new Date(start.getTime() + minutes * 60_000);

  return {
    subject: task.title,
    body: { contentType: 'text', content: task.description ?? '' },
    start: graphDateTime(start),
    end: graphDateTime(end),
    // Tag invisible pour la réconciliation au pull (parité Google).
    singleValueExtendedProperties: [{ id: MS_TASK_PROP_ID, value: task.id }],
  };
}

export function microsoftEventTaskId(ev: MicrosoftEvent): string | undefined {
  return ev.singleValueExtendedProperties?.find((p) => p.id === MS_TASK_PROP_ID)?.value;
}

// Date de début exploitable côté tâche (Graph renvoie dateTime sans 'Z').
export function microsoftEventStartIso(ev: MicrosoftEvent): string | undefined {
  if (!ev.start?.dateTime) return undefined;
  const raw = ev.start.dateTime;
  const iso = raw.endsWith('Z') ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
