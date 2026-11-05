import postgres from 'postgres';

export const adminSql = () =>
  postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ztrouby_test', { max: 2, onnotice: () => {} });

export async function createUser(sql: postgres.Sql, email: string, role: 'admin' | 'user' = 'admin'): Promise<string> {
  const [u] = await sql`insert into auth.users (email, test_password) values (${email}, 'heslo123') returning id`;
  if (role === 'admin') await sql`update public.profiles set role = 'admin' where id = ${u.id}`;
  return u.id;
}
