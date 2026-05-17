import type { Task } from '@prisma/client';

// US-SY-08 — Sérialisation/parsing iCalendar (RFC 5545) minimal mais
// correct (échappement, dépliage des lignes). Pas de dépendance lourde :
// on ne génère/lit qu'un VEVENT simple. Hash & éligibilité réutilisés du
// Sprint 12 (provider-neutres).
export { taskPushHash, isSyncEligible } from './google-sync.mapper';

const DEFAULT_DURATION_MIN = 30;
const PRODID = '-//Tasknest//Sync//FR';

// UID stable dérivé de l'id de tâche ⇒ round-trip fiable au pull même si
// le mapping local est perdu.
export function taskUid(taskId: string): string {
  return `tasknest-${taskId}@tasknest`;
}

export function hrefFor(collectionUrl: string, taskId: string): string {
  const base = collectionUrl.endsWith('/') ? collectionUrl : `${collectionUrl}/`;
  return `${base}${taskUid(taskId)}.ics`;
}

function icalDate(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

export function taskToICal(task: Task): string {
  if (!task.dueAt) throw new Error('taskToICal: tâche sans dueAt');
  const start = task.startAt ?? task.dueAt;
  const minutes = task.estimatedMinutes ?? DEFAULT_DURATION_MIN;
  const end =
    task.startAt && task.startAt < task.dueAt
      ? task.dueAt
      : new Date(start.getTime() + minutes * 60_000);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'BEGIN:VEVENT',
    `UID:${taskUid(task.id)}`,
    `DTSTAMP:${icalDate(new Date())}`,
    `DTSTART:${icalDate(start)}`,
    `DTEND:${icalDate(end)}`,
    `SUMMARY:${escapeText(task.title)}`,
    ...(task.description ? [`DESCRIPTION:${escapeText(task.description)}`] : []),
    // Tag explicite (en plus de l'UID) pour retrouver la tâche au pull.
    `X-TASKNEST-TASK-ID:${task.id}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

export interface ParsedICalEvent {
  taskId?: string;
  summary?: string;
  description?: string;
  startIso?: string;
}

// Déplie les lignes (continuation = espace/tab en tête, RFC 5545 §3.1).
function unfold(ics: string): string[] {
  const raw = ics.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function icalToDate(value: string): string | undefined {
  // Formats : 20260520T100000Z (UTC) ou 20260520T100000 (flottant ⇒ UTC).
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const [, y, mo, da, h, mi, s] = m;
  return new Date(
    Date.UTC(+y, +mo - 1, +da, +h, +mi, +s),
  ).toISOString();
}

export function parseICalEvent(ics: string): ParsedICalEvent {
  const result: ParsedICalEvent = {};
  for (const line of unfold(ics)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).split(';')[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (name === 'X-TASKNEST-TASK-ID') result.taskId = value.trim();
    else if (name === 'UID' && !result.taskId) {
      const m = /^tasknest-(.+)@tasknest$/.exec(value.trim());
      if (m) result.taskId = m[1];
    } else if (name === 'SUMMARY') result.summary = unescapeText(value);
    else if (name === 'DESCRIPTION') result.description = unescapeText(value);
    else if (name === 'DTSTART') result.startIso = icalToDate(value);
  }
  return result;
}
