'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Archive, ArchiveRestore, Trash2, History, Plus, X, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace } from '@/lib/data/repo';
import type { Product } from '@/lib/calc';
import { computeAllRecipeCosts, computePlan, marginPct, markupPct, salesUnitLabel } from '@/lib/calc';
import { formatCzk, formatDate, formatPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Field, Input, Notice, Select, Textarea } from '@/components/ui/basic';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { NumberField } from '@/components/app/number-field';
import { SaveIndicator, useAutosave } from '@/components/app/autosave';
import { deleteProductAction, productHistoryAction, saveProductAction } from '@/app/actions';
import { productEconomics, SALES_UNIT_TEXT } from '../product-utils';

const blank = (): Product => ({
  id: '', recipeId: null, name: '', category: 'ostatní', salesUnit: 'piece', pieceWeight: null, wholesalePrice: 0,
  retailPrice: null, retailPortions: 1, targetMarginPct: null, isActive: true, notes: null, sortOrder: 0,
});

type Draft = Omit<Product, 'wholesalePrice'> & { wholesalePrice: number | null };

function validate(d: Draft): string | null {
  if (!d.name.trim()) return 'Vyplňte název výrobku.';
  if (d.wholesalePrice == null) return 'Vyplňte cenu pro kavárnu.';
  if (!(d.retailPortions > 0)) return 'Počet porcí musí být větší než 0.';
  return null;
}

const toInput = (d: Draft) => ({ ...d, id: d.id || undefined, notes: d.notes || null });

export function ProductDetail({ product, ws }: { product: Product | null; ws: Workspace }) {
  const router = useRouter();
  const isNew = !product;
  const [d, setD] = React.useState<Draft>(product ?? blank());
  const [creating, setCreating] = React.useState(false);
  const [confirm, setConfirm] = React.useState<null | 'delete' | 'recommend'>(null);
  const [history, setHistory] = React.useState<null | { oldWholesalePrice: number | null; wholesalePrice: number | null; retailPrice: number | null; changedAt: string }[]>(null);
  const invalid = validate(d);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const autosave = useAutosave(d, (v) => saveProductAction(toInput(v)), { enabled: !isNew && !invalid });

  const costs = React.useMemo(() => computeAllRecipeCosts(ws.recipes, ws.ingredients), [ws.recipes, ws.ingredients]);
  const live: Product = { ...d, wholesalePrice: d.wholesalePrice ?? 0 };
  const e = productEconomics(live, ws, costs);
  const unit = salesUnitLabel(live);
  const recipesForSelect = ws.recipes.filter((r) => !r.isSubrecipe && (r.status !== 'archived' || r.id === d.recipeId));
  const recipe = ws.recipes.find((r) => r.id === d.recipeId);

  const create = async () => {
    if (invalid) return toast.error(invalid);
    setCreating(true);
    const r = await saveProductAction(toInput(d));
    setCreating(false);
    if (r.ok) {
      toast.success('Výrobek přidán.');
      router.replace(`/products/${r.data!.id}`);
    } else toast.error(r.error);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild><Link href="/products"><ArrowLeft /> Výrobky</Link></Button>
        {!isNew ? <SaveIndicator state={autosave.state} error={autosave.error} onRetry={autosave.retry} /> : null}
      </div>
      <h1 className="mb-4 text-2xl font-semibold">{isNew ? 'Nový výrobek' : d.name || 'Výrobek'}</h1>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card className="space-y-4">
            <Field label="Název" htmlFor="p-name"><Input id="p-name" value={d.name} onChange={(ev) => set('name', ev.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kategorie" htmlFor="p-cat"><Input id="p-cat" value={d.category} onChange={(ev) => set('category', ev.target.value)} /></Field>
              <Field label="Prodejní jednotka" htmlFor="p-unit">
                <Select id="p-unit" value={d.salesUnit} onChange={(ev) => set('salesUnit', ev.target.value as Product['salesUnit'])}>
                  {Object.entries(SALES_UNIT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Navázaná receptura" htmlFor="p-recipe" hint={recipe ? undefined : 'Bez receptury nelze spočítat náklady.'}>
              <Select id="p-recipe" value={d.recipeId ?? ''} onChange={(ev) => set('recipeId', ev.target.value || null)}>
                <option value="">— bez receptury —</option>
                {recipesForSelect.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.yieldQuantity ?? '?'} {r.yieldUnit})</option>)}
              </Select>
            </Field>
            {d.salesUnit !== 'weight' ? (
              <Field label="Gramáž jednoho kusu (nepovinné)" htmlFor="p-weight" hint={recipe?.yieldUnit === 'g' ? 'Receptura je v gramech – gramáž je nutná pro výpočet nákladu kusu.' : undefined}>
                <NumberField id="p-weight" value={d.pieceWeight} onValueChange={(n) => set('pieceWeight', n)} suffix="g" min={0.001} />
              </Field>
            ) : null}
          </Card>

          <Card className="space-y-4">
            <CardTitle>Ceny</CardTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Velkoobchodní cena pro kavárnu / ${unit}`} htmlFor="p-ws">
                <NumberField id="p-ws" value={d.wholesalePrice} onValueChange={(n) => set('wholesalePrice', n)} allowEmpty={false} suffix="Kč" />
              </Field>
              <Field label={d.salesUnit === 'weight' ? 'Dopor. maloobchodní cena / 100 g' : 'Dopor. maloobchodní cena / porci'} htmlFor="p-rt">
                <NumberField id="p-rt" value={d.retailPrice} onValueChange={(n) => set('retailPrice', n)} suffix="Kč" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {d.salesUnit !== 'weight' ? (
                <Field label="Porcí z jednoho dodaného výrobku" htmlFor="p-port" hint="Např. medovník 20, chlebíček 12, kus 1.">
                  <NumberField id="p-port" value={d.retailPortions} onValueChange={(n) => set('retailPortions', n ?? 1)} min={0.001} allowEmpty={false} />
                </Field>
              ) : <p className="text-xs text-ink-muted">U hmotnostního prodeje se porovnává cena za 100 g.</p>}
              <Field label="Požadovaná marže" htmlFor="p-tm" hint={`Prázdné = výchozí ${formatPct(ws.settings.defaultTargetMarginPct, 0)} z Nastavení.`}>
                <NumberField id="p-tm" value={d.targetMarginPct} onValueChange={(n) => set('targetMarginPct', n)} max={99.99} suffix="%" />
              </Field>
            </div>
          </Card>

          <Card className="space-y-3">
            <Field label="Poznámky" htmlFor="p-notes"><Textarea id="p-notes" rows={3} value={d.notes ?? ''} onChange={(ev) => set('notes', ev.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm"><Switch checked={d.isActive} onCheckedChange={(c) => set('isActive', c)} aria-label="Aktivní" /> Aktivní (v nabídce)</label>
          </Card>

          {invalid && !isNew ? <Notice>{invalid} Změny se zatím neukládají.</Notice> : null}
          {isNew ? (
            <Button size="lg" className="w-full sm:w-auto" onClick={create} disabled={creating}><Plus /> {creating ? 'Ukládám…' : 'Vytvořit výrobek'}</Button>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardTitle>Ekonomika na {unit}</CardTitle>
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="Surovinový náklad" v={formatCzk(e.cost.unitCost)} testId="product-unit-cost" />
              <Row k="Cena pro kavárnu" v={formatCzk(d.wholesalePrice)} />
              <Row k="Rozdíl (příspěvek)" v={formatCzk(e.contribution)} strong />
              <Row k="Marže" v={formatPct(e.margin)} hint="(cena − náklad) / cena" />
              <Row k="Přirážka" v={formatPct(e.markup)} hint="(cena − náklad) / náklad" />
            </dl>
            {!e.cost.complete ? <Notice className="mt-3">{e.cost.issue ?? 'Náklad je neúplný.'}</Notice> : null}
            {e.recommended != null ? (
              <div className="mt-3 rounded-lg bg-sand/60 p-3 text-sm">
                <p>Doporučená minimální cena pro marži {formatPct(e.target, 0)}: <strong className="num">{formatCzk(e.recommended)}</strong></p>
                <p className="mt-1 text-xs text-ink-muted">Počítá se jen ze surovin – práce, obaly a provoz jsou v kalkulačce.</p>
                {Math.abs((d.wholesalePrice ?? 0) - e.recommended) >= 0.5 ? (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setConfirm('recommend')}><Wand2 /> Použít doporučenou cenu</Button>
                ) : null}
              </div>
            ) : null}
          </Card>

          {!isNew && e.cost.unitCost != null ? <PriceVariants product={live} ws={ws} unitCost={e.cost.unitCost} /> : null}

          {!isNew ? (
            <Card className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={async () => { const r = await productHistoryAction(d.id); if (r.ok) setHistory(r.data!); else toast.error(r.error); }}><History /> Historie cen</Button>
                <Button size="sm" variant="outline" onClick={() => set('isActive', !d.isActive)}>{d.isActive ? <><Archive /> Archivovat</> : <><ArchiveRestore /> Obnovit</>}</Button>
                <Button size="sm" variant="ghost" className="text-bad" onClick={() => setConfirm('delete')}><Trash2 /> Smazat</Button>
              </div>
              {history ? (
                <ul className="space-y-1 pt-2 text-sm" data-testid="price-history">
                  {history.length === 0 ? <li className="text-ink-muted">Žádné záznamy.</li> : history.map((h, i) => (
                    <li key={i} className="num flex justify-between gap-2"><span className="text-ink-muted">{formatDate(h.changedAt)}</span><span>{h.oldWholesalePrice != null ? `${formatCzk(h.oldWholesalePrice)} → ` : ''}{formatCzk(h.wholesalePrice)}</span></li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'recommend'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Použít doporučenou cenu?"
        description={`Cena pro kavárnu se změní z ${formatCzk(d.wholesalePrice)} na ${formatCzk(e.recommended != null ? Math.ceil(e.recommended) : null)} (zaokrouhleno nahoru na celé Kč).`}
        confirmLabel="Použít"
        onConfirm={() => { if (e.recommended != null) set('wholesalePrice', Math.ceil(e.recommended)); }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title="Smazat výrobek?"
        description="Výrobek, jeho historie cen a položka ve výrobním plánu budou trvale odstraněny. Uložené scénáře si zachovají své hodnoty. Pokud ho jen nechcete nabízet, raději ho archivujte."
        confirmLabel="Smazat"
        onConfirm={async () => { const r = await deleteProductAction(d.id); if (r.ok) { toast.success(r.message!); router.push('/products'); } else toast.error(r.error); }}
      />
    </div>
  );
}

function Row({ k, v, strong, hint, testId }: { k: string; v: string; strong?: boolean; hint?: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-soft">{k}{hint ? <span className="block text-[11px] text-ink-muted">{hint}</span> : null}</dt>
      <dd className={`num ${strong ? 'text-base font-semibold' : 'font-medium'}`} data-testid={testId}>{v}</dd>
    </div>
  );
}

/** Porovnání několika variant ceny bez přepsání uložené ceny. */
function PriceVariants({ product, ws, unitCost }: { product: Product; ws: Workspace; unitCost: number }) {
  const base = product.wholesalePrice;
  const [variants, setVariants] = React.useState<(number | null)[]>(() => [Math.max(0, Math.round(base - 5)), base, Math.round(base + 4)]);
  const qty = ws.plan[product.id] ?? 0;
  const activeProducts = ws.products.filter((p) => p.isActive || p.id === product.id).map((p) => (p.id === product.id ? product : p));
  const results = variants.map((price) =>
    price == null ? null : computePlan({ products: activeProducts, recipes: ws.recipes, ingredients: ws.ingredients, settings: ws.settings, quantities: ws.plan, priceOverrides: { [product.id]: price } }),
  );
  const unitsPerMonth = (product.salesUnit === 'weight' ? qty / 100 : qty) * ws.settings.bakingDaysPerMonth;
  return (
    <Card>
      <CardTitle>Cenové varianty</CardTitle>
      <p className="mt-1 text-xs text-ink-muted">Vyzkoušejte ceny bez uložení. Měsíční výsledek podle plánu v kalkulačce ({qty ? `${qty} ${product.salesUnit === 'weight' ? 'g' : 'ks'} na pečení` : 'výrobek zatím není v plánu'}).</p>
      <div className="mt-3 space-y-2">
        {variants.map((price, i) => {
          const r = results[i];
          return (
            <div key={i} className="rounded-lg border border-line p-2 text-sm">
              <div className="flex items-center gap-2">
                <NumberField aria-label={`Varianta ceny ${i + 1}`} value={price} onValueChange={(n) => setVariants((v) => v.map((x, j) => (j === i ? n : x)))} suffix="Kč" className="w-32" />
                <span className="num text-xs text-ink-soft">marže {formatPct(price != null ? marginPct(price, unitCost) : null)} · přirážka {formatPct(price != null ? markupPct(price, unitCost) : null, 0)}</span>
                {variants.length > 1 ? <button type="button" aria-label="Odebrat variantu" className="ml-auto text-ink-muted" onClick={() => setVariants((v) => v.filter((_, j) => j !== i))}><X className="size-4" /></button> : null}
              </div>
              {price != null && r ? (
                <div className="num mt-1 grid grid-cols-2 gap-1 text-xs">
                  <span>Příspěvek/měs.: <strong>{formatCzk((price - unitCost) * unitsPerMonth, { whole: true })}</strong></span>
                  <span>Provozní zisk/měs.: <strong>{formatCzk(r.monthly.operatingProfit, { whole: true })}</strong></span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {variants.length < 5 ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => setVariants((v) => [...v, base])}><Plus /> Přidat variantu</Button> : null}
      <p className="mt-2 text-xs text-ink-muted">Uložit a aplikovat cenový scénář pro více výrobků najednou můžete v <Link href="/calculator#scenare" className="underline">Kalkulačce</Link>.</p>
    </Card>
  );
}
