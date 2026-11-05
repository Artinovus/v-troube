'use client';
import * as React from 'react';
import Link from 'next/link';
import { Plus, Download, AlertTriangle, ChevronRight } from 'lucide-react';
import type { Workspace } from '@/lib/data/repo';
import type { Product } from '@/lib/calc';
import { computeAllRecipeCosts, salesUnitLabel } from '@/lib/calc';
import { formatCzk, formatPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, PageHeader, Select } from '@/components/ui/basic';
import { NumberField } from '@/components/app/number-field';
import { SaveIndicator, useAutosave } from '@/components/app/autosave';
import { updateProductPricesAction } from '@/app/actions';
import { productEconomics } from './product-utils';

export function ProductsClient({ ws }: { ws: Workspace }) {
  const [filter, setFilter] = React.useState<'active' | 'inactive' | 'all'>('active');
  const costs = React.useMemo(() => computeAllRecipeCosts(ws.recipes, ws.ingredients), [ws.recipes, ws.ingredients]);
  const list = ws.products.filter((p) => filter === 'all' || (filter === 'active' ? p.isActive : !p.isActive));
  return (
    <>
      <PageHeader
        title="Výrobky a ceny"
        description="Co a za kolik prodáváte kavárnám. Ceny upravíte přímo v seznamu – ukládají se automaticky."
        actions={
          <>
            <Button variant="outline" asChild><a href="/api/export/products" download><Download /> Ceník CSV</a></Button>
            <Button asChild size="lg"><Link href="/products/new"><Plus /> Přidat výrobek</Link></Button>
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto" aria-label="Filtr">
          <option value="active">Aktivní výrobky</option>
          <option value="inactive">Archivované</option>
          <option value="all">Vše</option>
        </Select>
        <span className="text-xs text-ink-muted">Marže = rozdíl / cena. Přirážka = rozdíl / náklad.</span>
      </div>
      {ws.products.length === 0 ? (
        <EmptyState title="Zatím žádné výrobky" text="Přidejte první výrobek a navažte ho na recepturu." action={<Button asChild><Link href="/products/new"><Plus /> Přidat výrobek</Link></Button>} />
      ) : list.length === 0 ? (
        <EmptyState title="V tomto filtru nic není" />
      ) : (
        <ul className="space-y-2">
          {list.map((p) => <ProductRow key={p.id} product={p} ws={ws} costs={costs} />)}
        </ul>
      )}
    </>
  );
}

function ProductRow({ product, ws, costs }: { product: Product; ws: Workspace; costs: ReturnType<typeof computeAllRecipeCosts> }) {
  const [prices, setPrices] = React.useState({ wholesalePrice: product.wholesalePrice as number | null, retailPrice: product.retailPrice });
  const valid = prices.wholesalePrice != null;
  const autosave = useAutosave(prices, (v) => updateProductPricesAction({ id: product.id, wholesalePrice: v.wholesalePrice ?? undefined, retailPrice: v.retailPrice }), { enabled: valid });
  const live = { ...product, wholesalePrice: prices.wholesalePrice ?? 0, retailPrice: prices.retailPrice };
  const e = productEconomics(live, ws, costs);
  const unit = salesUnitLabel(product);
  return (
    <li className="rounded-xl border border-line bg-paper p-3" data-testid="product-row">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/products/${product.id}`} className="group min-w-0">
          <p className="font-medium group-hover:underline">{product.name} <ChevronRight className="inline size-4 text-ink-muted" /></p>
          <p className="text-xs text-ink-muted">{product.category} · za {unit}{e.recipe ? ` · ${e.recipe.name}` : ' · bez receptury'}</p>
        </Link>
        <div className="flex flex-col items-end gap-1">
          {!product.isActive ? <Badge>archiv</Badge> : null}
          <SaveIndicator state={autosave.state} error={autosave.error} onRetry={autosave.retry} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[140px_140px_1fr]">
        <label className="text-xs text-ink-soft">
          Cena kavárně / {unit}
          <NumberField aria-label={`Cena kavárně – ${product.name}`} value={prices.wholesalePrice} onValueChange={(n) => setPrices((p) => ({ ...p, wholesalePrice: n }))} allowEmpty={false} suffix="Kč" className="mt-1" />
        </label>
        <label className="text-xs text-ink-soft">
          Dopor. MO cena / {product.salesUnit === 'weight' ? '100 g' : 'porci'}
          <NumberField aria-label={`Maloobchodní cena – ${product.name}`} value={prices.retailPrice} onValueChange={(n) => setPrices((p) => ({ ...p, retailPrice: n }))} suffix="Kč" className="mt-1" />
        </label>
        <dl className="col-span-2 grid grid-cols-4 gap-2 text-xs sm:col-span-1">
          <div><dt className="text-ink-muted">Suroviny</dt><dd className="num text-sm font-medium">{formatCzk(e.cost.unitCost)}</dd></div>
          <div><dt className="text-ink-muted">Rozdíl</dt><dd className="num text-sm font-medium">{formatCzk(e.contribution)}</dd></div>
          <div><dt className="text-ink-muted">Marže</dt><dd className="num text-sm font-medium">{formatPct(e.margin)}</dd></div>
          <div><dt className="text-ink-muted">Přirážka</dt><dd className="num text-sm font-medium">{formatPct(e.markup, 0)}</dd></div>
        </dl>
      </div>
      {!e.cost.complete ? (
        <p className="mt-2 text-xs text-warn"><AlertTriangle className="mr-1 inline size-3" />{e.cost.issue ?? 'Náklad je neúplný.'}</p>
      ) : e.recommended != null && prices.wholesalePrice != null && prices.wholesalePrice < e.recommended ? (
        <p className="mt-2 text-xs text-ink-soft">Pod doporučenou minimální cenou {formatCzk(e.recommended)} (marže {formatPct(e.target, 0)}).</p>
      ) : null}
    </li>
  );
}
