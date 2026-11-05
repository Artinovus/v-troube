'use client';
import * as React from 'react';
import { Plus, Search, Download, History, Trash2, AlertTriangle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import type { Ingredient, Recipe } from '@/lib/calc';
import { ingredientChangeImpact, recipesUsingIngredient } from '@/lib/calc';
import { formatCzk, formatDate, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select, Textarea, Notice } from '@/components/ui/basic';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { NumberField } from '@/components/app/number-field';
import { deleteIngredientAction, ingredientHistoryAction, saveIngredientAction } from '@/app/actions';

const CATEGORIES = ['mouka', 'tuky', 'mléčné výrobky', 'vejce', 'cukry', 'kypřidla', 'koření', 'semena', 'ovoce', 'ořechy', 'čokoláda', 'ostatní'];
const UNIT_LABEL = { g: 'g', ml: 'ml', ks: 'ks' } as const;

export function unitPriceText(i: Ingredient): string | null {
  if (i.packagePrice == null || !i.packageQuantity) return null;
  if (i.packageUnit === 'ks') return `${formatCzk(i.packagePrice / i.packageQuantity)} / ks`;
  return `${formatCzk((i.packagePrice / i.packageQuantity) * 1000)} / ${i.packageUnit === 'g' ? 'kg' : 'l'}`;
}

const emptyIngredient = (): Ingredient => ({
  id: '', name: '', category: 'ostatní', brand: null, supplier: null, packageQuantity: null, packageUnit: 'g',
  packagePrice: null, priceUpdatedAt: new Date().toISOString().slice(0, 10), note: null, isActive: true,
});

export function IngredientsClient({ ingredients, recipes }: { ingredients: Ingredient[]; recipes: Recipe[] }) {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);
  const [editing, setEditing] = React.useState<Ingredient | null>(null);

  const usage = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recipes) for (const it of r.items) if (it.ingredientId) m.set(it.ingredientId, (m.get(it.ingredientId) ?? 0) + 1);
    return m;
  }, [recipes]);

  const categories = React.useMemo(() => [...new Set([...CATEGORIES, ...ingredients.map((i) => i.category)])].sort((a, b) => a.localeCompare(b, 'cs')), [ingredients]);
  const q = query.trim().toLocaleLowerCase('cs');
  const filtered = ingredients.filter(
    (i) =>
      (showInactive || i.isActive) &&
      (!category || i.category === category) &&
      (!q || [i.name, i.brand, i.supplier].some((s) => s?.toLocaleLowerCase('cs').includes(q))),
  );
  const missing = ingredients.filter((i) => i.isActive && (i.packagePrice == null || !i.packageQuantity)).length;

  return (
    <>
      <PageHeader
        title="Suroviny"
        description="Zadávejte cenu celého balení, které jste koupila. Cena za gram se spočítá sama."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href="/api/export/ingredients" download><Download /> CSV</a>
            </Button>
            <Button onClick={() => setEditing(emptyIngredient())}><Plus /> Přidat surovinu</Button>
          </>
        }
      />
      {missing > 0 ? (
        <Notice className="mb-4">
          <AlertTriangle className="mr-1 inline size-4" />
          {missing} {missing === 1 ? 'surovina nemá' : missing < 5 ? 'suroviny nemají' : 'surovin nemá'} vyplněnou cenu nebo velikost balení – náklady receptur s nimi jsou neúplné.
        </Notice>
      ) : null}
      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input placeholder="Hledat surovinu, značku, obchod…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" aria-label="Hledat" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
          <option value="">Všechny kategorie</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Zobrazit neaktivní" /> Neaktivní
        </label>
      </div>

      {ingredients.length === 0 ? (
        <EmptyState title="Zatím žádné suroviny" text="Přidejte první surovinu i s cenou balení, které běžně kupujete." action={<Button onClick={() => setEditing(emptyIngredient())}><Plus /> Přidat surovinu</Button>} />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nic nenalezeno" text="Zkuste upravit hledání nebo filtr." />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {filtered.map((i) => {
            const up = unitPriceText(i);
            return (
              <li key={i.id}>
                <button type="button" onClick={() => setEditing(i)} className="w-full rounded-xl border border-line bg-paper p-3 text-left transition-colors hover:border-brown-soft" data-testid="ingredient-row">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.name}{!i.isActive ? <Badge className="ml-2">neaktivní</Badge> : null}</p>
                      <p className="truncate text-xs text-ink-muted">{[i.category, i.brand, i.supplier].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {i.packagePrice != null && i.packageQuantity ? (
                        <>
                          <p className="num font-semibold">{formatCzk(i.packagePrice)}</p>
                          <p className="num text-xs text-ink-muted">za {formatNumber(i.packageQuantity)} {UNIT_LABEL[i.packageUnit]}</p>
                        </>
                      ) : (
                        <Badge tone="warn">nevyplněno</Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                    <span className="num">{up ?? 'cena za jednotku nelze spočítat'}</span>
                    <span>{usage.get(i.id) ? `v ${usage.get(i.id)} recept.` : 'nepoužito'} · {formatDate(i.priceUpdatedAt)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing ? <IngredientDialog key={editing.id || 'new'} initial={editing} ingredients={ingredients} recipes={recipes} categories={categories} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

type History = { oldPrice: number | null; newPrice: number | null; oldPackageQuantity: number | null; packageQuantity: number | null; packageUnit: string | null; changedAt: string }[];

function IngredientDialog({ initial, ingredients, recipes, categories, onClose }: { initial: Ingredient; ingredients: Ingredient[]; recipes: Recipe[]; categories: string[]; onClose: () => void }) {
  const [v, setV] = React.useState<Ingredient>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [history, setHistory] = React.useState<History | null>(null);
  const isNew = !initial.id;
  const set = <K extends keyof Ingredient>(k: K, val: Ingredient[K]) => setV((p) => ({ ...p, [k]: val }));

  const priceChanged = !isNew && (v.packagePrice !== initial.packagePrice || v.packageQuantity !== initial.packageQuantity || v.packageUnit !== initial.packageUnit);
  const impact = React.useMemo(() => (priceChanged ? ingredientChangeImpact(recipes, ingredients, v) : []), [priceChanged, recipes, ingredients, v]);
  const usedIn = isNew ? [] : recipesUsingIngredient(recipes, initial.id).filter((r) => r.items.some((i) => i.ingredientId === initial.id));
  const up = unitPriceText(v);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveIngredientAction({ ...v, id: v.id || undefined });
    setSaving(false);
    if (res.ok) {
      toast.success(res.message ?? 'Uloženo');
      onClose();
    } else setError(res.error);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={isNew ? 'Nová surovina' : v.name || 'Surovina'} description="Zadejte obsah a cenu balení tak, jak jste ho koupila.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Název suroviny" htmlFor="ing-name">
          <Input id="ing-name" value={v.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategorie" htmlFor="ing-cat">
            <Input id="ing-cat" list="ing-cats" value={v.category} onChange={(e) => set('category', e.target.value)} required />
            <datalist id="ing-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Značka (nepovinné)" htmlFor="ing-brand">
            <Input id="ing-brand" value={v.brand ?? ''} onChange={(e) => set('brand', e.target.value || null)} />
          </Field>
        </div>
        <Field label="Obchod / dodavatel (nepovinné)" htmlFor="ing-sup">
          <Input id="ing-sup" value={v.supplier ?? ''} onChange={(e) => set('supplier', e.target.value || null)} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
          <Field label="Obsah balení" htmlFor="ing-qty">
            <NumberField id="ing-qty" value={v.packageQuantity} onValueChange={(n) => set('packageQuantity', n)} placeholder="např. 250" min={0.001} />
          </Field>
          <Field label="Jednotka" htmlFor="ing-unit">
            <Select id="ing-unit" value={v.packageUnit} onChange={(e) => set('packageUnit', e.target.value as Ingredient['packageUnit'])}>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="ks">ks</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cena celého balení" htmlFor="ing-price" hint={up ? `= ${up}` : 'Bez ceny bude náklad neúplný.'}>
            <NumberField id="ing-price" value={v.packagePrice} onValueChange={(n) => set('packagePrice', n)} suffix="Kč" placeholder="např. 65" />
          </Field>
          <Field label="Datum nákupu / ceny" htmlFor="ing-date">
            <Input id="ing-date" type="date" value={v.priceUpdatedAt ?? ''} onChange={(e) => set('priceUpdatedAt', e.target.value || null)} />
          </Field>
        </div>
        <Field label="Poznámka" htmlFor="ing-note">
          <Textarea id="ing-note" value={v.note ?? ''} onChange={(e) => set('note', e.target.value || null)} rows={2} />
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={v.isActive} onCheckedChange={(c) => set('isActive', c)} aria-label="Aktivní" /> Aktivní surovina
        </label>

        {impact.length > 0 ? (
          <div className="rounded-lg border border-line bg-sand/50 p-3" data-testid="price-impact">
            <p className="mb-2 text-sm font-medium">Změna se dotkne {impact.length} {impact.length === 1 ? 'receptury' : 'receptur'}:</p>
            <ul className="space-y-1 text-sm">
              {impact.map((r) => (
                <li key={r.recipeId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{r.name}</span>
                  <span className="num flex items-center gap-1 text-ink-soft">
                    {formatCzk(r.oldUnitCost)} <ArrowRight className="size-3" /> <strong className="text-ink">{formatCzk(r.newUnitCost)}</strong>
                    <span className="text-xs">/ {r.yieldUnit}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : usedIn.length > 0 ? (
          <p className="text-xs text-ink-muted">Použito v: {usedIn.map((r) => r.name).join(', ')}</p>
        ) : null}

        {history ? (
          <div className="rounded-lg border border-line p-3 text-sm">
            <p className="mb-2 font-medium">Historie cen</p>
            {history.length === 0 ? <p className="text-ink-muted">Zatím žádné změny.</p> : (
              <ul className="space-y-1">
                {history.map((h, i) => (
                  <li key={i} className="num flex justify-between gap-2">
                    <span className="text-ink-muted">{formatDate(h.changedAt)}</span>
                    <span>{h.oldPrice != null ? `${formatCzk(h.oldPrice)} → ` : ''}{formatCzk(h.newPrice)} za {formatNumber(h.packageQuantity)} {h.packageUnit}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex gap-1">
            {!isNew ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={async () => { const r = await ingredientHistoryAction(initial.id); if (r.ok) setHistory(r.data!); else toast.error(r.error); }}>
                  <History /> Historie
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-bad" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Smazat
                </Button>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Zrušit</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Ukládám…' : 'Uložit'}</Button>
          </div>
        </div>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title="Smazat surovinu?"
        confirmLabel="Smazat"
        description={usedIn.length ? `Surovina je použita v recepturách (${usedIn.map((r) => r.name).join(', ')}) a nelze ji smazat. Můžete ji deaktivovat.` : 'Surovina a její historie cen budou trvale odstraněny.'}
        onConfirm={async () => {
          const r = await deleteIngredientAction(initial.id);
          if (r.ok) { toast.success(r.message ?? 'Smazáno'); onClose(); } else toast.error(r.error);
        }}
      />
    </Dialog>
  );
}
