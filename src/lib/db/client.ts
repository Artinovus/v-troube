import 'server-only';
import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __ztroubySql: postgres.Sql | undefined;
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Chybí proměnná prostředí DATABASE_URL.');
  return postgres(url, {
    // poolery v transakčním režimu (PgBouncer, Neon pooler) nepodporují prepared statements
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    onnotice: () => {},
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
    },
  });
}

export function getSql(): postgres.Sql {
  if (!globalThis.__ztroubySql) globalThis.__ztroubySql = create();
  return globalThis.__ztroubySql;
}
