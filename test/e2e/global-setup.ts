import postgres from 'postgres';
// @ts-expect-error – JS modul bez typů
import { resetTestDb } from '../../scripts/test-db-reset.mjs';
import { hashPassword } from '../../src/lib/password';

export default async function globalSetup() {
  const url: string = await resetTestDb();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const hash = await hashPassword('heslo123');
  for (const [email, role] of [['admin@ztrouby.test', 'admin'], ['druha@ztrouby.test', 'admin'], ['host@ztrouby.test', 'user'], ['zamek@ztrouby.test', 'admin']]) {
    await sql`insert into public.app_users (email, password_hash, role) values (${email}, ${hash}, ${role})`;
  }
  await sql.end();
}
