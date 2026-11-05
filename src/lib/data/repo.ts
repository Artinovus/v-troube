import 'server-only';
import type { Tx } from '@/lib/db/rls';
import type { CostSettings, Ingredient, Product, Recipe, RecipeItem } from '@/lib/calc';
import { DEFAULT_SETTINGS } from '@/lib/calc';
import type { IngredientInput, ProductInput, RecipeInput } from '@/lib/validation';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export const mapIngredient = (r: Row): Ingredient => ({
  id: r.id,
  name: r.name,
  category: r.category,
  brand: r.brand,
  supplier: r.supplier,
  packageQuantity: r.package_quantity,
  packageUnit: r.package_unit,
  packagePrice: r.package_price,
  priceUpdatedAt: r.price_updated_at ? toIsoDate(r.price_updated_at) : null,
  note: r.note,
  isActive: r.is_active,
});

export const mapProduct = (r: Row): Product => ({
  id: r.id,
  recipeId: r.recipe_id,
  name: r.name,
  category: r.category,
  salesUnit: r.sales_unit,
  pieceWeight: r.piece_weight,
  wholesalePrice: r.wholesale_price,
  retailPrice: r.retail_price,
  retailPortions: r.retail_portions,
  targetMarginPct: r.target_margin_pct,
  isActive: r.is_active,
  notes: r.notes,
  sortOrder: r.sort_order,
});

export const mapSettings = (r: Row | undefined): CostSettings =>
  r
    ? {
        bakingDaysPerMonth: r.baking_days_per_month,
        hoursPerBakingDay: r.hours_per_baking_day,
        hourlyLaborCost: r.hourly_labor_cost,
        monthlyEnergyCost: r.monthly_energy_cost,
        packagingCostPerBakingDay: r.packaging_cost_per_baking_day,
        deliveryCostPerBakingDay: r.delivery_cost_per_baking_day,
        otherMonthlyCosts: r.other_monthly_costs,
        defaultTargetMarginPct: r.default_target_margin_pct,
        vatEnabled: r.vat_enabled,
        vatRatePct: r.vat_rate_pct,
      }
    : { ...DEFAULT_SETTINGS };

function toIsoDate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface Scenario {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
  appliedAt: string | null;
  settingsSnapshot: unknown;
  resultsSnapshot: any;
  items: {
    productId: string | null;
    productName: string;
    salesUnit: string;
    quantityPerBakingDay: number;
    wholesalePrice: number | null;
    priceOverride: number | null;
    unitCost: number | null;
  }[];
}

export interface Workspace {
  ingredients: Ingredient[];
  recipes: Recipe[];
  products: Product[];
  settings: CostSettings;
  plan: Record<string, number>;
  scenarios: Scenario[];
}

/** Při prvním přihlášení administrátora vytvoří výchozí sortiment. */
export async function ensureSeeded(tx: Tx) {
  await tx`select public.seed_initial_data()`;
}

export async function loadWorkspace(tx: Tx): Promise<Workspace> {
  const [ings, recs, items, prods, settings, plan, scen, scenItems] = await Promise.all([
    tx`select * from public.ingredients order by lower(name)`,
    tx`select * from public.recipes order by is_subrecipe desc, lower(name)`,
    tx`select * from public.recipe_ingredients order by recipe_id, sort_order, id`,
    tx`select * from public.products order by sort_order, lower(name)`,
    tx`select * from public.cost_settings limit 1`,
    tx`select product_id, quantity_per_baking_day from public.plan_items`,
    tx`select * from public.production_scenarios order by created_at desc`,
    tx`select * from public.production_scenario_items`,
  ]);
  const itemsByRecipe = new Map<string, RecipeItem[]>();
  for (const it of items) {
    const list = itemsByRecipe.get(it.recipe_id) ?? [];
    list.push({
      id: it.id,
      ingredientId: it.ingredient_id,
      subRecipeId: it.sub_recipe_id,
      quantity: it.quantity_used,
      unit: it.unit,
      note: it.note,
    });
    itemsByRecipe.set(it.recipe_id, list);
  }
  return {
    ingredients: ings.map(mapIngredient),
    recipes: recs.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      notes: r.notes,
      yieldQuantity: r.yield_quantity,
      yieldUnit: r.yield_unit,
      status: r.status,
      isSubrecipe: r.is_subrecipe,
      isVerified: r.is_verified,
      items: itemsByRecipe.get(r.id) ?? [],
    })),
    products: prods.map(mapProduct),
    settings: mapSettings(settings[0]),
    plan: Object.fromEntries(plan.map((p) => [p.product_id, p.quantity_per_baking_day])),
    scenarios: scen.map((s) => ({
      id: s.id,
      name: s.name,
      note: s.note,
      createdAt: new Date(s.created_at).toISOString(),
      appliedAt: s.applied_at ? new Date(s.applied_at).toISOString() : null,
      settingsSnapshot: s.settings_snapshot,
      resultsSnapshot: s.results_snapshot,
      items: scenItems
        .filter((i) => i.scenario_id === s.id)
        .map((i) => ({
          productId: i.product_id,
          productName: i.product_name,
          salesUnit: i.sales_unit,
          quantityPerBakingDay: i.quantity_per_baking_day,
          wholesalePrice: i.wholesale_price,
          priceOverride: i.price_override,
          unitCost: i.unit_cost,
        })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Suroviny
// ---------------------------------------------------------------------------
export async function upsertIngredient(tx: Tx, input: IngredientInput): Promise<string> {
  const row = {
    name: input.name,
    category: input.category,
    brand: input.brand,
    supplier: input.supplier,
    package_quantity: input.packageQuantity,
    package_unit: input.packageUnit,
    package_price: input.packagePrice,
    price_updated_at: input.priceUpdatedAt,
    note: input.note,
    is_active: input.isActive,
  };
  if (input.id) {
    const res = await tx`update public.ingredients set ${tx(row)} where id = ${input.id} returning id`;
    if (res.length === 0) throw new Error('Surovina nebyla nalezena.');
    return res[0].id;
  }
  const res = await tx`insert into public.ingredients ${tx(row)} returning id`;
  return res[0].id;
}

export async function ingredientHistory(tx: Tx, id: string) {
  return tx`select old_price, new_price, old_package_quantity, package_quantity, package_unit, changed_at
            from public.ingredient_price_history where ingredient_id = ${id} order by changed_at desc limit 50`;
}

// ---------------------------------------------------------------------------
// Receptury
// ---------------------------------------------------------------------------
export async function saveRecipe(tx: Tx, input: RecipeInput): Promise<string> {
  const row = {
    name: input.name,
    description: input.description,
    notes: input.notes,
    yield_quantity: input.yieldQuantity,
    yield_unit: input.yieldUnit,
    status: input.status,
    is_subrecipe: input.isSubrecipe,
    is_verified: input.isVerified,
  };
  let id = input.id;
  if (id) {
    const res = await tx`update public.recipes set ${tx(row)} where id = ${id} returning id`;
    if (res.length === 0) throw new Error('Receptura nebyla nalezena.');
  } else {
    id = (await tx`insert into public.recipes ${tx(row)} returning id`)[0].id as string;
  }
  // Řádky receptury se nahradí celé v rámci jedné transakce.
  await tx`delete from public.recipe_ingredients where recipe_id = ${id}`;
  if (input.items.length) {
    const rows = input.items.map((it, i) => ({
      recipe_id: id!,
      ingredient_id: it.ingredientId,
      sub_recipe_id: it.subRecipeId,
      quantity_used: it.quantity,
      unit: it.unit,
      sort_order: i,
      note: it.note ?? null,
    }));
    await tx`insert into public.recipe_ingredients ${tx(rows)}`;
  }
  return id!;
}

export async function duplicateRecipe(tx: Tx, id: string): Promise<string> {
  const [src] = await tx`select * from public.recipes where id = ${id}`;
  if (!src) throw new Error('Receptura nebyla nalezena.');
  const [copy] = await tx`
    insert into public.recipes (name, description, notes, yield_quantity, yield_unit, status, is_subrecipe, is_verified)
    values (${src.name + ' (kopie)'}, ${src.description}, ${src.notes}, ${src.yield_quantity}, ${src.yield_unit},
            ${src.status === 'archived' ? 'active' : src.status}, ${src.is_subrecipe}, false)
    returning id`;
  await tx`
    insert into public.recipe_ingredients (recipe_id, ingredient_id, sub_recipe_id, quantity_used, unit, sort_order, note)
    select ${copy.id}, ingredient_id, sub_recipe_id, quantity_used, unit, sort_order, note
    from public.recipe_ingredients where recipe_id = ${id}`;
  return copy.id;
}

// ---------------------------------------------------------------------------
// Výrobky
// ---------------------------------------------------------------------------
export async function upsertProduct(tx: Tx, input: ProductInput): Promise<string> {
  const row = {
    recipe_id: input.recipeId,
    name: input.name,
    category: input.category,
    sales_unit: input.salesUnit,
    piece_weight: input.pieceWeight,
    wholesale_price: input.wholesalePrice,
    retail_price: input.retailPrice,
    retail_portions: input.retailPortions,
    target_margin_pct: input.targetMarginPct,
    is_active: input.isActive,
    notes: input.notes,
  };
  if (input.id) {
    const res = await tx`update public.products set ${tx(row)} where id = ${input.id} returning id`;
    if (res.length === 0) throw new Error('Výrobek nebyl nalezen.');
    return res[0].id;
  }
  const [{ next }] = await tx`select coalesce(max(sort_order), 0) + 1 as next from public.products`;
  const res = await tx`insert into public.products ${tx({ ...row, sort_order: next })} returning id`;
  return res[0].id;
}

export async function productHistory(tx: Tx, id: string) {
  return tx`select old_wholesale_price, wholesale_price, old_retail_price, retail_price, changed_at
            from public.product_price_history where product_id = ${id} order by changed_at desc limit 50`;
}

// ---------------------------------------------------------------------------
// Nastavení a plán
// ---------------------------------------------------------------------------
export async function saveSettings(tx: Tx, s: CostSettings) {
  const row = {
    baking_days_per_month: s.bakingDaysPerMonth,
    hours_per_baking_day: s.hoursPerBakingDay,
    hourly_labor_cost: s.hourlyLaborCost,
    monthly_energy_cost: s.monthlyEnergyCost,
    packaging_cost_per_baking_day: s.packagingCostPerBakingDay,
    delivery_cost_per_baking_day: s.deliveryCostPerBakingDay,
    other_monthly_costs: s.otherMonthlyCosts,
    default_target_margin_pct: s.defaultTargetMarginPct,
    vat_enabled: s.vatEnabled,
    vat_rate_pct: s.vatRatePct,
  };
  await tx`
    insert into public.cost_settings ${tx(row)}
    on conflict (owner_id) do update set ${tx(row)}`;
}

export async function savePlan(tx: Tx, items: { productId: string; quantity: number }[]) {
  for (const it of items) {
    await tx`
      insert into public.plan_items (product_id, quantity_per_baking_day)
      values (${it.productId}, ${it.quantity})
      on conflict (owner_id, product_id) do update set quantity_per_baking_day = excluded.quantity_per_baking_day`;
  }
}
