import { test, expect, type Page } from '@playwright/test';

// TF-WEB-VW-07/08 — Vue Timeline, API moquée (déterministe).
const PROJECT = { id: 'p1', name: 'Perso' };
const LIST = { id: 'l1', name: 'Backlog', kanbanColumns: ['todo', 'doing', 'done', 'postponed'] };

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.toISOString().slice(0, 10)}T12:00:00.000Z`;
}

const TASKS = [
  {
    id: 't1',
    title: 'Phase de cadrage',
    status: 'doing',
    priority: 1,
    startAt: isoDay(0),
    dueAt: isoDay(4),
    parentTaskId: null,
    position: 0,
    tags: [],
  },
  {
    id: 't2',
    title: 'Sans dates',
    status: 'todo',
    priority: 2,
    startAt: null,
    dueAt: null,
    parentTaskId: null,
    position: 1,
    tags: [],
  },
];

async function mockApi(page: Page, captured?: Array<unknown>): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (method === 'PATCH') {
      captured?.push(route.request().postDataJSON());
      return json({ ok: true });
    }
    if (method === 'DELETE') return json({ ok: true });
    if (url.includes('/projects/p1/lists')) return json([LIST]);
    if (url.endsWith('/api/v1/projects')) return json([PROJECT]);
    if (url.includes('/lists/l1/tasks')) return json(TASKS);
    if (url.endsWith('/api/v1/lists/l1')) return json(LIST);
    return json([]);
  });
}

test('TF-WEB-VW-07 : timeline barres + zoom + flag dépendances', async ({ page }) => {
  await mockApi(page);
  await page.goto('/timeline');
  await page.getByLabel('Project').selectOption('p1');
  await page.getByLabel('List').selectOption('l1');

  await expect(page.getByTestId('deps-flag')).toBeVisible();
  await expect(page.getByTestId('timeline-grid')).toBeVisible();
  // Tâche planifiée = une barre ; tâche sans dates = pas de barre.
  await expect(page.getByTestId('bar-t1')).toBeVisible();
  await expect(page.getByTestId('bar-t2')).toHaveCount(0);

  for (const z of ['day', 'month', 'quarter'] as const) {
    await page.getByLabel('Zoom').selectOption(z);
    await expect(page.getByTestId('bar-t1')).toBeVisible();
  }
});

test('TF-WEB-VW-08 : décaler une tâche met à jour ses dates (PATCH)', async ({ page }) => {
  const patches: unknown[] = [];
  await mockApi(page, patches);
  await page.goto('/timeline');
  await page.getByLabel('Project').selectOption('p1');
  await page.getByLabel('List').selectOption('l1');

  await page.getByRole('button', { name: 'move-fwd-t1' }).click();
  await expect.poll(() => patches.length).toBeGreaterThan(0);
  const moved = patches[0] as { startAt?: string; dueAt?: string };
  expect(moved.startAt).toBeTruthy();
  expect(moved.dueAt).toBeTruthy();

  // Redimensionnement : seul le bord "due" change.
  await page.getByRole('button', { name: 'resize-due-t1' }).click();
  await expect.poll(() => patches.length).toBeGreaterThan(1);
  const resized = patches[1] as { startAt?: string; dueAt?: string };
  expect(resized.dueAt).toBeTruthy();
  expect(resized.startAt).toBeUndefined();
});
