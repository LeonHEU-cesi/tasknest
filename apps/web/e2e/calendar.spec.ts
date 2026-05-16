import { test, expect, type Page } from '@playwright/test';

// TF-WEB-VW-05 — Vue Calendrier, API moquée (déterministe).
const PROJECT = { id: 'p1', name: 'Perso' };
const LIST = { id: 'l1', name: 'Backlog', kanbanColumns: ['todo', 'doing', 'done', 'postponed'] };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function mockApi(page: Page): Promise<void> {
  const due = `${todayKey()}T12:00:00.000Z`;
  const tasks = [
    {
      id: 't1',
      title: 'Tâche du jour',
      status: 'todo',
      priority: 1,
      dueAt: due,
      startAt: null,
      parentTaskId: null,
      position: 0,
      tags: [],
    },
  ];
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (method === 'PATCH' || method === 'DELETE') return json({ ok: true });
    if (url.includes('/projects/p1/lists')) return json([LIST]);
    if (url.endsWith('/api/v1/projects')) return json([PROJECT]);
    if (url.includes('/lists/l1/tasks')) return json(tasks);
    if (url.endsWith('/api/v1/lists/l1')) return json(LIST);
    return json([]);
  });
}

test('TF-WEB-VW-05 : calendrier mois/semaine/jour + détail', async ({ page }) => {
  await mockApi(page);
  await page.goto('/calendar');
  await page.getByLabel('Project').selectOption('p1');
  await page.getByLabel('List').selectOption('l1');

  // Grille mois + tâche du jour visible dans sa cellule.
  await expect(page.getByTestId('cal-grid')).toBeVisible();
  const cell = page.getByTestId(`day-${todayKey()}`);
  await expect(cell.getByText('Tâche du jour')).toBeVisible();

  // Clic sur la tâche → panneau détail.
  await page.getByTestId('cal-task').first().click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await page.getByLabel('close detail').click();
  await expect(page.getByTestId('task-detail')).toHaveCount(0);

  // Bascule semaine puis jour.
  await page.getByLabel('Calendar view').selectOption('week');
  await expect(page.getByTestId('cal-grid')).toBeVisible();
  await page.getByLabel('Calendar view').selectOption('day');
  await expect(page.getByTestId(`day-${todayKey()}`)).toBeVisible();
});
