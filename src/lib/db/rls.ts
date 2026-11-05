import 'server-only';
import type postgres from 'postgres';
import { getSql } from './client';

export type Tx = postgres.TransactionSql;

/**
 * Spustí dotazy v transakci pod databázovou rolí "authenticated" s nastaveným
 * JWT subjektem. Všechna data tak procházejí Row Level Security – stejně jako
 * při přístupu přes Supabase API. userId musí pocházet z ověřené relace.
 */
export async function withUserTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Neplatný identifikátor uživatele.');
  const sql = getSql();
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  })) as T;
}
