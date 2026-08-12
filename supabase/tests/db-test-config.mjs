import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function databaseConfig() {
  const explicitUrl = process.env.SUPABASE_DB_URL;
  if (explicitUrl) {
    const host = new URL(explicitUrl).hostname;
    return {
      connectionString: explicitUrl,
      ssl: host === '127.0.0.1' || host === 'localhost' ? false : { rejectUnauthorized: false },
    };
  }

  let dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    const envText = await readFile(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
    dbPassword = envText
      .split(/\r?\n/)
      .find((line) => line.startsWith('SUPABASE_DB_PASSWORD='))
      ?.slice('SUPABASE_DB_PASSWORD='.length);
  }
  if (!dbPassword) {
    throw new Error('Defina SUPABASE_DB_URL para banco isolado ou SUPABASE_DB_PASSWORD.');
  }

  const password = encodeURIComponent(dbPassword);
  return {
    connectionString: `postgresql://postgres:${password}@db.zmuxkztnilnzjyyojbbr.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  };
}
