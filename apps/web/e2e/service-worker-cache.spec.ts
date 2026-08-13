import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('service worker ativo não armazena APIs mutáveis do Clube', async ({ page }) => {
  const apiUrls = [
    'https://placeholder.supabase.co/rest/v1/rpc/get_public_loyalty_account',
    'https://placeholder.supabase.co/rest/v1/rpc/get_public_loyalty_rewards',
    'https://placeholder.supabase.co/rest/v1/rpc/redeem_public_loyalty_reward',
    'https://placeholder.supabase.co/rest/v1/rpc/consume_loyalty_voucher',
  ];
  await page.route('https://placeholder.supabase.co/rest/v1/rpc/**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      json: { found: false },
    }),
  );

  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
  }
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(controlled).toBe(true);

  await page.evaluate(async (urls) => {
    await Promise.all(
      urls.map((url) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      ),
    );
  }, apiUrls);

  const cachedUrls = await page.evaluate(async () => {
    const requests = await Promise.all(
      (await caches.keys()).map(async (name) => (await caches.open(name)).keys()),
    );
    return requests.flat().map((request) => request.url);
  });
  for (const url of apiUrls) expect(cachedUrls).not.toContain(url);
});
