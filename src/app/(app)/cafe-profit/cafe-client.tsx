'use client';
import * as React from 'react';
import type { Workspace } from '@/lib/data/repo';
import type { Product } from '@/lib/calc';
import { cafeProfit, planQtyToSalesUnits, salesUnitLabel } from '@/lib/calc';
import { formatCzk, formatNumber, formatPct } from '@/lib/format';
import { Card, Notice, PageHeader } from '@/components/ui/basic';
import { NumberField } from '@/components/app/number-field';
import { SaveIndicator, useAutosave } from '@/components/app/autosave';
import { updateProductPricesAction } from '@/app/actions';

const SOLD_KEY = 'ztrouby.cafe.sold';

export function CafeClient({ ws }: { ws: Workspace }) {
  const products = ws.products.filter((p) => p.isActive);
  const [sold, setSold] = React.useState<Record<string, number | null>>({});
  React.useEffect(() => {
    try { setSold(JSON.parse(localStorage.getItem(SOLD_KEY) ?? '{}')); } catch { /* prohlížeč bez úložiště */ }
  }, []);
  const updateSold = (id: string, v: number | null) => setSold((s) => {
    const next = { ...s, [id]: v };
    try { localStorage.setItem(SOLD_KEY, JSON.stringify(next)); } catch { /* ignorovat */ }
    return next;
  });
  const vat = ws.settings;
  return (
    <>
      <PageHeader title="Zisk kavárny" description="Vyplatí se ceny i odběratelské kavárně? Upravte maloobchodní ceny a počet porcí." />
      <Notice tone="neutral" className="mb-4">
        Jde o <strong>hrubý rozdíl kavárny</strong> (tržba kavárny − nákup pečiva) <strong>před</strong> jejími dalšími náklady (personál, nájem, energie). Nejde o čistý zisk kavárny ani o tržby pekárny.{' '}
        Základ srovnání: {vat.vatEnabled ? `ceny bez DPH – maloobchodní ceny zadávejte s DPH, přepočítají se sazbou ${formatPct(vat.vatRatePct, 0)}; velkoobchodní ceny jsou bez DPH.` : 'zadané ceny bez samostatného výpočtu DPH (nastavení v Nastavení).'}
      </Notice>
      <ul className="space-y-3">
        {products.map((p) => <CafeRowView key={p.id} product={p} ws={ws} sold={sold[p.id] ?? null} onSold={(v) => updateSold(p.id, v)} />)}
      </ul>
      <Totals products={products} ws={ws} sold={sold} />
    </>
  );
}

function deliveredPerMonth(p: Product, ws: Workspace) {
  return planQtyToSalesUnits(p, ws.plan[p.id] ?? 0) * ws.settings.bakingDaysPerMonth;
}

function CafeRowView({ product, ws, sold, onSold }: { product: Product; ws: Workspace; sold: number | null; onSold: (v: number | null) => void }) {
  const [v, setV] = React.useState({ retailPrice: product.retailPrice, retailPortions: product.retailPortions as number | null });
  const save = useAutosave(v, (x) => updateProductPricesAction({ id: product.id, retailPrice: x.retailPrice, retailPortions: x.retailPortions ?? undefined }), { enabled: v.retailPortions != null && v.retailPortions > 0 });
  const live = { ...product, retailPrice: v.retailPrice, retailPortions: v.retailPortions ?? 1 };
  const delivered = deliveredPerMonth(product, ws);
  const perUnit = cafeProfit(live, ws.settings, 1);
  const month = cafeProfit(live, ws.settings, delivered, sold ?? undefined);
  const weight = product.salesUnit === 'weight';
  return (
    <li>
      <Card data-testid="cafe-row">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{product.name}</p>
            <p className="text-xs text-ink-muted">Kavárna platí {formatCzk(product.wholesalePrice)} za {salesUnitLabel(product)}</p>
          </div>
          <SaveIndicator state={save.state} error={save.error} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs text-ink-soft">Cena zákazníkovi / {weight ? '100 g' : 'porci'}
            <NumberField aria-label={`Maloobchodní cena – ${product.name}`} value={v.retailPrice} onValueChange={(n) => setV((s) => ({ ...s, retailPrice: n }))} suffix="Kč" className="mt-1" />
          </label>
          {!weight ? (
            <label className="text-xs text-ink-soft">Porcí z 1 {product.salesUnit === 'whole' ? 'výrobku' : 'kusu'}
              <NumberField aria-label={`Porce – ${product.name}`} value={v.retailPortions} onValueChange={(n) => setV((s) => ({ ...s, retailPortions: n }))} min={0.001} allowEmpty={false} className="mt-1" />
            </label>
          ) : <div className="text-xs text-ink-muted">Hmotnostní prodej: porovnává se cena za 100 g.</div>}
          <label className="text-xs text-ink-soft">Prodané {weight ? '100g dávky' : 'porce'} / měsíc
            <NumberField aria-label={`Prodané porce – ${product.name}`} value={sold} onValueChange={onSold} placeholder={formatNumber(delivered * perUnit.portionsPerUnit)} className="mt-1" />
          </label>
          <div className="text-xs text-ink-muted">Dodáno měsíčně: <span className="num block text-sm text-ink">{formatNumber(delivered)} × {salesUnitLabel(product)}</span></div>
        </div>
        {v.retailPrice == null ? <p className="mt-3 text-sm text-ink-muted">Zadejte maloobchodní cenu pro výpočet.</p> : (
          <dl className="num mt-3 grid grid-cols-2 gap-2 rounded-lg bg-sand/50 p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-ink-muted">Tržba kavárny z 1 {weight ? '100 g' : product.salesUnit === 'whole' ? 'výrobku' : 'kusu'}</dt><dd data-testid="cafe-unit-revenue">{formatCzk((perUnit.cafeRevenue ?? 0))}</dd></div>
            <div><dt className="text-xs text-ink-muted">Hrubý rozdíl / jednotku</dt><dd className="font-semibold" data-testid="cafe-unit-gross">{formatCzk(perUnit.grossPerUnit)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Hrubá marže kavárny</dt><dd className="font-semibold" data-testid="cafe-margin">{formatPct(perUnit.grossMarginPct)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Měsíčně: tržba / nákup / rozdíl</dt><dd>{formatCzk(month.cafeRevenue, { whole: true })} / {formatCzk(month.cafePurchaseCost, { whole: true })} / <strong>{formatCzk(month.grossDifference, { whole: true })}</strong></dd></div>
          </dl>
        )}
      </Card>
    </li>
  );
}

function Totals({ products, ws, sold }: { products: Product[]; ws: Workspace; sold: Record<string, number | null> }) {
  let rev = 0, cost = 0;
  for (const p of products) {
    if (p.retailPrice == null) continue;
    const r = cafeProfit(p, ws.settings, deliveredPerMonth(p, ws), sold[p.id] ?? undefined);
    rev += r.cafeRevenue ?? 0;
    cost += r.cafePurchaseCost;
  }
  return (
    <Card className="mt-4">
      <p className="text-sm text-ink-soft">Celkem za měsíc (výrobky s maloobchodní cenou, podle uložených cen a plánu)</p>
      <p className="num mt-1">Tržba kavárny <strong>{formatCzk(rev, { whole: true })}</strong> · nákup pečiva <strong>{formatCzk(cost, { whole: true })}</strong> · hrubý rozdíl <strong>{formatCzk(rev - cost, { whole: true })}</strong>{rev > 0 ? ` (${formatPct(((rev - cost) / rev) * 100)})` : ''}</p>
    </Card>
  );
}
