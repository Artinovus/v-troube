import type { CostSettings, Ingredient, Product, Recipe } from '@/lib/calc';
import { computeAllRecipeCosts, computePlan, marginPct, markupPct, productCost, salesUnitLabel } from '@/lib/calc';
import { toCsv } from './csv';

interface WsLike {
  ingredients: Ingredient[];
  recipes: Recipe[];
  products: Product[];
  settings: CostSettings;
  plan: Record<string, number>;
}

export function buildIngredientsCsv(ws: WsLike): string {
  return toCsv(
    ['Název', 'Kategorie', 'Značka', 'Dodavatel', 'Obsah balení', 'Jednotka', 'Cena balení (Kč)', 'Cena za jednotku (Kč)', 'Datum ceny', 'Aktivní', 'Poznámka'],
    ws.ingredients.map((i) => [
      i.name, i.category, i.brand, i.supplier, i.packageQuantity, i.packageUnit, i.packagePrice,
      i.packagePrice != null && i.packageQuantity ? i.packagePrice / i.packageQuantity : null,
      i.priceUpdatedAt, i.isActive, i.note,
    ]),
  );
}

export function buildProductsCsv(ws: WsLike): string {
  const costs = computeAllRecipeCosts(ws.recipes, ws.ingredients);
  return toCsv(
    ['Výrobek', 'Kategorie', 'Prodejní jednotka', 'Receptura', 'Gramáž kusu (g)', 'Cena kavárně (Kč)', 'Dopor. MO cena (Kč)', 'Porcí', 'Surovinový náklad (Kč)', 'Rozdíl (Kč)', 'Marže %', 'Přirážka %', 'Náklad úplný', 'Aktivní'],
    ws.products.map((p) => {
      const r = ws.recipes.find((x) => x.id === p.recipeId);
      const pc = productCost(p, r, r ? costs.get(r.id) : undefined);
      return [
        p.name, p.category, salesUnitLabel(p), r?.name ?? '', p.pieceWeight, p.wholesalePrice, p.retailPrice, p.retailPortions,
        pc.unitCost, pc.unitCost != null ? p.wholesalePrice - pc.unitCost : null,
        pc.unitCost != null ? marginPct(p.wholesalePrice, pc.unitCost) : null,
        pc.unitCost != null ? markupPct(p.wholesalePrice, pc.unitCost) : null,
        pc.complete, p.isActive,
      ];
    }),
  );
}

export function buildCalculationCsv(ws: WsLike): string {
  const products = ws.products.filter((p) => p.isActive);
  const plan = computePlan({ products, recipes: ws.recipes, ingredients: ws.ingredients, settings: ws.settings, quantities: ws.plan });
  const rows: (string | number | null)[][] = [];
  rows.push(['Výrobky na jedno pečení', '', '', '', '', '']);
  rows.push(['Výrobek', 'Množství', 'Cena / jednotku', 'Tržba / pečení', 'Náklad / jednotku', 'Příspěvek / jednotku']);
  for (const r of plan.rows) rows.push([r.product.name, r.planQty, r.price, r.revenuePerDay, r.cost.unitCost, r.contributionPerUnit]);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Výrobní dávky', 'Potřeba', 'Výtěžnost', 'Dávek', 'Skutečný náklad', 'Přebytek (Kč)']);
  for (const b of plan.batches) rows.push([b.recipe.name, b.needed, b.yieldQuantity, b.batches, b.actualCost, b.surplusCost]);
  rows.push(['', '', '', '', '', '']);
  const m = plan.monthly;
  const s = ws.settings;
  const kv: [string, number | null][] = [
    ['Počet pečení za měsíc', s.bakingDaysPerMonth],
    ['Hodin na pečení', s.hoursPerBakingDay],
    ['Hodinová odměna', s.hourlyLaborCost],
    ['Tržby na jedno pečení', plan.perDay.revenue],
    ['Suroviny na jedno pečení', plan.perDay.materialActual],
    ['Měsíční tržby', m.revenue],
    ['Suroviny', m.material],
    ['Vlastní práce', m.labor],
    ['Balení', m.packaging],
    ['Doprava', m.delivery],
    ['Energie a provozovna', m.energy],
    ['Ostatní náklady', m.other],
    ['Náklady celkem', m.totalCosts],
    ['Výsledek před oceněním práce', m.profitBeforeLabor],
    ['Provozní zisk po ocenění práce', m.operatingProfit],
    ['Rentabilita tržeb %', m.returnOnSalesPct],
    ['Bod zvratu – minimální počet pečení', plan.breakEven.bakingDays],
    ['Bod zvratu – minimální měsíční tržby', plan.breakEven.revenue],
  ];
  rows.push(['Měsíční výsledek', 'Hodnota', '', '', '', '']);
  for (const [k, v] of kv) rows.push([k, v, '', '', '', '']);
  if (!plan.complete) rows.push(['Upozornění: některé náklady nejsou úplné, výsledek je orientační.', '', '', '', '', '']);
  return toCsv(['Z trouby – kalkulace', new Date().toISOString().slice(0, 10), '', '', '', ''], rows);
}
