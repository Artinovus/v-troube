import 'server-only';
import { cache } from 'react';
import { requireAdminPage } from '@/lib/auth';
import { withUserTx } from '@/lib/db/rls';
import { ensureSeeded, loadWorkspace } from './repo';

/** Načte všechna data přihlášené administrátorky (pro serverové stránky). */
export const getWorkspace = cache(async () => {
  const user = await requireAdminPage();
  // Výchozí data se vytvoří při prvním načtení (idempotentně, ve stejné transakci).
  return withUserTx(user.id, async (tx) => {
    await ensureSeeded(tx);
    return loadWorkspace(tx);
  });
});
