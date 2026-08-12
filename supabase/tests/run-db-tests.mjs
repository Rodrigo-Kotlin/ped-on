import { spawnSync } from 'node:child_process';

const suites = [
  'rls_integrity.test.mjs',
  'rbac_units_integrity.test.mjs',
  'unit_operational_config_integrity.test.mjs',
  'catalog_integrity.test.mjs',
  'menu_publication_integrity.test.mjs',
  'orders_integrity.test.mjs',
  'loyalty_integrity.test.mjs',
  'loyalty_rewards_integrity.test.mjs',
];

for (const suite of suites) {
  const result = spawnSync(process.execPath, [`supabase/tests/${suite}`], {
    env: {
      ...process.env,
      SUPABASE_DB_URL:
        process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
