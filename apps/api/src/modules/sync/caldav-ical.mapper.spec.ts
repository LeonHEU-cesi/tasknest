import { describe, it, expect } from 'vitest';
import type { Task } from '@prisma/client';
import {
  hrefFor,
  parseICalEvent,
  taskToICal,
  taskUid,
} from './caldav-ical.mapper';

// TS-SY-CALDAV — round-trip iCalendar (échappement, UID, dépliage).
function task(over: Partial<Task> = {}): Task {
  return {
    id: 'a1b2c3',
    title: 'Plain title',
    description: null,
    dueAt: new Date('2026-05-20T10:00:00.000Z'),
    startAt: null,
    estimatedMinutes: null,
    archivedAt: null,
    recurrenceRuleId: null,
    occurrenceDate: null,
    ...over,
  } as Task;
}

describe('caldav-ical.mapper', () => {
  it('hrefFor / taskUid : UID stable + .ics, slash géré', () => {
    expect(taskUid('x9')).toBe('tasknest-x9@tasknest');
    expect(hrefFor('https://d/cal', 'x9')).toBe('https://d/cal/tasknest-x9@tasknest.ics');
    expect(hrefFor('https://d/cal/', 'x9')).toBe('https://d/cal/tasknest-x9@tasknest.ics');
  });

  it('taskToICal : VEVENT avec UID, SUMMARY, X-prop, DTSTART/DTEND', () => {
    const ics = taskToICal(task({ estimatedMinutes: 60 }));
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:tasknest-a1b2c3@tasknest');
    expect(ics).toContain('SUMMARY:Plain title');
    expect(ics).toContain('X-TASKNEST-TASK-ID:a1b2c3');
    expect(ics).toContain('DTSTART:20260520T100000Z');
    expect(ics).toContain('DTEND:20260520T110000Z');
  });

  it('round-trip : parse(serialize(task)) restitue id/summary/description/start', () => {
    const ics = taskToICal(task({ description: 'Some details' }));
    const p = parseICalEvent(ics);
    expect(p.taskId).toBe('a1b2c3');
    expect(p.summary).toBe('Plain title');
    expect(p.description).toBe('Some details');
    expect(p.startIso).toBe('2026-05-20T10:00:00.000Z');
  });

  it('échappement RFC 5545 round-trip (virgule, point-virgule, backslash, retour ligne)', () => {
    const tricky = 'a, b; c \\ d\nsecond line';
    const ics = taskToICal(task({ title: tricky, description: tricky }));
    expect(ics).toContain('SUMMARY:a\\, b\\; c \\\\ d\\nsecond line');
    const p = parseICalEvent(ics);
    expect(p.summary).toBe(tricky);
    expect(p.description).toBe(tricky);
  });

  it('taskId déduit de l’UID si X-prop absente', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:tasknest-fromuid@tasknest',
      'SUMMARY:S',
      'DTSTART:20260101T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseICalEvent(ics).taskId).toBe('fromuid');
  });

  it('dépliage des lignes continuées (RFC 5545 §3.1)', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:tasknest-folded@tasknest',
      'DESCRIPTION:line one ',
      ' continued here',
      'END:VEVENT',
    ].join('\r\n');
    expect(parseICalEvent(ics).description).toBe('line one continued here');
  });
});
