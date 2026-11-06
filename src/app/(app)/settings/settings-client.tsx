'use client';
import * as React from 'react';
import { Download, Upload, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace } from '@/lib/data/repo';
import type { CostSettings, SalesUnit } from '@/lib/calc';
import { formatCzk } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Field, Input, Notice, PageHeader, Select } from '@/components/ui/basic';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { NumberField } from '@/components/app/number-field';
import { SaveIndicator, useAutosave } from '@/components/app/autosave';
import { changePasswordAction, importLegacyAction, logoutOtherSessionsAction, restoreBackupAction, saveSettingsAction } from '@/app/actions';
import { signOutAction } from '@/app/login/actions';
import { parseBackup } from '@/lib/backup/schema';
import { buildLegacyPlan, findExistingIngredient, isLegacyFormat, parseLegacy, type LegacyDecisions, type LegacyParseResult } from '@/lib/backup/legacy';
import { SALES_UNIT_TEXT } from '../products/product-utils';

export function SettingsClient({ ws, email }: { ws: Workspace; email: string | null }) {
  const [s, setS] = React.useState<CostSettings>(ws.settings);
  const save = useAutosave(s, (v) => saveSettingsAction(v));
  return (
    <>
      <PageHeader title="Nastavení" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <div className="flex items-center justify-between"><CardTitle>Ceny a daně</CardTitle><SaveIndicator state={save.state} error={save.error} onRetry={save.retry} /></div>
          <label className="flex items-center gap-3 text-sm"><Switch checked={s.vatEnabled} onCheckedChange={(c) => setS((x) => ({ ...x, vatEnabled: c }))} aria-label="Plátce DPH" /> Počítat s DPH (kavárna prodává s DPH)</label>
          <p className="text-xs text-ink-muted">
            {s.vatEnabled
              ? 'Maloobchodní ceny kavárny se zadávají s DPH a pro výpočet marže se převádějí na ceny bez DPH. Ceny pekárny pro kavárnu jsou vždy bez DPH.'
              : 'Ceny se porovnávají tak, jak jsou zadané, bez samostatného výpočtu DPH (vhodné pro neplátce).'}
          </p>
          {s.vatEnabled ? <Field label="Sazba DPH pro maloobchodní ceny" htmlFor="s-vat"><NumberField id="s-vat" value={s.vatRatePct} onValueChange={(n) => setS((x) => ({ ...x, vatRatePct: n ?? 0 }))} max={99} suffix="%" allowEmpty={false} /></Field> : null}
          <Field label="Výchozí požadovaná marže výrobků" htmlFor="s-margin" hint="Pro doporučenou minimální cenu (lze přepsat u výrobku)."><NumberField id="s-margin" value={s.defaultTargetMarginPct} onValueChange={(n) => setS((x) => ({ ...x, defaultTargetMarginPct: n ?? 0 }))} max={99.99} suffix="%" allowEmpty={false} /></Field>
        </Card>

        <Card className="space-y-3">
          <CardTitle>Export dat</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button asChild><a href="/api/export/backup" download><Download /> Úplná záloha (JSON)</a></Button>
            <Button variant="outline" asChild><a href="/api/export/ingredients" download>Suroviny CSV</a></Button>
            <Button variant="outline" asChild><a href="/api/export/products" download>Ceník CSV</a></Button>
            <Button variant="outline" asChild><a href="/api/export/calculation" download>Kalkulace CSV</a></Button>
          </div>
          <p className="text-xs text-ink-muted">CSV používá středník a desetinnou čárku (otevře se správně v českém Excelu).</p>
        </Card>

        <ImportCard ws={ws} />

        <Card className="space-y-2">
          <CardTitle>Účet</CardTitle>
          <p className="text-sm text-ink-soft">Přihlášena jako <strong>{email}</strong> (administrátor).</p>
          <PasswordForm />
          <div className="flex flex-wrap gap-2 pt-2">
            <form action={signOutAction}><Button variant="outline" type="submit"><LogOut /> Odhlásit se</Button></form>
            <Button variant="ghost" onClick={async () => { const r = await logoutOtherSessionsAction(); if (r.ok) toast.success(r.message!); else toast.error(r.error); }}>Odhlásit ostatní zařízení</Button>
          </div>
        </Card>
      </div>
    </>
  );
}

type Loaded = { kind: 'backup'; json: unknown; summary: string } | { kind: 'legacy'; json: unknown; parsed: LegacyParseResult } | null;

function ImportCard({ ws }: { ws: Workspace }) {
  const [loaded, setLoaded] = React.useState<Loaded>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const hasData = ws.ingredients.length + ws.recipes.length + ws.products.length > 0;

  const onFile = async (f: File) => {
    setError(null);
    setLoaded(null);
    if (f.size > 4_000_000) return setError('Soubor je příliš velký (max. 4 MB).');
    let json: unknown;
    try { json = JSON.parse(await f.text()); } catch { return setError('Soubor není platný JSON.'); }
    if (isLegacyFormat(json)) {
      try { setLoaded({ kind: 'legacy', json, parsed: parseLegacy(json) }); } catch (e) { setError((e as Error).message); }
      return;
    }
    const p = parseBackup(json);
    if (!p.ok) return setError('Záloha není platná: ' + p.errors.join(' '));
    const d = p.backup.data;
    setLoaded({ kind: 'backup', json, summary: `${d.ingredients.length} surovin, ${d.recipes.length} receptur, ${d.products.length} výrobků, ${d.production_scenarios.length} scénářů (export ${new Date(p.backup.exportedAt).toLocaleString('cs-CZ')})` });
  };

  return (
    <Card className="space-y-3 lg:col-span-2">
      <CardTitle>Import dat</CardTitle>
      <p className="text-sm text-ink-soft">Nahrajte zálohu z této aplikace, nebo soubor <code>z-trouby-zaloha.json</code> ze staré HTML kalkulačky. Před importem uvidíte náhled a nic se nepřepíše bez potvrzení.</p>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload /> Vybrat soubor</Button>
      {error ? <Notice tone="bad">{error}</Notice> : null}

      {loaded?.kind === 'backup' ? (
        <div className="rounded-lg border border-line p-3 text-sm">
          <p className="font-medium">Záloha Z trouby</p>
          <p className="text-ink-soft">{loaded.summary}</p>
          {hasData ? <Notice className="mt-2">Obnova <strong>nahradí všechna současná data</strong> ({ws.ingredients.length} surovin, {ws.recipes.length} receptur, {ws.products.length} výrobků). Doporučujeme nejprve stáhnout aktuální zálohu.</Notice> : null}
          <Button className="mt-3" variant={hasData ? 'destructive' : 'default'} onClick={() => (hasData ? setConfirm(true) : void restore(false))}>Obnovit zálohu</Button>
        </div>
      ) : null}
      {loaded?.kind === 'legacy' ? <LegacyWizard parsed={loaded.parsed} json={loaded.json} ws={ws} onDone={() => setLoaded(null)} /> : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => { setConfirm(o); if (!o) setTyped(''); }}
        destructive
        title="Přepsat všechna data?"
        description="Současné suroviny, receptury, výrobky, plán a scénáře budou nahrazeny obsahem zálohy. Pro potvrzení napište PŘEPSAT."
        confirmLabel="Přepsat a obnovit"
        onConfirm={async () => { if (typed.trim().toUpperCase() !== 'PŘEPSAT') { toast.error('Napište PŘEPSAT pro potvrzení.'); throw new Error('nepotvrzeno'); } await restore(true); }}
      >
        <Input className="mt-3" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="PŘEPSAT" aria-label="Potvrzení" />
      </ConfirmDialog>
    </Card>
  );

  async function restore(confirmReplace: boolean) {
    if (loaded?.kind !== 'backup') return;
    const r = await restoreBackupAction(loaded.json, confirmReplace);
    if (r.ok) { toast.success(r.message!); setLoaded(null); window.location.href = '/'; } else toast.error(r.error);
  }
}

function LegacyWizard({ parsed, json, ws, onDone }: { parsed: LegacyParseResult; json: unknown; ws: Workspace; onDone: () => void }) {
  const [dec, setDec] = React.useState<LegacyDecisions>({ variant: {}, existingIngredient: {}, existingProduct: {}, salesUnit: {}, importSettings: false });
  const [busy, setBusy] = React.useState(false);
  const plan = buildLegacyPlan(parsed, dec, ws.ingredients, ws.products.map((p) => p.name));
  const existingNames = new Set(ws.products.map((p) => p.name.trim().toLocaleLowerCase('cs')));
  const fmtVariant = (v: { size: number | null; price: number | null; unit: string }) => `${v.size ?? '?'} ${v.unit} za ${v.price != null ? formatCzk(v.price) : 'bez ceny'}`;
  const settingsKeys = Object.keys(parsed.settings);
  return (
    <div className="space-y-4 rounded-lg border border-line p-3 text-sm" data-testid="legacy-wizard">
      <p className="font-medium">Stará kalkulačka: {parsed.products.length} výrobků, {parsed.ingredients.length} různých surovin</p>
      {parsed.warnings.length ? <Notice><ul className="list-disc pl-4 text-xs">{parsed.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}</ul></Notice> : null}

      <div>
        <p className="mb-1 font-medium">Výrobky</p>
        <ul className="space-y-2">
          {parsed.products.map((p) => (
            <li key={p.name} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_200px] sm:items-center">
              <span>{p.name} <span className="text-xs text-ink-muted">{formatCzk(p.wholesale)} · {p.lines.length} surovin · výtěžnost {p.yield ?? '?'}</span></span>
              <Select aria-label={`Prodejní jednotka – ${p.name}`} value={dec.salesUnit[p.name] ?? p.suggestedSalesUnit} onChange={(e) => setDec((d) => ({ ...d, salesUnit: { ...d.salesUnit, [p.name]: e.target.value as SalesUnit } }))}>
                {Object.entries(SALES_UNIT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              {existingNames.has(p.name.trim().toLocaleLowerCase('cs')) ? (
                <Select aria-label={`Existující výrobek – ${p.name}`} value={dec.existingProduct[p.name] ?? ''} onChange={(e) => setDec((d) => ({ ...d, existingProduct: { ...d.existingProduct, [p.name]: e.target.value as 'skip' | 'new' } }))}>
                  <option value="">Už existuje – zvolte…</option>
                  <option value="skip">Přeskočit</option>
                  <option value="new">Vytvořit jako nový (import)</option>
                </Select>
              ) : <span />}
            </li>
          ))}
        </ul>
      </div>

      {parsed.ingredients.some((i) => i.ambiguous || findExistingIngredient(i, ws.ingredients)) ? (
        <div>
          <p className="mb-1 font-medium">Suroviny k potvrzení</p>
          <ul className="space-y-2">
            {parsed.ingredients.map((i) => {
              const ex = findExistingIngredient(i, ws.ingredients);
              if (!i.ambiguous && !ex) return null;
              return (
                <li key={i.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_240px_240px] sm:items-center">
                  <span>{i.name}</span>
                  {i.ambiguous ? (
                    <Select aria-label={`Varianta – ${i.name}`} value={dec.variant[i.key] ?? ''} onChange={(e) => setDec((d) => ({ ...d, variant: { ...d.variant, [i.key]: Number(e.target.value) } }))}>
                      <option value="">Různé ceny – zvolte…</option>
                      {i.variants.map((v, idx) => <option key={idx} value={idx}>{fmtVariant(v)} ({v.usedIn.join(', ')})</option>)}
                    </Select>
                  ) : <span className="text-xs text-ink-muted">{fmtVariant(i.variants[0])}</span>}
                  {ex ? (
                    <Select aria-label={`Existující surovina – ${i.name}`} value={dec.existingIngredient[i.key] ?? ''} onChange={(e) => setDec((d) => ({ ...d, existingIngredient: { ...d.existingIngredient, [i.key]: e.target.value as 'use' | 'update' | 'new' } }))}>
                      <option value="">Už existuje ({ex.packagePrice != null ? fmtVariant({ size: ex.packageQuantity, price: ex.packagePrice, unit: ex.packageUnit }) : 'bez ceny'}) – zvolte…</option>
                      <option value="use">Použít stávající beze změny</option>
                      <option value="update">Aktualizovat cenu podle importu</option>
                      <option value="new">Vytvořit novou surovinu</option>
                    </Select>
                  ) : <span />}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {settingsKeys.length ? (
        <label className="flex items-center gap-2"><Switch checked={dec.importSettings} onCheckedChange={(c) => setDec((d) => ({ ...d, importSettings: c }))} aria-label="Importovat nastavení" /> Přepsat nastavení kalkulačky hodnotami ze souboru (pečení, hodiny, odměna, provozní náklady)</label>
      ) : null}

      {plan.unresolved.length ? <Notice><ul className="list-disc pl-4 text-xs">{plan.unresolved.map((u) => <li key={u}>{u}</li>)}</ul></Notice> : (
        <Notice tone="good">Připraveno: {plan.ingredientsToCreate.length} nových surovin, {plan.ingredientsToUpdate.length} aktualizovaných cen, {plan.products.length} výrobků s recepturami (jako koncepty k ověření).</Notice>
      )}
      <div className="flex gap-2">
        <Button disabled={busy || plan.unresolved.length > 0} onClick={async () => {
          setBusy(true);
          const r = await importLegacyAction(json, dec);
          setBusy(false);
          if (r.ok) { toast.success(`Importováno ${r.data!.products} výrobků.`); onDone(); } else toast.error(r.error);
        }}>{busy ? 'Importuji…' : 'Importovat'}</Button>
        <Button variant="ghost" onClick={onDone}>Zrušit</Button>
      </div>
    </div>
  );
}

function PasswordForm() {
  const [v, setV] = React.useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-2 border-t border-line pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await changePasswordAction(v);
        setBusy(false);
        if (r.ok) { toast.success(r.message!); setV({ current: '', next: '', confirm: '' }); } else setError(r.error);
      }}
    >
      <p className="text-sm font-medium">Změna hesla</p>
      <Input type="password" autoComplete="current-password" placeholder="Současné heslo" aria-label="Současné heslo" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} />
      <Input type="password" autoComplete="new-password" placeholder="Nové heslo (min. 12 znaků)" aria-label="Nové heslo" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />
      <Input type="password" autoComplete="new-password" placeholder="Nové heslo znovu" aria-label="Nové heslo znovu" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
      {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}
      <Button type="submit" variant="secondary" disabled={busy || !v.current || !v.next}>{busy ? 'Ukládám…' : 'Změnit heslo'}</Button>
    </form>
  );
}
