'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Archive, Trash2, Plus, X, AlertTriangle, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import type { Ingredient, Product, Recipe, RecipeItem, UsageUnit } from '@/lib/calc';
import { compatibleUnits, computeAllRecipeCosts, LINE_ISSUE_TEXT, productCost, salesUnitLabel, wouldCreateCycle } from '@/lib/calc';
import { formatCzk, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardTitle, Field, Input, Notice, Select, Textarea } from '@/components/ui/basic';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { NumberField } from '@/components/app/number-field';
import { SaveIndicator, useAutosave } from '@/components/app/autosave';
import { deleteRecipeAction, duplicateRecipeAction, saveRecipeAction, setRecipeStatusAction } from '@/app/actions';
import { unitCostLabel } from '../recipes-client';

interface DraftItem {
  key: string;
  /** "i:<id>" surovina, "r:<id>" polotovar, "" nevybráno */
  ref: string;
  quantity: number | null;
  unit: UsageUnit;
}
interface Draft {
  name: string;
  description: string;
  notes: string;
  yieldQuantity: number | null;
  yieldUnit: Recipe['yieldUnit'];
  isSubrecipe: boolean;
  isVerified: boolean;
  items: DraftItem[];
}

let keySeq = 0;
const newKey = () => `k${Date.now().toString(36)}${++keySeq}`;

function toDraft(r: Recipe | null): Draft {
  return {
    name: r?.name ?? '',
    description: r?.description ?? '',
    notes: r?.notes ?? '',
    yieldQuantity: r?.yieldQuantity ?? null,
    yieldUnit: r?.yieldUnit ?? 'ks',
    isSubrecipe: r?.isSubrecipe ?? false,
    isVerified: r?.isVerified ?? false,
    items: (r?.items ?? []).map((it) => ({ key: it.id || newKey(), ref: it.ingredientId ? `i:${it.ingredientId}` : `r:${it.subRecipeId}`, quantity: it.quantity, unit: it.unit })),
  };
}

function draftItems(d: Draft): RecipeItem[] {
  return d.items
    .filter((it) => it.ref && it.quantity != null && it.quantity > 0)
    .map((it) => ({ id: it.key, ingredientId: it.ref.startsWith('i:') ? it.ref.slice(2) : null, subRecipeId: it.ref.startsWith('r:') ? it.ref.slice(2) : null, quantity: it.quantity!, unit: it.unit }));
}

function validate(d: Draft): string | null {
  if (!d.name.trim()) return 'Vyplňte název receptury.';
  if (d.items.some((it) => !it.ref)) return 'U každého řádku vyberte surovinu nebo polotovar.';
  if (d.items.some((it) => !(it.quantity != null && it.quantity > 0))) return 'U každého řádku zadejte množství větší než 0.';
  return null;
}

export function RecipeEditor({ initial, recipes, ingredients, products }: { initial: Recipe | null; recipes: Recipe[]; ingredients: Ingredient[]; products: Product[] }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(initial));
  const idRef = React.useRef<string | null>(initial?.id ?? null);
  const [status, setStatus] = React.useState(initial?.status ?? 'active');
  const [confirm, setConfirm] = React.useState<null | 'delete' | 'archive'>(null);
  const invalid = validate(draft);
  const selfId = idRef.current ?? '__new__';

  const ingById = React.useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const recById = React.useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  const current: Recipe = React.useMemo(
    () => ({ id: selfId, name: draft.name, description: draft.description, notes: draft.notes, yieldQuantity: draft.yieldQuantity, yieldUnit: draft.yieldUnit, status, isSubrecipe: draft.isSubrecipe, isVerified: draft.isVerified, items: draftItems(draft) }),
    [draft, selfId, status],
  );
  const allRecipes = React.useMemo(() => [...recipes.filter((r) => r.id !== selfId), current], [recipes, current, selfId]);
  const costs = React.useMemo(() => computeAllRecipeCosts(allRecipes, ingredients), [allRecipes, ingredients]);
  const cost = costs.get(selfId)!;
  const lineByKey = new Map(cost.lines.map((l) => [l.itemId, l]));
  const linkedProducts = products.filter((p) => p.recipeId && p.recipeId === idRef.current);
  const subrecipeOptions = recipes.filter((r) => r.isSubrecipe && r.id !== selfId && r.status !== 'archived' && !(idRef.current && wouldCreateCycle(recipes, idRef.current, r.id)));

  const save = React.useCallback(
    async (d: Draft) => {
      const res = await saveRecipeAction({
        id: idRef.current ?? undefined,
        name: d.name,
        description: d.description || null,
        notes: d.notes || null,
        yieldQuantity: d.yieldQuantity,
        yieldUnit: d.yieldUnit,
        status,
        isSubrecipe: d.isSubrecipe,
        isVerified: d.isVerified,
        items: d.items.map((it) => ({ ingredientId: it.ref.startsWith('i:') ? it.ref.slice(2) : null, subRecipeId: it.ref.startsWith('r:') ? it.ref.slice(2) : null, quantity: it.quantity, unit: it.unit, note: null })),
      });
      if (res.ok && !idRef.current && res.data) {
        idRef.current = res.data.id;
        window.history.replaceState(null, '', `/recipes/${res.data.id}`);
      }
      return res;
    },
    [status],
  );
  const autosave = useAutosave(draft, save, { enabled: !invalid });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (key: string, patch: Partial<DraftItem>) => setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));

  const baseUnitOf = (ref: string) => {
    if (ref.startsWith('i:')) return ingById.get(ref.slice(2))?.packageUnit ?? 'g';
    if (ref.startsWith('r:')) return recById.get(ref.slice(2))?.yieldUnit ?? 'g';
    return 'g';
  };

  const changeStatus = async (s: Recipe['status']) => {
    if (!idRef.current) return setStatus(s);
    const r = await setRecipeStatusAction(idRef.current, s);
    if (r.ok) { setStatus(s); toast.success(r.message ?? 'Uloženo'); } else toast.error(r.error);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild><Link href="/recipes"><ArrowLeft /> Receptury</Link></Button>
        <SaveIndicator state={invalid && autosave.state === 'dirty' ? 'dirty' : autosave.state} error={autosave.error} onRetry={autosave.retry} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="space-y-4">
            <Field label="Název receptury" htmlFor="r-name">
              <Input id="r-name" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="např. Skořicové uzly" />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
              <Field label="Výtěžnost dávky" htmlFor="r-yield" hint={draft.yieldUnit === 'ks' ? 'Kolik kusů / celých výrobků vznikne z jedné dávky.' : 'Hmotnost hotového výrobku z jedné dávky.'}>
                <NumberField id="r-yield" value={draft.yieldQuantity} onValueChange={(n) => set('yieldQuantity', n)} min={0.001} placeholder="např. 12" />
              </Field>
              <Field label="Jednotka" htmlFor="r-yunit">
                <Select id="r-yunit" value={draft.yieldUnit} onChange={(e) => set('yieldUnit', e.target.value as Recipe['yieldUnit'])}>
                  <option value="ks">ks</option>
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                </Select>
              </Field>
            </div>
            <Field label="Popis" htmlFor="r-desc">
              <Textarea id="r-desc" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <label className="flex items-center gap-2"><Switch checked={draft.isSubrecipe} onCheckedChange={(c) => set('isSubrecipe', c)} aria-label="Polotovar" /> Polotovar (např. základní těsto)</label>
              <label className="flex items-center gap-2"><Switch checked={draft.isVerified} onCheckedChange={(c) => set('isVerified', c)} aria-label="Ověřeno" /> Gramáže ověřeny</label>
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <CardTitle>Suroviny v dávce</CardTitle>
              <span className="text-xs text-ink-muted">{draft.items.length} položek</span>
            </div>
            {draft.items.length === 0 ? <p className="mb-3 text-sm text-ink-muted">Receptura zatím nemá žádné suroviny.</p> : null}
            <ul className="space-y-2">
              {draft.items.map((it, idx) => {
                const line = lineByKey.get(it.key);
                const units = compatibleUnits(baseUnitOf(it.ref));
                return (
                  <li key={it.key} className="rounded-lg border border-line p-2" data-testid="recipe-line">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_110px_80px_100px_auto] sm:items-center">
                      <Select
                        aria-label={`Surovina ${idx + 1}`}
                        value={it.ref}
                        onChange={(e) => {
                          const ref = e.target.value;
                          const u = compatibleUnits(baseUnitOf(ref));
                          setItem(it.key, { ref, unit: u.includes(it.unit) ? it.unit : u[0] });
                        }}
                        className="col-span-1"
                      >
                        <option value="">— vyberte —</option>
                        <optgroup label="Suroviny">
                          {ingredients.filter((i) => i.isActive || it.ref === `i:${i.id}`).map((i) => (
                            <option key={i.id} value={`i:${i.id}`}>{i.name}{i.brand ? ` (${i.brand})` : ''}{i.packagePrice == null ? ' – bez ceny' : ''}</option>
                          ))}
                        </optgroup>
                        {subrecipeOptions.length || it.ref.startsWith('r:') ? (
                          <optgroup label="Polotovary">
                            {subrecipeOptions.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
                            {it.ref.startsWith('r:') && !subrecipeOptions.some((r) => `r:${r.id}` === it.ref) ? <option value={it.ref}>{recById.get(it.ref.slice(2))?.name ?? 'Polotovar'}</option> : null}
                          </optgroup>
                        ) : null}
                      </Select>
                      <Button type="button" variant="ghost" size="icon" aria-label="Odebrat řádek" className="sm:order-last" onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((x) => x.key !== it.key) }))}>
                        <X />
                      </Button>
                      <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_80px_1fr] items-center gap-2 sm:col-span-3 sm:grid-cols-[110px_80px_100px]">
                        <NumberField aria-label={`Množství ${idx + 1}`} value={it.quantity} onValueChange={(n) => setItem(it.key, { quantity: n })} min={0.001} placeholder="množství" />
                        <Select aria-label={`Jednotka ${idx + 1}`} value={it.unit} onChange={(e) => setItem(it.key, { unit: e.target.value as UsageUnit })}>
                          {units.map((u) => <option key={u} value={u}>{u}</option>)}
                        </Select>
                        <span className="num text-right text-sm font-medium" data-testid="line-cost">{line?.cost != null ? formatCzk(line.cost) : '—'}</span>
                      </div>
                    </div>
                    {line?.issue ? <p className="mt-1 text-xs text-warn"><AlertTriangle className="mr-1 inline size-3" />{LINE_ISSUE_TEXT[line.issue]}</p> : line?.warning ? <p className="mt-1 text-xs text-ink-muted">{LINE_ISSUE_TEXT[line.warning]}</p> : null}
                  </li>
                );
              })}
            </ul>
            <Button type="button" variant="secondary" className="mt-3 w-full sm:w-auto" onClick={() => setDraft((d) => ({ ...d, items: [...d.items, { key: newKey(), ref: '', quantity: null, unit: 'g' }] }))}>
              <Plus /> Přidat surovinu
            </Button>
            <p className="mt-2 text-xs text-ink-muted">Chybí surovina? <Link href="/ingredients" className="underline">Přidejte ji v Surovinách</Link>.</p>
          </Card>

          <Card>
            <Field label="Poznámky" htmlFor="r-notes">
              <Textarea id="r-notes" rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardTitle>Náklad</CardTitle>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Cena celé dávky</dt><dd className="num text-lg font-semibold" data-testid="batch-cost">{draft.items.length ? formatCzk(cost.batchCost) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Výtěžnost</dt><dd className="num">{draft.yieldQuantity ? `${formatNumber(draft.yieldQuantity)} ${draft.yieldUnit}` : 'nevyplněno'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Náklad na jednotku</dt><dd className="num font-semibold" data-testid="unit-cost">{cost.unitCost != null ? (draft.yieldUnit === 'ks' ? `${formatCzk(cost.unitCost)} / ks` : `${formatCzk(cost.unitCost, {})} / ${draft.yieldUnit}`) : '—'}</dd></div>
              {draft.yieldUnit !== 'ks' && cost.unitCost != null ? (
                <div className="flex justify-between"><dt className="text-ink-soft">Na 100 {draft.yieldUnit}</dt><dd className="num font-semibold">{formatCzk(cost.unitCost * 100)}</dd></div>
              ) : null}
            </dl>
            {cost.issues.length ? (
              <Notice className="mt-3">
                <p className="font-medium">Náklad je neúplný – nejde o přesný výpočet.</p>
                <ul className="mt-1 list-disc pl-4 text-xs">{cost.issues.map((i) => <li key={i}>{i}</li>)}</ul>
              </Notice>
            ) : !draft.isVerified ? (
              <p className="mt-3 text-xs text-ink-muted">Gramáže nejsou označené jako ověřené.</p>
            ) : null}
            {invalid ? <p className="mt-3 text-xs text-warn">{invalid} Do té doby se změny neukládají.</p> : null}
          </Card>

          {linkedProducts.length ? (
            <Card>
              <CardTitle>Výrobky z receptury</CardTitle>
              <ul className="mt-2 space-y-1 text-sm">
                {linkedProducts.map((p) => {
                  const pc = productCost(p, current, cost);
                  return (
                    <li key={p.id} className="flex justify-between gap-2">
                      <Link href={`/products/${p.id}`} className="underline-offset-2 hover:underline">{p.name}</Link>
                      <span className="num text-ink-soft">{formatCzk(pc.unitCost)} / {salesUnitLabel(p)}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          {idRef.current ? (
            <Card className="space-y-2">
              <p className="text-xs text-ink-muted">Stav: <Badge>{status === 'draft' ? 'koncept' : status === 'archived' ? 'archiv' : 'aktivní'}</Badge></p>
              <div className="flex flex-wrap gap-2">
                {status === 'draft' ? <Button size="sm" variant="secondary" onClick={() => changeStatus('active')}>Označit jako aktivní</Button> : null}
                <Button size="sm" variant="outline" onClick={async () => { await autosave.flush(); const r = await duplicateRecipeAction(idRef.current!); if (r.ok) { toast.success(r.message!); router.push(`/recipes/${r.data!.id}`); } else toast.error(r.error); }}>
                  <Copy /> Duplikovat
                </Button>
                {status === 'archived' ? (
                  <Button size="sm" variant="outline" onClick={() => changeStatus('active')}><ArchiveRestore /> Obnovit</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirm('archive')}><Archive /> Archivovat</Button>
                )}
                <Button size="sm" variant="ghost" className="text-bad" onClick={() => setConfirm('delete')}><Trash2 /> Smazat</Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archivovat recepturu?"
        description="Receptura zmizí z běžného seznamu, ale zůstane zachována i s vazbami. Kdykoliv ji můžete obnovit."
        confirmLabel="Archivovat"
        onConfirm={() => changeStatus('archived')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title="Smazat recepturu?"
        description={linkedProducts.length ? `Recepturu používá ${linkedProducts.length} výrobek/výrobky, proto ji nelze smazat. Můžete ji archivovat.` : 'Receptura bude trvale odstraněna. Tuto akci nelze vrátit.'}
        confirmLabel="Smazat"
        onConfirm={async () => {
          const r = await deleteRecipeAction(idRef.current!);
          if (r.ok) { toast.success(r.message!); router.push('/recipes'); } else toast.error(r.error);
        }}
      />
    </div>
  );
}
