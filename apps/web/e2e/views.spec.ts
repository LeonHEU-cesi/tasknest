import { test, expect, type Page } from '@playwright/test';

// TF-WEB-VW-01..04 — Vue Liste + Kanban, API moquée (déterministe).
const PROJECT = { id: 'p1', name: 'Perso' };
const LIST = { id: 'l1', name: 'Backlog', kanbanColumns: ['todo', 'doing', 'done', 'postponed'] };
const TASKS = [
  { id: 't1', title: 'Acheter du café', status: 'todo', priority: 0, dueAt: null, parentTaskId: null, position: 0, tags: [{ id: 'g1', name: 'maison', color: null }] },
  { id: 't2', title: 'Préparer la réunion', status: 'doing', priority: 1, dueAt: null, parentTaskId: null, position: 1, tags: [] },
  { id: 't3', title: 'Envoyer le rapport', status: 'done', priority: 2, dueAt: null, parentTaskId: null, position: 2, tags: [] },
];

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'PATCH' || method === 'DELETE') return json({ ok: true });
    if (url.includes('/projects/p1/lists')) return json([LIST]);
    if (url.endsWith('/api/v1/projects')) return json([PROJECT]);
    if (url.includes('/lists/l1/tasks')) return json(TASKS);
    if (url.endsWith('/api/v1/lists/l1')) return json(LIST);
    return json([]);
  });
}

test('TF-WEB-VW-01/02 : Vue Liste + groupements collapsables', async ({ page }) => {
  await mockApi(page);
  await page.goto('/tasks');

  await page.getByLabel('Project').selectOption('p1');
  await page.getByLabel('List').selectOption('l1');

  await expect(page.getByText('Acheter du café')).toBeVisible();
  await expect(page.getByText('Préparer la réunion')).toBeVisible();

  // Grouper par statut → headers visibles.
  await page.getByLabel('Group by').selectOption('status');
  await expect(page.getByRole('button', { name: /To do/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Doing/ })).toBeVisible();

  // Replier le groupe "To do" masque sa tâche.
  await page.getByRole('button', { name: /To do/ }).click();
  await expect(page.getByText('Acheter du café')).toHaveCount(0);
});

test('TF-WEB-VW-03/04 : Kanban colonnes + éditeur', async ({ page }) => {
  await mockApi(page);
  await page.goto('/kanban?listId=l1');

  await expect(page.getByTestId('col-todo')).toBeVisible();
  await expect(page.getByTestId('col-doing')).toBeVisible();
  await expect(page.getByTestId('col-done')).toBeVisible();
  await expect(page.getByTestId('col-postponed')).toBeVisible();
  await expect(page.getByText('Acheter du café')).toBeVisible();

  // Éditeur de colonnes : retirer "postponed".
  await page.getByRole('button', { name: 'Edit columns' }).click();
  await page.getByRole('button', { name: 'remove-postponed' }).click();
  await expect(page.getByTestId('col-postponed')).toHaveCount(0);
});
