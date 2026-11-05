import { ZodError } from 'zod';
import { AuthError } from './auth';
import { zodMessage, type ActionResult } from './validation';

/** Převede chybu na srozumitelnou českou zprávu (bez úniku interních detailů). */
export function toUserMessage(e: unknown): string {
  if (e instanceof ZodError) return zodMessage(e);
  if (e instanceof AuthError) return e.message;
  const err = e as { code?: string; message?: string; constraint_name?: string };
  switch (err?.code) {
    case '23503':
      return 'Záznam nelze odstranit, protože ho používají jiné záznamy (receptura, výrobek). Můžete ho archivovat nebo deaktivovat.';
    case '23505':
      return 'Záznam se stejným názvem už existuje.';
    case '23514':
      return err.message?.startsWith('Podreceptura') ? err.message : 'Některá hodnota je mimo povolený rozsah.';
    case '42501':
      return 'Nemáte oprávnění k této operaci.';
  }
  if (err?.message && /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ].*[.!]$/.test(err.message) && /[áčďéěíňóřšťúůýž]/i.test(err.message)) {
    return err.message; // naše vlastní česká hláška
  }
  console.error(e);
  return 'Uložení se nezdařilo. Zkuste to prosím znovu.';
}

export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    return { ok: false, error: toUserMessage(e) };
  }
}
