import { expect, test } from '@playwright/test';

test('rota /app sem sessão redireciona para /login', async ({ page }) => {
  await page.goto('/app');

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no Ped-On' })).toBeVisible();
});

test('rota /onboarding sem sessão redireciona para /login', async ({ page }) => {
  await page.goto('/onboarding');

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no Ped-On' })).toBeVisible();
});

test('página inicial oferece acesso para entrar e criar conta', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Criar conta' })).toBeVisible();

  await page.getByRole('link', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('login rejeita e-mail inválido antes de chamar o servidor', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('E-mail').fill('nao-e-um-email');
  await page.getByLabel('Senha', { exact: true }).fill('qualquer-senha');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByText('Informe um e-mail válido')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('cadastro valida que as senhas coincidem', async ({ page }) => {
  await page.goto('/cadastro');

  await page.getByLabel('E-mail').fill('usuario@example.com');
  await page.getByLabel('Senha', { exact: true }).fill('senha-segura');
  await page.getByLabel('Confirme a senha').fill('senha-diferente');
  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page.getByText('As senhas não coincidem')).toBeVisible();
});
