// Vytvoří čistou testovací databázi a spustí všechny migrace.
// POUZE PRO LOKÁLNÍ TESTY – nikdy nespouštějte proti produkční databázi.
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.mjs';

const adminUrl = process.env.TEST_PG_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const dbName = process.env.TEST_DB_NAME ?? 'ztrouby_test';
if (!/test/.test(dbName)) throw new Error('Název testovací databáze musí obsahovat "test".');

export async function resetTestDb() {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = '/' + dbName;
  await migrate(url.toString(), { log: () => {} });
  return url.toString();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  resetTestDb().then((u) => console.log('Testovací DB připravena:', u)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
