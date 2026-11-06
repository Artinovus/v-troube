// Spustí čekající databázové migrace z db/migrations (každou v transakci).
//   npm run db:migrate            (použije DATABASE_URL z prostředí / .env.local / .env)
import postgres from 'postgres';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnvFiles() {
  for (const f of ['.env.local', '.env']) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export async function migrate(url, { log = console.log } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await sql`select name from public.schema_migrations`).map((r) => r.name));
    const dir = join(root, 'db/migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
        await tx`insert into public.schema_migrations (name) values (${f})`;
      });
      log(`✓ ${f}`);
      applied++;
    }
    log(applied ? `Hotovo, použito migrací: ${applied}.` : 'Databáze je aktuální.');
  } finally {
    await sql.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvFiles();
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error('Chybí DATABASE_URL.');
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error('Migrace selhala:', e.message);
    process.exit(1);
  });
}
