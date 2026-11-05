'use client';
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Calculator } from 'lucide-react';
import type { Workspace } from '@/lib/data/repo';
import { computePlan, salesUnitLabel } from '@/lib/calc';
import { formatCzk, formatNumber, formatPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Notice, PageHeader } from '@/components/ui/basic';
import { CostStructure, MonthlyKpis } from '@/components/app/results';

export function Dashboard({ ws }: { ws: Workspace }) {
  const products = ws.products.filter((p) => p.isActive);
  const plan = React.useMemo(() => computePlan({ products, recipes: ws.recipes, ingredients: ws.ingredients, settings: ws.settings, quantities: ws.plan }), [products, ws]);
  const empty = plan.monthly.revenue === 0;
  const days = ws.settings.bakingDaysPerMonth;
  return (
    <>
      <PageHeader
        title="Přehled"
        description={`Měsíc při ${formatNumber(days)} pečeních po ${formatNumber(ws.settings.hoursPerBakingDay)} h. Tržby jsou příjmy pekárny z dodávek kavárnám.`}
        actions={<Button variant="outline" asChild><Link href="/calculator"><Calculator /> Upravit plán</Link></Button>}
      />
      {empty ? (
        <Notice tone="neutral" className="mb-4">Výrobní plán je zatím prázdný. V <Link href="/calculator" className="underline">Kalkulačce</Link> zadejte, kolik kusů vyrobíte při jednom pečení.</Notice>
      ) : null}
      {plan.warnings.length ? (
        <Notice className="mb-4"><AlertTriangle className="mr-1 inline size-4" />Některé náklady nejsou úplné (chybí ceny surovin nebo suroviny v recepturách). Výsledky jsou orientační.</Notice>
      ) : null}
      <MonthlyKpis plan={plan} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardTitle>Výrobky</CardTitle>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm" data-testid="dashboard-products">
              <thead className="text-left text-xs text-ink-muted">
                <tr><th className="py-1 font-normal">Výrobek</th><th className="text-right font-normal">Náklad surovin</th><th className="text-right font-normal">Cena kavárně</th><th className="text-right font-normal">Příspěvek</th><th className="text-right font-normal">Marže</th><th className="text-right font-normal">Příspěvek / měsíc</th></tr>
              </thead>
              <tbody className="num">
                {plan.rows.map((r) => (
                  <tr key={r.product.id} className="border-t border-line">
                    <td className="py-2"><Link href={`/products/${r.product.id}`} className="hover:underline">{r.product.name}</Link><span className="block text-xs text-ink-muted">za {salesUnitLabel(r.product)}{r.planQty ? ` · ${formatNumber(r.planQty)} ${r.product.salesUnit === 'weight' ? 'g' : 'ks'}/pečení` : ''}</span></td>
                    <td className="text-right">{formatCzk(r.cost.unitCost)}{!r.cost.complete ? <AlertTriangle className="ml-1 inline size-3 text-warn" aria-label="neúplný náklad" /> : null}</td>
                    <td className="text-right">{formatCzk(r.price)}</td>
                    <td className="text-right">{formatCzk(r.contributionPerUnit)}</td>
                    <td className="text-right">{formatPct(r.marginPct, 0)}</td>
                    <td className="text-right">{r.contributionPerUnit != null ? formatCzk(r.contributionPerUnit * r.salesUnitsPerDay * days, { whole: true }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Příspěvek = cena pro kavárnu − surovinový náklad (před prací, obaly a provozem).</p>
        </Card>
        <CostStructure plan={plan} />
      </div>
    </>
  );
}
