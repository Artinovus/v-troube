import postgres from 'postgres';
import { hashPassword } from '@/lib/password';

export const adminSql = () =>
  postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ztrouby_test', { max: 2, onnotice: () => {} });

export async function createUser(sql: postgres.Sql, email: string, role: 'admin' | 'user' = 'admin', password = 'heslo-pro-testy'): Promise<string> {
  const [u] = await sql`insert into public.app_users (email, password_hash, role) values (${email}, ${await hashPassword(password)}, ${role}) returning id`;
  return u.id;
}
