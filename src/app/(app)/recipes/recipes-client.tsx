'use client';
import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Ingredient, Product, Recipe } from '@/lib/calc';
import { computeAllRecipeCosts } from '@/lib/calc';
import { formatCzk, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Input, PageHeader, Select } from '@/components/ui/basic';

export const STATUS_LABEL = { draft: 'koncept', active: 'aktivní', archived: 'archiv' } as const;

export function unitCostLabel(unitCost: number | null, yieldUnit: Recipe['yieldUnit']) {
  if (unitCost == null) return '—';
  if (yieldUnit === 'ks') return `${formatCzk(unitCost)} / ks`;
  return `${formatCzk(unitCost * 100)} / 100 ${yieldUnit}`;
}

export function RecipesClient({ recipes, ingredients, products }: { recipes: Recipe[]; ingredients: Ingredient[]; products: Product[] }) {
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState<'current' | 'archived' | 'all'>('current');
  const costs = React.useMemo(() => computeAllRecipeCosts(recipes, ingredients), [recipes, ingredients]);
  const q = query.trim().toLocaleLowerCase('cs');
  const list = recipes.filter(
    (r) =>
      (status === 'all' || (status === 'archived' ? r.status === 'archived' : r.status !== 'archived')) &&
      (!q || r.name.toLocaleLowerCase('cs').includes(q) || r.items.some((it) => ingredients.find((i) => i.id === it.ingredientId)?.name.toLocaleLowerCase('cs').includes(q))),
  );
  return (
    <>
      <PageHeader
        title="Receptury"
        description="Složení a výtěžnost dávky. Náklad se počítá z aktuálních cen surovin."
        actions={<Button asChild><Link href="/recipes/new"><Plus /> Nová receptura</Link></Button>}
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input placeholder="Hledat recepturu nebo surovinu…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" aria-label="Hledat" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Stav">
          <option value="current">Aktivní a koncepty</option>
          <option value="archived">Archiv</option>
          <option value="all">Vše</option>
        </Select>
      </div>
      {recipes.length === 0 ? (
        <EmptyState title="Zatím žádné receptury" text="Vytvořte první recepturu a přidejte do ní suroviny." action={<Button asChild><Link href="/recipes/new"><Plus /> Nová receptura</Link></Button>} />
      ) : list.length === 0 ? (
        <EmptyState title="Nic nenalezeno" />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {list.map((r) => {
            const c = costs.get(r.id)!;
            const usedBy = products.filter((p) => p.recipeId === r.id).length;
            return (
              <li key={r.id}>
                <Link href={`/recipes/${r.id}`} className="block rounded-xl border border-line bg-paper p-3 transition-colors hover:border-brown-soft" data-testid="recipe-row">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{r.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.isSubrecipe ? <Badge tone="brown">polotovar</Badge> : null}
                        {r.status !== 'active' ? <Badge>{STATUS_LABEL[r.status]}</Badge> : null}
                        {c.complete ? (
                          r.isVerified ? <Badge tone="good"><CheckCircle2 className="size-3" />ověřeno</Badge> : <Badge>neověřeno</Badge>
                        ) : (
                          <Badge tone="warn"><AlertTriangle className="size-3" />neúplný náklad</Badge>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num font-semibold">{r.items.length === 0 ? '—' : formatCzk(c.batchCost)}</p>
                      <p className="text-xs text-ink-muted">za dávku</p>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-ink-muted">
                    <span>{r.items.length} položek · výtěžnost {r.yieldQuantity ? `${formatNumber(r.yieldQuantity)} ${r.yieldUnit}` : 'nevyplněna'}</span>
                    <span className="num">{unitCostLabel(c.unitCost, r.yieldUnit)}{usedBy ? ` · ${usedBy} výr.` : ''}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
