import type { CostSettings, Ingredient, PlanQuantities, Product, Recipe } from './types';
import { computeAllRecipeCosts, type RecipeCost } from './recipe';
import { marginPct, planQtyToSalesUnits, productCost, type ProductCost } from './pricing';

const EPS = 1e-9;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export interface ProductPlanRow {
  product: Product;
  cost: ProductCost;
  price: number;
  /** množství z plánu (ks, nebo g u hmotnostního prodeje) */
  planQty: number;
  /** počet prodejních jednotek za pečení (u hmotnosti počet 100 g) */
  salesUnitsPerDay: number;
  revenuePerDay: number;
  /** teoretický (poměrný) surovinový náklad plánovaného množství */
  theoreticalMaterialPerDay: number | null;
  /** příspěvek na úhradu na 1 prodejní jednotku = cena − surovinový náklad */
  contributionPerUnit: number | null;
  marginPct: number | null;
}

export interface RecipeBatchRow {
  recipe: Recipe;
  recipeCost: RecipeCost;
  /** potřebné množství v jednotkách výtěžnosti (ks / g) */
  needed: number;
  yieldQuantity: number | null;
  batches: number;
  produced: number;
  surplus: number;
  /** skutečný náklad celých dávek */
  actualCost: number;
  theoreticalCost: number;
  surplusCost: number;
  complete: boolean;
}

export interface PlanResult {
  rows: ProductPlanRow[];
  batches: RecipeBatchRow[];
  perDay: {
    revenue: number;
    materialActual: number;
    materialTheoretical: number;
    surplusCost: number;
    packaging: number;
    delivery: number;
    labor: number;
  };
  monthly: {
    revenue: number;
    material: number;
    materialTheoretical: number;
    packaging: number;
    delivery: number;
    labor: number;
    energy: number;
    other: number;
    /** všechny náklady včetně ocenění práce */
    totalCosts: number;
    /** výsledek před oceněním vlastní práce */
    profitBeforeLabor: number;
    /** provozní zisk po započtení práce */
    operatingProfit: number;
    /** rentabilita tržeb v % (null při nulových tržbách) */
    returnOnSalesPct: number | null;
    hours: number;
  };
  breakEven: {
    /** minimální počet pečení měsíčně při stávajícím sortimentu jednoho pečení (s prací) */
    bakingDays: number | null;
    bakingDaysBeforeLabor: number | null;
    /** minimální měsíční tržby při daném počtu pečení */
    revenue: number | null;
    /** potřebný objem výroby v % aktuálního plánu */
    volumePct: number | null;
  };
  complete: boolean;
  warnings: string[];
}

export interface PlanInput {
  products: Product[];
  recipes: Recipe[];
  ingredients: Ingredient[];
  settings: CostSettings;
  quantities: PlanQuantities;
  /** dočasné ceny (scénář) – nepřepisují uložené ceny */
  priceOverrides?: Record<string, number | null | undefined>;
  recipeCosts?: Map<string, RecipeCost>;
}

/**
 * Měsíční kalkulace výroby.
 *
 * Počet výrobních dávek = ⌈potřebné množství / výtěžnost⌉ (agregováno po recepturách)
 * Skutečný surovinový náklad = počet dávek × cena dávky
 * Měsíční tržby = Σ (prodejní jednotky × cena) × počet pečení
 * Měsíční práce = počet pečení × hodiny × hodinová odměna
 * Provozní zisk = tržby − suroviny − práce − balení − doprava − energie − ostatní
 * Rentabilita = provozní zisk / tržby × 100
 */
export function computePlan(input: PlanInput): PlanResult {
  const { products, recipes, ingredients, settings, quantities, priceOverrides = {} } = input;
  const recipeCosts = input.recipeCosts ?? computeAllRecipeCosts(recipes, ingredients);
  const recById = new Map(recipes.map((r) => [r.id, r]));
  const warnings: string[] = [];

  const rows: ProductPlanRow[] = [];
  const needByRecipe = new Map<string, number>();

  for (const product of products) {
    const planQty = num(quantities[product.id]);
    const recipe = product.recipeId ? recById.get(product.recipeId) : undefined;
    const cost = productCost(product, recipe, recipe ? recipeCosts.get(recipe.id) : undefined);
    const override = priceOverrides[product.id];
    const price = typeof override === 'number' && Number.isFinite(override) && override >= 0 ? override : num(product.wholesalePrice);
    const salesUnitsPerDay = planQtyToSalesUnits(product, planQty);
    const revenuePerDay = salesUnitsPerDay * price;
    const theoretical = cost.unitCost != null ? cost.unitCost * salesUnitsPerDay : null;
    rows.push({
      product,
      cost,
      price,
      planQty,
      salesUnitsPerDay,
      revenuePerDay,
      theoreticalMaterialPerDay: theoretical,
      contributionPerUnit: cost.unitCost != null ? price - cost.unitCost : null,
      marginPct: cost.unitCost != null ? marginPct(price, cost.unitCost) : null,
    });
    if (salesUnitsPerDay > 0) {
      if (recipe && cost.recipeUnitsPerSale != null) {
        needByRecipe.set(recipe.id, (needByRecipe.get(recipe.id) ?? 0) + salesUnitsPerDay * cost.recipeUnitsPerSale);
      }
      if (!cost.complete) warnings.push(`${product.name}: ${cost.issue ?? 'neúplný náklad'}`);
    }
  }

  const batches: RecipeBatchRow[] = [];
  for (const [recipeId, needed] of needByRecipe) {
    const recipe = recById.get(recipeId)!;
    const rc = recipeCosts.get(recipeId)!;
    const y = recipe.yieldQuantity && recipe.yieldQuantity > 0 ? recipe.yieldQuantity : null;
    const batchCount = y ? Math.ceil(needed / y - EPS) : 0;
    const produced = y ? batchCount * y : needed;
    const surplus = Math.max(0, produced - needed);
    const unitCost = rc.unitCost ?? 0;
    batches.push({
      recipe,
      recipeCost: rc,
      needed,
      yieldQuantity: y,
      batches: batchCount,
      produced,
      surplus,
      actualCost: y ? batchCount * rc.batchCost : 0,
      theoreticalCost: needed * unitCost,
      surplusCost: surplus * unitCost,
      complete: rc.complete && y != null,
    });
  }

  const days = num(settings.bakingDaysPerMonth);
  const hours = num(settings.hoursPerBakingDay);
  const perDay = {
    revenue: sum(rows.map((r) => r.revenuePerDay)),
    materialActual: sum(batches.map((b) => b.actualCost)),
    materialTheoretical: sum(batches.map((b) => b.theoreticalCost)),
    surplusCost: sum(batches.map((b) => b.surplusCost)),
    packaging: num(settings.packagingCostPerBakingDay),
    delivery: num(settings.deliveryCostPerBakingDay),
    labor: hours * num(settings.hourlyLaborCost),
  };

  const m = {
    revenue: perDay.revenue * days,
    material: perDay.materialActual * days,
    materialTheoretical: perDay.materialTheoretical * days,
    packaging: perDay.packaging * days,
    delivery: perDay.delivery * days,
    labor: perDay.labor * days,
    energy: num(settings.monthlyEnergyCost),
    other: num(settings.otherMonthlyCosts),
    hours: hours * days,
  };
  const totalCosts = m.material + m.packaging + m.delivery + m.labor + m.energy + m.other;
  const operatingProfit = m.revenue - totalCosts;
  const monthly = {
    ...m,
    totalCosts,
    operatingProfit,
    profitBeforeLabor: operatingProfit + m.labor,
    returnOnSalesPct: m.revenue > 0 ? (operatingProfit / m.revenue) * 100 : null,
  };

  // Bod zvratu
  const fixed = m.energy + m.other;
  const dayContribution = perDay.revenue - perDay.materialActual - perDay.packaging - perDay.delivery;
  const dayContributionAfterLabor = dayContribution - perDay.labor;
  const bakingDays = dayContributionAfterLabor > EPS ? Math.ceil(fixed / dayContributionAfterLabor - EPS) : null;
  const bakingDaysBeforeLabor = dayContribution > EPS ? Math.ceil(fixed / dayContribution - EPS) : null;
  // Při daném počtu pečení: variabilní náklad = suroviny (teoreticky lineární s objemem).
  const cmRatio = m.revenue > 0 ? (m.revenue - m.materialTheoretical) / m.revenue : null;
  const fixedAtDays = m.labor + m.packaging + m.delivery + fixed;
  const breakEvenRevenue = cmRatio != null && cmRatio > EPS ? fixedAtDays / cmRatio : null;

  const complete = warnings.length === 0 && batches.every((b) => b.complete);
  if (batches.some((b) => !b.complete) && warnings.length === 0) warnings.push('Některé receptury nemají úplný náklad.');

  return {
    rows,
    batches,
    perDay,
    monthly,
    breakEven: {
      bakingDays,
      bakingDaysBeforeLabor,
      revenue: breakEvenRevenue,
      volumePct: breakEvenRevenue != null && m.revenue > 0 ? (breakEvenRevenue / m.revenue) * 100 : null,
    },
    complete,
    warnings,
  };
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}
