import 'server-only';
import type postgres from 'postgres';
import { getSql } from './client';

export type Tx = postgres.TransactionSql;

/**
 * Spustí dotazy v transakci pod databázovou rolí "ztrouby_app" s nastaveným
 * app.user_id. Všechna data tak procházejí Row Level Security.
 * userId musí pocházet z ověřené relace (src/lib/auth.ts).
 */
export async function withUserTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Neplatný identifikátor uživatele.');
  const sql = getSql();
  return (await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    await tx`set local role ztrouby_app`;
    return fn(tx);
  })) as T;
}
