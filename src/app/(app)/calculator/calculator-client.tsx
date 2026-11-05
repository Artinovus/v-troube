'use client';
import * as React from 'react';
import Link from 'next/link';
import { Download, AlertTriangle, Save, Trash2, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace } from '@/lib/data/repo';
import type { CostSettings, Product } from '@/lib/calc';
import { computeAllRecipeCosts, computePlan, planUnitLabel, salesUnitLabel } from '@/lib/calc';
import { formatCzk, formatDate, formatNumber, formatPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardTitle, EmptyState, Field, Input, Notice, PageHeader } from '@/components/ui/basic';
import { ConfirmDialog } from '@/components/ui/dialog';
import { NumberField } from '@/components/app/number-field';
import { SaveIndicator, useAutosave } from '@/components/app/autosave';
import { CostStructure, Kpi, MonthlyKpis } from '@/components/app/results';
import { applyScenarioAction, deleteScenarioAction, savePlanAction, saveScenarioAction, saveSettingsAction, updateProductPricesAction } from '@/app/actions';

export function CalculatorClient({ ws }: { ws: Workspace }) {
  const [settings, setSettings] = React.useState<CostSettings>(ws.settings);
  const products = React.useMemo(() => ws.products.filter((p) => p.isActive), [ws.products]);
  const [qty, setQty] = React.useState<Record<string, number>>(() => Object.fromEntries(products.map((p) => [p.id, ws.plan[p.id] ?? 0])));
  const [prices, setPrices] = React.useState<Record<string, number>>(() => Object.fromEntries(products.map((p) => [p.id, p.wholesalePrice])));
  const [overrides, setOverrides] = React.useState<Record<string, number | null>>({});

  const settingsSave = useAutosave(settings, (s) => saveSettingsAction(s));
  const planValue = React.useMemo(() => Object.entries(qty).map(([productId, quantity]) => ({ productId, quantity })), [qty]);
  const planSave = useAutosave(planValue, (v) => savePlanAction(v));

  const liveProducts: Product[] = React.useMemo(() => products.map((p) => ({ ...p, wholesalePrice: prices[p.id] ?? p.wholesalePrice })), [products, prices]);
  const recipeCosts = React.useMemo(() => computeAllRecipeCosts(ws.recipes, ws.ingredients), [ws.recipes, ws.ingredients]);
  const plan = React.useMemo(() => computePlan({ products: liveProducts, recipes: ws.recipes, ingredients: ws.ingredients, settings, quantities: qty, recipeCosts }), [liveProducts, ws.recipes, ws.ingredients, settings, qty, recipeCosts]);
  const hasOverrides = Object.values(overrides).some((v) => v != null);
  const scenario = React.useMemo(
    () => (hasOverrides ? computePlan({ products: liveProducts, recipes: ws.recipes, ingredients: ws.ingredients, settings, quantities: qty, recipeCosts, priceOverrides: overrides }) : null),
    [hasOverrides, liveProducts, ws.recipes, ws.ingredients, settings, qty, recipeCosts, overrides],
  );

  const setS = (k: keyof CostSettings) => (v: number | null) => setSettings((s) => ({ ...s, [k]: v ?? 0 }));
  const states = [settingsSave.state, planSave.state];
  const combined = states.includes('error') ? 'error' : states.includes('offline') ? 'offline' : states.includes('saving') ? 'saving' : states.includes('dirty') ? 'dirty' : states.includes('saved') ? 'saved' : 'idle';

  return (
    <>
      <PageHeader
        title="Kalkulačka výroby"
        description="Plán jednoho pečení a měsíční výsledek. Náklady na suroviny se berou z receptur a aktuálních cen."
        actions={<Button variant="outline" asChild><a href="/api/export/calculation" download><Download /> Kalkulace CSV</a></Button>}
      />
      <div className="mb-3 flex justify-end"><SaveIndicator state={combined} error={settingsSave.error ?? planSave.error} onRetry={() => { settingsSave.retry(); planSave.retry(); }} /></div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3">
            <CardTitle>Výroba a práce</CardTitle>
            <Field label="Počet pečení za měsíc" htmlFor="c-days"><NumberField id="c-days" value={settings.bakingDaysPerMonth} onValueChange={setS('bakingDaysPerMonth')} max={31} allowEmpty={false} /></Field>
            <Field label="Hodin práce při jednom pečení" htmlFor="c-hours"><NumberField id="c-hours" value={settings.hoursPerBakingDay} onValueChange={setS('hoursPerBakingDay')} max={24} allowEmpty={false} suffix="h" /></Field>
            <Field label="Požadovaná hodinová odměna" htmlFor="c-hourly"><NumberField id="c-hourly" value={settings.hourlyLaborCost} onValueChange={setS('hourlyLaborCost')} allowEmpty={false} suffix="Kč/h" /></Field>
          </Card>
          <Card className="space-y-3">
            <CardTitle>Ostatní provozní náklady</CardTitle>
            <Field label="Balení na jedno pečení" htmlFor="c-pack" hint="Krabičky, papír, etikety – nepatří do receptur."><NumberField id="c-pack" value={settings.packagingCostPerBakingDay} onValueChange={setS('packagingCostPerBakingDay')} allowEmpty={false} suffix="Kč" /></Field>
            <Field label="Doprava na jedno pečení" htmlFor="c-del"><NumberField id="c-del" value={settings.deliveryCostPerBakingDay} onValueChange={setS('deliveryCostPerBakingDay')} allowEmpty={false} suffix="Kč" /></Field>
            <Field label="Energie a provozovna měsíčně" htmlFor="c-energy"><NumberField id="c-energy" value={settings.monthlyEnergyCost} onValueChange={setS('monthlyEnergyCost')} allowEmpty={false} suffix="Kč" /></Field>
            <Field label="Ostatní měsíční náklady" htmlFor="c-other"><NumberField id="c-other" value={settings.otherMonthlyCosts} onValueChange={setS('otherMonthlyCosts')} allowEmpty={false} suffix="Kč" /></Field>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardTitle>Plán jednoho pečení</CardTitle>
            <p className="mt-1 text-xs text-ink-muted">Počet kusů (u perníčků gramy) a cena pro kavárnu. Změna ceny se uloží k výrobku.</p>
            {products.length === 0 ? <EmptyState title="Žádné aktivní výrobky" action={<Button asChild><Link href="/products/new">Přidat výrobek</Link></Button>} /> : (
              <ul className="mt-3 divide-y divide-line">
                {plan.rows.map((r) => (
                  <PlanRow key={r.product.id} row={r} qty={qty[r.product.id] ?? 0} onQty={(n) => setQty((q) => ({ ...q, [r.product.id]: n ?? 0 }))} price={prices[r.product.id]} onPrice={(n) => setPrices((p) => ({ ...p, [r.product.id]: n }))} />
                ))}
              </ul>
            )}
          </Card>

          {plan.warnings.length ? (
            <Notice>
              <p className="font-medium"><AlertTriangle className="mr-1 inline size-4" />Výsledek je orientační – některé náklady chybí:</p>
              <ul className="mt-1 list-disc pl-5 text-xs">{plan.warnings.slice(0, 6).map((w) => <li key={w}>{w}</li>)}</ul>
            </Notice>
          ) : null}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Tržby na jedno pečení" value={formatCzk(plan.perDay.revenue)} testId="kpi-day-revenue" />
            <Kpi label="Suroviny na jedno pečení" value={formatCzk(plan.perDay.materialActual)} sub={`teoreticky ${formatCzk(plan.perDay.materialTheoretical)}`} testId="kpi-day-material" />
            <Kpi label="Měsíční náklady" value={formatCzk(plan.monthly.totalCosts, { whole: true })} sub="včetně práce" />
            <Kpi label="Minimální tržby" value={formatCzk(plan.breakEven.revenue, { whole: true })} sub={plan.breakEven.volumePct != null ? `${formatPct(plan.breakEven.volumePct, 0)} aktuálního plánu` : 'při daném počtu pečení'} />
          </div>
          <MonthlyKpis plan={plan} />
          <CostStructure plan={plan} />

          <Card>
            <CardTitle>Výrobní dávky</CardTitle>
            <p className="mt-1 text-xs text-ink-muted">Vyrábí se celé dávky. Skutečný náklad = počet dávek × cena dávky; teoretický = jen poměrná část pro prodané množství.</p>
            {plan.batches.length === 0 ? <p className="mt-3 text-sm text-ink-muted">Zadejte množství v plánu.</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm" data-testid="batches-table">
                  <thead className="text-left text-xs text-ink-muted">
                    <tr><th className="py-1 font-normal">Receptura</th><th className="font-normal">Potřeba</th><th className="font-normal">Výtěžnost</th><th className="font-normal">Dávek</th><th className="font-normal">Přebytek</th><th className="text-right font-normal">Skutečně</th><th className="text-right font-normal">Teoreticky</th><th className="text-right font-normal">Přebytek Kč</th></tr>
                  </thead>
                  <tbody className="num">
                    {plan.batches.map((b) => (
                      <tr key={b.recipe.id} className="border-t border-line">
                        <td className="py-1.5"><Link href={`/recipes/${b.recipe.id}`} className="hover:underline">{b.recipe.name}</Link>{!b.complete ? <Badge tone="warn" className="ml-1">neúplné</Badge> : null}</td>
                        <td>{formatNumber(b.needed)} {b.recipe.yieldUnit}</td>
                        <td>{b.yieldQuantity ? `${formatNumber(b.yieldQuantity)} ${b.recipe.yieldUnit}` : '—'}</td>
                        <td data-testid="batch-count">{b.batches}</td>
                        <td>{formatNumber(b.surplus)} {b.recipe.yieldUnit}</td>
                        <td className="text-right">{formatCzk(b.actualCost)}</td>
                        <td className="text-right">{formatCzk(b.theoreticalCost)}</td>
                        <td className="text-right">{formatCzk(b.surplusCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Bod zvratu</CardTitle>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              <li>Minimální počet pečení měsíčně (s tímto sortimentem, včetně ocenění práce): <strong className="num text-ink">{plan.breakEven.bakingDays ?? 'nedosažitelné – jedno pečení nepokryje vlastní náklady'}</strong></li>
              <li>Bez ocenění vlastní práce: <strong className="num text-ink">{plan.breakEven.bakingDaysBeforeLabor ?? 'nedosažitelné'}</strong></li>
              <li>Při {formatNumber(settings.bakingDaysPerMonth)} pečeních potřebujete tržby alespoň <strong className="num text-ink">{formatCzk(plan.breakEven.revenue, { whole: true })}</strong>{plan.breakEven.volumePct != null ? ` (${formatPct(plan.breakEven.volumePct, 0)} současného objemu)` : ''}.</li>
            </ul>
          </Card>

          <Scenarios ws={ws} products={liveProducts} plan={plan} scenario={scenario} overrides={overrides} setOverrides={setOverrides} flush={async () => { await planSave.flush(); await settingsSave.flush(); }} />
        </div>
      </div>
    </>
  );
}

function PlanRow({ row, qty, onQty, price, onPrice }: { row: ReturnType<typeof computePlan>['rows'][number]; qty: number; onQty: (n: number | null) => void; price: number; onPrice: (n: number) => void }) {
  const p = row.product;
  const save = useAutosave({ price }, (v) => updateProductPricesAction({ id: p.id, wholesalePrice: v.price }));
  return (
    <li className="py-3" data-testid="plan-row">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{p.name}</p>
        <SaveIndicator state={save.state} error={save.error} />
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1fr] gap-2 sm:grid-cols-[120px_130px_1fr] sm:items-end">
        <label className="text-xs text-ink-soft">Množství ({planUnitLabel(p)})
          <NumberField aria-label={`Množství – ${p.name}`} value={qty} onValueChange={onQty} allowEmpty={false} className="mt-1" />
        </label>
        <label className="text-xs text-ink-soft">Cena / {salesUnitLabel(p)}
          <NumberField aria-label={`Cena – ${p.name}`} value={price} onValueChange={(n) => n != null && onPrice(n)} allowEmpty={false} suffix="Kč" className="mt-1" />
        </label>
        <div className="num col-span-2 grid grid-cols-3 gap-2 text-xs sm:col-span-1">
          <span><span className="block text-ink-muted">Náklad/jedn.</span>{formatCzk(row.cost.unitCost)}</span>
          <span><span className="block text-ink-muted">Tržba/pečení</span>{formatCzk(row.revenuePerDay)}</span>
          <span><span className="block text-ink-muted">Příspěvek/jedn.</span>{formatCzk(row.contributionPerUnit)}</span>
        </div>
      </div>
      {row.planQty > 0 && !row.cost.complete ? <p className="mt-1 text-xs text-warn">{row.cost.issue}</p> : null}
    </li>
  );
}

function Scenarios({ ws, products, plan, scenario, overrides, setOverrides, flush }: { ws: Workspace; products: Product[]; plan: ReturnType<typeof computePlan>; scenario: ReturnType<typeof computePlan> | null; overrides: Record<string, number | null>; setOverrides: React.Dispatch<React.SetStateAction<Record<string, number | null>>>; flush: () => Promise<void> }) {
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [apply, setApply] = React.useState<string | null>(null);
  const [del, setDel] = React.useState<string | null>(null);
  const toApply = ws.scenarios.find((s) => s.id === apply);
  const diff = (a: number, b: number) => `${b - a >= 0 ? '+' : ''}${formatCzk(b - a, { whole: true })}`;

  return (
    <Card id="scenare">
      <CardTitle>Cenové scénáře</CardTitle>
      <p className="mt-1 text-xs text-ink-muted">Zkuste jiné ceny bez přepsání uložených. Scénář uloží snímek – pozdější změny receptur ani cen ho nezmění.</p>
      <ul className="mt-3 space-y-2">
        {products.map((p) => (
          <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2 text-sm">
            <span className="min-w-0 truncate">{p.name} <span className="num text-xs text-ink-muted">(nyní {formatCzk(p.wholesalePrice)})</span></span>
            <NumberField aria-label={`Scénář – ${p.name}`} value={overrides[p.id] ?? null} onValueChange={(n) => setOverrides((o) => ({ ...o, [p.id]: n }))} placeholder="beze změny" suffix="Kč" />
          </li>
        ))}
      </ul>
      {scenario ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm" data-testid="scenario-compare">
            <thead className="text-left text-xs text-ink-muted"><tr><th className="font-normal" /><th className="text-right font-normal">Nyní</th><th className="text-right font-normal">Scénář</th><th className="text-right font-normal">Rozdíl</th></tr></thead>
            <tbody className="num">
              <tr className="border-t border-line"><td className="py-1">Měsíční tržby</td><td className="text-right">{formatCzk(plan.monthly.revenue, { whole: true })}</td><td className="text-right">{formatCzk(scenario.monthly.revenue, { whole: true })}</td><td className="text-right">{diff(plan.monthly.revenue, scenario.monthly.revenue)}</td></tr>
              <tr className="border-t border-line"><td className="py-1">Příspěvek (tržby − suroviny)</td><td className="text-right">{formatCzk(plan.monthly.revenue - plan.monthly.material, { whole: true })}</td><td className="text-right">{formatCzk(scenario.monthly.revenue - scenario.monthly.material, { whole: true })}</td><td className="text-right">{diff(plan.monthly.revenue - plan.monthly.material, scenario.monthly.revenue - scenario.monthly.material)}</td></tr>
              <tr className="border-t border-line"><td className="py-1">Provozní zisk</td><td className="text-right">{formatCzk(plan.monthly.operatingProfit, { whole: true })}</td><td className="text-right font-semibold">{formatCzk(scenario.monthly.operatingProfit, { whole: true })}</td><td className="text-right">{diff(plan.monthly.operatingProfit, scenario.monthly.operatingProfit)}</td></tr>
              <tr className="border-t border-line"><td className="py-1">Rentabilita</td><td className="text-right">{formatPct(plan.monthly.returnOnSalesPct)}</td><td className="text-right">{formatPct(scenario.monthly.returnOnSalesPct)}</td><td /></tr>
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input placeholder="Název scénáře, např. Cookie za 49 Kč" value={name} onChange={(e) => setName(e.target.value)} className="sm:max-w-xs" aria-label="Název scénáře" />
            <Button disabled={saving || !name.trim()} onClick={async () => {
              setSaving(true);
              await flush();
              const r = await saveScenarioAction({ name, note: null, priceOverrides: overrides });
              setSaving(false);
              if (r.ok) { toast.success(r.message!); setName(''); setOverrides({}); } else toast.error(r.error);
            }}><Save /> Uložit scénář</Button>
            <Button variant="ghost" onClick={() => setOverrides({})}>Zrušit změny</Button>
          </div>
        </div>
      ) : null}

      {ws.scenarios.length ? (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">Uložené scénáře</p>
          <ul className="space-y-2">
            {ws.scenarios.map((s) => (
              <li key={s.id} className="rounded-lg border border-line p-2 text-sm" data-testid="scenario-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{s.name} <span className="text-xs font-normal text-ink-muted">{formatDate(s.createdAt)}</span>{s.appliedAt ? <Badge tone="good" className="ml-1">použito {formatDate(s.appliedAt)}</Badge> : null}</span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setApply(s.id)} disabled={!s.items.some((i) => i.priceOverride != null)}><CheckCheck /> Použít ceny</Button>
                    <Button size="sm" variant="ghost" aria-label="Smazat scénář" onClick={() => setDel(s.id)}><Trash2 /></Button>
                  </span>
                </div>
                <p className="num mt-1 text-xs text-ink-soft">
                  {s.items.filter((i) => i.priceOverride != null).map((i) => `${i.productName}: ${formatCzk(i.wholesalePrice)} → ${formatCzk(i.priceOverride)}`).join(' · ') || 'beze změny cen'}
                </p>
                {s.resultsSnapshot ? (
                  <p className="num mt-1 text-xs text-ink-muted">Zisk v době uložení: {formatCzk(s.resultsSnapshot.current?.operatingProfit, { whole: true })} → {formatCzk(s.resultsSnapshot.scenario?.operatingProfit, { whole: true })} měsíčně</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!apply}
        onOpenChange={(o) => !o && setApply(null)}
        title="Použít ceny ze scénáře?"
        description={<>Následující ceny se uloží k výrobkům (předchozí zůstanou v historii):<ul className="num mt-2 list-disc pl-5">{toApply?.items.filter((i) => i.priceOverride != null && i.productId).map((i) => <li key={i.productId!}>{i.productName}: {formatCzk(i.priceOverride)}</li>)}</ul></>}
        confirmLabel="Použít ceny"
        onConfirm={async () => { const r = await applyScenarioAction(apply!); if (r.ok) { toast.success(r.message!); window.location.reload(); } else toast.error(r.error); }}
      />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} destructive title="Smazat scénář?" confirmLabel="Smazat" description="Uložený scénář bude odstraněn. Ceny výrobků se nemění." onConfirm={async () => { const r = await deleteScenarioAction(del!); if (r.ok) toast.success(r.message!); else toast.error(r.error); }} />
    </Card>
  );
}
