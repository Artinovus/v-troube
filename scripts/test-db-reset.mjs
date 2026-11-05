// Vytvoří čistou testovací databázi: Supabase shim + všechny migrace.
// POUZE PRO LOKÁLNÍ TESTY – nikdy nespouštějte proti produkční databázi.
import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await db.unsafe('create extension if not exists pgcrypto');
  await db.unsafe(readFileSync(join(root, 'test/support/supabase-shim.sql'), 'utf8'));
  const dir = join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.unsafe(readFileSync(join(dir, f), 'utf8'));
  }
  await db.end();
  return url.toString();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  resetTestDb().then((u) => console.log('Testovací DB připravena:', u)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
