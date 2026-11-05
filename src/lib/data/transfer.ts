import 'server-only';
import type { Tx } from '@/lib/db/rls';
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup } from '@/lib/backup/schema';
import type { LegacyImportPlan } from '@/lib/backup/legacy';
import { randomUUID } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const strip = (rows: any[], keys: string[]) =>
  rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] instanceof Date ? r[k].toISOString() : r[k] ?? null])));

export async function exportBackup(tx: Tx): Promise<Backup> {
  const [ingredients, iph, recipes, ri, products, pph, settings, plan, scen, scenItems] = await Promise.all([
    tx`select * from public.ingredients order by created_at`,
    tx`select * from public.ingredient_price_history order by changed_at`,
    tx`select * from public.recipes order by created_at`,
    tx`select * from public.recipe_ingredients order by recipe_id, sort_order`,
    tx`select * from public.products order by sort_order`,
    tx`select * from public.product_price_history order by changed_at`,
    tx`select * from public.cost_settings limit 1`,
    tx`select * from public.plan_items`,
    tx`select * from public.production_scenarios order by created_at`,
    tx`select * from public.production_scenario_items`,
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      ingredients: strip(ingredients, ['id', 'name', 'category', 'brand', 'supplier', 'package_quantity', 'package_unit', 'package_price', 'price_updated_at', 'note', 'is_active']) as any,
      ingredient_price_history: strip(iph, ['id', 'ingredient_id', 'old_price', 'new_price', 'old_package_quantity', 'package_quantity', 'package_unit', 'changed_at']) as any,
      recipes: strip(recipes, ['id', 'name', 'description', 'notes', 'yield_quantity', 'yield_unit', 'status', 'is_subrecipe', 'is_verified']) as any,
      recipe_ingredients: strip(ri, ['id', 'recipe_id', 'ingredient_id', 'sub_recipe_id', 'quantity_used', 'unit', 'sort_order', 'note']) as any,
      products: strip(products, ['id', 'recipe_id', 'name', 'category', 'sales_unit', 'piece_weight', 'wholesale_price', 'retail_price', 'retail_portions', 'target_margin_pct', 'is_active', 'notes', 'sort_order']) as any,
      product_price_history: strip(pph, ['id', 'product_id', 'old_wholesale_price', 'wholesale_price', 'old_retail_price', 'retail_price', 'changed_at']) as any,
      cost_settings: settings[0]
        ? (strip(settings, ['baking_days_per_month', 'hours_per_baking_day', 'hourly_labor_cost', 'monthly_energy_cost', 'packaging_cost_per_baking_day', 'delivery_cost_per_baking_day', 'other_monthly_costs', 'default_target_margin_pct', 'vat_enabled', 'vat_rate_pct'])[0] as any)
        : null,
      plan_items: strip(plan, ['product_id', 'quantity_per_baking_day']) as any,
      production_scenarios: scen.map((s) => ({
        id: s.id,
        name: s.name,
        note: s.note,
        settings_snapshot: s.settings_snapshot,
        results_snapshot: s.results_snapshot,
        created_at: iso(s.created_at)!,
        applied_at: iso(s.applied_at),
      })),
      production_scenario_items: strip(scenItems, ['id', 'scenario_id', 'product_id', 'product_name', 'sales_unit', 'quantity_per_baking_day', 'wholesale_price', 'price_override', 'unit_cost']) as any,
    },
  };
}

export async function countData(tx: Tx) {
  const [r] = await tx`
    select (select count(*) from public.ingredients)::int as ingredients,
           (select count(*) from public.recipes)::int as recipes,
           (select count(*) from public.products)::int as products`;
  return r as { ingredients: number; recipes: number; products: number };
}

/**
 * Obnoví data ze zálohy – NAHRADÍ všechna stávající data přihlášeného uživatele.
 * Probíhá v jedné transakci: při chybě se nic nezmění.
 */
export async function restoreBackup(tx: Tx, backup: Backup) {
  const d = backup.data;
  await tx`select set_config('ztrouby.skip_history', 'on', true)`;
  await tx`delete from public.production_scenario_items`;
  await tx`delete from public.production_scenarios`;
  await tx`delete from public.plan_items`;
  await tx`delete from public.products`;
  await tx`delete from public.recipe_ingredients`;
  await tx`delete from public.recipes`;
  await tx`delete from public.ingredients`;

  const ins = async (table: string, rows: Record<string, unknown>[]) => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      if (chunk.length) await tx`insert into ${tx(table)} ${tx(chunk as any)}`;
    }
  };
  await ins('ingredients', d.ingredients);
  await ins('ingredient_price_history', d.ingredient_price_history);
  await ins('recipes', d.recipes);
  await ins('recipe_ingredients', d.recipe_ingredients);
  await ins('products', d.products);
  await ins('product_price_history', d.product_price_history);
  if (d.cost_settings) {
    await tx`delete from public.cost_settings`;
    await ins('cost_settings', [d.cost_settings]);
  }
  await ins('plan_items', d.plan_items);
  await ins(
    'production_scenarios',
    d.production_scenarios.map((s) => ({ ...s, settings_snapshot: tx.json((s.settings_snapshot ?? {}) as any), results_snapshot: s.results_snapshot == null ? null : tx.json(s.results_snapshot as any) })),
  );
  await ins('production_scenario_items', d.production_scenario_items);
  await tx`select set_config('ztrouby.skip_history', 'off', true)`;
}

/** Provede import ze staré kalkulačky podle odsouhlaseného plánu. Nic nepřepisuje bez rozhodnutí. */
export async function applyLegacyPlan(tx: Tx, plan: LegacyImportPlan) {
  if (plan.unresolved.length) throw new Error('Import obsahuje nevyřešené konflikty.');
  const idByKey: Record<string, string> = { ...plan.ingredientIdByKey };
  const today = new Date().toISOString().slice(0, 10);
  for (const ing of plan.ingredientsToCreate) {
    const id = randomUUID();
    await tx`
      insert into public.ingredients (id, name, category, package_quantity, package_unit, package_price, price_updated_at, note)
      values (${id}, ${ing.name}, 'ostatní', ${ing.size}, ${ing.unit}, ${ing.price}, ${ing.price != null ? today : null},
              'Importováno ze staré kalkulačky')`;
    idByKey[ing.tempKey] = id;
  }
  for (const u of plan.ingredientsToUpdate) {
    await tx`update public.ingredients set package_quantity = ${u.size}, package_price = ${u.price}, price_updated_at = ${today} where id = ${u.id}`;
  }
  const [{ next }] = await tx`select coalesce(max(sort_order), 0) + 1 as next from public.products`;
  let order = next as number;
  for (const p of plan.products) {
    const recipeId = randomUUID();
    const yieldUnit = p.salesUnit === 'weight' ? 'g' : 'ks';
    await tx`
      insert into public.recipes (id, name, yield_quantity, yield_unit, status, notes)
      values (${recipeId}, ${p.finalName}, ${p.yield}, ${yieldUnit}, 'draft',
              'Importováno ze staré kalkulačky – zkontrolujte suroviny, výtěžnost a jednotky.')`;
    let i = 0;
    for (const l of p.lines) {
      const ingId = idByKey[l.ingredientKey];
      if (!ingId) continue;
      await tx`
        insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity_used, unit, sort_order)
        values (${recipeId}, ${ingId}, ${l.used}, ${l.unit}, ${i++})`;
    }
    const productId = randomUUID();
    await tx`
      insert into public.products (id, recipe_id, name, category, sales_unit, wholesale_price, retail_price, retail_portions, sort_order, notes)
      values (${productId}, ${recipeId}, ${p.finalName}, 'ostatní', ${p.salesUnit}, ${p.wholesale}, ${p.cafePrice},
              ${p.salesUnit === 'weight' ? 1 : p.cafePortions}, ${order++}, 'Importováno ze staré kalkulačky')`;
    if (p.qty > 0) {
      await tx`insert into public.plan_items (product_id, quantity_per_baking_day) values (${productId}, ${p.qty})
               on conflict (owner_id, product_id) do update set quantity_per_baking_day = excluded.quantity_per_baking_day`;
    }
  }
  if (plan.settings && Object.keys(plan.settings).length) {
    const s = plan.settings;
    await tx`insert into public.cost_settings default values on conflict (owner_id) do nothing`;
    const row: Record<string, number> = {};
    if (s.bakingDaysPerMonth != null) row.baking_days_per_month = Math.min(31, s.bakingDaysPerMonth);
    if (s.hoursPerBakingDay != null) row.hours_per_baking_day = Math.min(24, s.hoursPerBakingDay);
    if (s.hourlyLaborCost != null) row.hourly_labor_cost = s.hourlyLaborCost;
    if (s.monthlyEnergyCost != null) row.monthly_energy_cost = s.monthlyEnergyCost;
    if (s.packagingCostPerBakingDay != null) row.packaging_cost_per_baking_day = s.packagingCostPerBakingDay;
    if (s.deliveryCostPerBakingDay != null) row.delivery_cost_per_baking_day = s.deliveryCostPerBakingDay;
    if (s.otherMonthlyCosts != null) row.other_monthly_costs = s.otherMonthlyCosts;
    if (Object.keys(row).length) await tx`update public.cost_settings set ${tx(row)}`;
  }
  return { products: plan.products.length, ingredients: plan.ingredientsToCreate.length };
}
