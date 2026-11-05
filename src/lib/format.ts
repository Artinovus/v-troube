const czk = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const czk0 = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Formát Kč, např. "29,38 Kč". Null → "—". */
export function formatCzk(v: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return (opts.whole ? czk0 : czk).format(v);
}

export function formatNumber(v: number | null | undefined, maxFrac = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: maxFrac }).format(v);
}

export function formatPct(v: number | null | undefined, maxFrac = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${formatNumber(v, maxFrac)} %`;
}

/** Hodnota pro vstupní pole: česká desetinná čárka, bez oddělovače tisíců. */
export function toInputValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return String(Math.round(v * 1000) / 1000).replace('.', ',');
}

/**
 * Převede text zadaný uživatelem na číslo. Přijímá čárku i tečku, mezery
 * a nezlomitelné mezery jako oddělovače tisíců a příponu "Kč".
 * Prázdný řetězec → null, nesmysl → NaN.
 */
export function parseCzNumber(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  const s = input.replace(/kč/i, '').replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
  return Number(s);
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
