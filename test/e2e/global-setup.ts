import postgres from 'postgres';
// @ts-expect-error – JS modul bez typů
import { resetTestDb } from '../../scripts/test-db-reset.mjs';

export default async function globalSetup() {
  const url: string = await resetTestDb();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  for (const email of ['admin@ztrouby.test', 'druha@ztrouby.test']) {
    await sql`insert into auth.users (email, test_password) values (${email}, 'heslo123')`;
    await sql`update public.profiles set role = 'admin' where email = ${email}`;
  }
  await sql`insert into auth.users (email, test_password) values ('host@ztrouby.test', 'heslo123')`;
  await sql.end();
}
