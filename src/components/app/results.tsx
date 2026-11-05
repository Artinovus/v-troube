import type { PlanResult } from '@/lib/calc';
import { formatCzk, formatNumber, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardTitle } from '@/components/ui/basic';

export function Kpi({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'neutral'; testId?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={cn('num mt-1 text-xl font-semibold', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')} data-testid={testId}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-muted">{sub}</p> : null}
    </div>
  );
}

const tone = (v: number | null) => (v == null ? 'neutral' : v >= 0 ? 'good' : 'bad');

/** Struktura měsíčních nákladů – jednobarevné pruhy s hodnotami (podíl na tržbách). */
export function CostStructure({ plan }: { plan: PlanResult }) {
  const m = plan.monthly;
  const items = [
    { k: 'Suroviny', v: m.material },
    { k: 'Vlastní práce', v: m.labor },
    { k: 'Balení', v: m.packaging },
    { k: 'Doprava', v: m.delivery },
    { k: 'Energie a provozovna', v: m.energy },
    { k: 'Ostatní náklady', v: m.other },
  ];
  const max = Math.max(m.revenue, m.totalCosts, 1);
  return (
    <Card>
      <CardTitle>Měsíční náklady vs. tržby</CardTitle>
      <div className="mt-3 space-y-2 text-sm">
        <Bar label="Tržby z dodávek" value={m.revenue} max={max} strong />
        {items.map((i) => <Bar key={i.k} label={i.k} value={i.v} max={max} share={m.revenue > 0 ? (i.v / m.revenue) * 100 : null} />)}
        <div className="border-t border-line pt-2"><Bar label="Náklady celkem" value={m.totalCosts} max={max} strong /></div>
      </div>
    </Card>
  );
}

function Bar({ label, value, max, share, strong }: { label: string; value: number; max: number; share?: number | null; strong?: boolean }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div title={`${label}: ${formatCzk(value)}${share != null ? ` (${formatPct(share)} tržeb)` : ''}`}>
      <div className="flex justify-between gap-2">
        <span className={strong ? 'font-medium' : 'text-ink-soft'}>{label}</span>
        <span className="num">{formatCzk(value, { whole: true })}{share != null ? <span className="ml-1 text-xs text-ink-muted">{formatPct(share, 0)}</span> : null}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-sand">
        <div className={cn('h-2 rounded-full', strong ? 'bg-brown-dark' : 'bg-brown-soft')} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

export function MonthlyKpis({ plan }: { plan: PlanResult }) {
  const m = plan.monthly;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Kpi label="Moje měsíční tržby" value={formatCzk(m.revenue, { whole: true })} sub="z dodávek kavárnám" testId="kpi-revenue" />
      <Kpi label="Před oceněním práce" value={formatCzk(m.profitBeforeLabor, { whole: true })} sub="tržby − náklady bez práce" tone={tone(m.profitBeforeLabor)} testId="kpi-before-labor" />
      <Kpi label="Provozní zisk po práci" value={formatCzk(m.operatingProfit, { whole: true })} sub={`práce ${formatCzk(m.labor, { whole: true })}`} tone={tone(m.operatingProfit)} testId="kpi-profit" />
      <Kpi label="Rentabilita tržeb" value={formatPct(m.returnOnSalesPct)} sub="provozní zisk / tržby" tone={tone(m.returnOnSalesPct)} testId="kpi-ros" />
      <Kpi label="Suroviny" value={formatCzk(m.material, { whole: true })} sub={`teoreticky ${formatCzk(m.materialTheoretical, { whole: true })}`} />
      <Kpi label="Balení" value={formatCzk(m.packaging, { whole: true })} />
      <Kpi label="Hodnota vlastní práce" value={formatCzk(m.labor, { whole: true })} sub={`${formatNumber(m.hours)} h měsíčně`} />
      <Kpi label="Provoz (energie)" value={formatCzk(m.energy, { whole: true })} />
      <Kpi label="Doprava" value={formatCzk(m.delivery, { whole: true })} />
      <Kpi label="Ostatní náklady" value={formatCzk(m.other, { whole: true })} />
      <Kpi label="Hodin výroby za měsíc" value={`${formatNumber(m.hours)} h`} />
      <Kpi
        label="Bod zvratu"
        value={plan.breakEven.bakingDays != null ? `${plan.breakEven.bakingDays}× pečení` : 'nedosažen'}
        sub={plan.breakEven.bakingDays != null ? 'minimum měsíčně včetně práce' : plan.breakEven.bakingDaysBeforeLabor != null ? `bez práce ${plan.breakEven.bakingDaysBeforeLabor}× pečení` : 'pečení nepokryje své náklady'}
        testId="kpi-breakeven"
      />
    </div>
  );
}
