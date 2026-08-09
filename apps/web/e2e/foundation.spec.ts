import { expect, test } from '@playwright/test';

test('Página técnica inicial do Ped-On renderiza sem erros', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle(/Ped-On/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ped-On' })).toBeVisible();
  await expect(page.getByText('Gestão de Pedidos Inteligente', { exact: true })).toBeVisible();

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noHorizontalOverflow).toBe(true);

  expect(pageErrors).toHaveLength(0);
});
