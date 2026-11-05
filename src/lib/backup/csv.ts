/**
 * CSV pro český Excel: oddělovač středník, desetinná čárka, UTF-8 s BOM.
 */
export type CsvValue = string | number | boolean | null | undefined;

function cell(v: CsvValue): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(Math.round(v * 10000) / 10000).replace('.', ',') : '';
  else if (typeof v === 'boolean') s = v ? 'ano' : 'ne';
  else s = v;
  // ochrana proti CSV/formula injection v tabulkových editorech
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s;
  if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
