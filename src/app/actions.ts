'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAdminTx } from '@/lib/auth';
import { runAction } from '@/lib/errors';
import {
  ingredientSchema,
  planSchema,
  productPriceSchema,
  productSchema,
  recipeSchema,
  scenarioSchema,
  settingsSchema,
  type ActionResult,
} from '@/lib/validation';
import {
  duplicateRecipe,
  ingredientHistory,
  loadWorkspace,
  productHistory,
  saveRecipe,
  savePlan,
  saveSettings,
  upsertIngredient,
  upsertProduct,
} from '@/lib/data/repo';
import { computePlan, unitDimension, wouldCreateCycle } from '@/lib/calc';
import { parseBackup } from '@/lib/backup/schema';
import { buildLegacyPlan, parseLegacy, type LegacyDecisions } from '@/lib/backup/legacy';
import { applyLegacyPlan, countData, restoreBackup } from '@/lib/data/transfer';

const id = z.uuid({ error: 'Neplatný identifikátor.' });
const done = () => revalidatePath('/', 'layout');

// ---------------------------------------------------------------------------
// Suroviny
// ---------------------------------------------------------------------------
export async function saveIngredientAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = ingredientSchema.parse(input);
    const res = await withAdminTx(async (tx) => {
      if (data.id) {
        // Změna jednotky balení nesmí rozbít receptury, které surovinu používají.
        const [cur] = await tx`select package_unit from public.ingredients where id = ${data.id}`;
        if (cur && cur.package_unit !== data.packageUnit) {
          const used = await tx`select unit from public.recipe_ingredients where ingredient_id = ${data.id}`;
          if (used.some((u) => unitDimension(u.unit) !== unitDimension(data.packageUnit)))
            throw new Error('Jednotku balení nelze změnit na nekompatibilní, surovina je použita v recepturách.');
        }
      }
      return { id: await upsertIngredient(tx, data) };
    });
    done();
    return res;
  }, 'Surovina uložena.');
}

export async function deleteIngredientAction(ingredientId: string): Promise<ActionResult> {
  return runAction(async () => {
    id.parse(ingredientId);
    await withAdminTx(async (tx) => {
      const used = await tx`select 1 from public.recipe_ingredients where ingredient_id = ${ingredientId} limit 1`;
      if (used.length) throw new Error('Surovina je použita v receptuře. Nejprve ji odeberte z receptur, nebo ji jen deaktivujte.');
      const r = await tx`delete from public.ingredients where id = ${ingredientId} returning id`;
      if (!r.length) throw new Error('Surovina nebyla nalezena.');
    });
    done();
    return undefined;
  }, 'Surovina odstraněna.');
}

export async function ingredientHistoryAction(ingredientId: string) {
  return runAction(async () => {
    id.parse(ingredientId);
    const rows = await withAdminTx((tx) => ingredientHistory(tx, ingredientId));
    return rows.map((r) => ({
      oldPrice: r.old_price as number | null,
      newPrice: r.new_price as number | null,
      oldPackageQuantity: r.old_package_quantity as number | null,
      packageQuantity: r.package_quantity as number | null,
      packageUnit: r.package_unit as string | null,
      changedAt: new Date(r.changed_at).toISOString(),
    }));
  });
}

// ---------------------------------------------------------------------------
// Receptury
// ---------------------------------------------------------------------------
export async function saveRecipeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = recipeSchema.parse(input);
    const res = await withAdminTx(async (tx) => {
      const ws = await loadWorkspace(tx);
      const ings = new Map(ws.ingredients.map((i) => [i.id, i]));
      const recs = new Map(ws.recipes.map((r) => [r.id, r]));
      for (const it of data.items) {
        if (it.ingredientId) {
          const ing = ings.get(it.ingredientId);
          if (!ing) throw new Error('Receptura obsahuje neexistující surovinu.');
          if (unitDimension(it.unit) !== unitDimension(ing.packageUnit))
            throw new Error(`Jednotka u suroviny „${ing.name}“ neodpovídá jednotce balení (${ing.packageUnit}).`);
        } else if (it.subRecipeId) {
          const sub = recs.get(it.subRecipeId);
          if (!sub) throw new Error('Receptura obsahuje neexistující polotovar.');
          if (unitDimension(it.unit) !== unitDimension(sub.yieldUnit))
            throw new Error(`Jednotka u polotovaru „${sub.name}“ neodpovídá jeho výtěžnosti (${sub.yieldUnit}).`);
          if (data.id && wouldCreateCycle(ws.recipes, data.id, sub.id))
            throw new Error('Podreceptura by vytvořila cyklus.');
        }
      }
      return { id: await saveRecipe(tx, data) };
    });
    done();
    return res;
  }, 'Receptura uložena.');
}

export async function duplicateRecipeAction(recipeId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    id.parse(recipeId);
    const newId = await withAdminTx((tx) => duplicateRecipe(tx, recipeId));
    done();
    return { id: newId };
  }, 'Receptura zkopírována.');
}

export async function setRecipeStatusAction(recipeId: string, status: unknown): Promise<ActionResult> {
  return runAction(async () => {
    id.parse(recipeId);
    const s = z.enum(['draft', 'active', 'archived']).parse(status);
    await withAdminTx(async (tx) => {
      const r = await tx`update public.recipes set status = ${s} where id = ${recipeId} returning id`;
      if (!r.length) throw new Error('Receptura nebyla nalezena.');
    });
    done();
    return undefined;
  }, status === 'archived' ? 'Receptura archivována.' : 'Stav receptury změněn.');
}

export async function deleteRecipeAction(recipeId: string): Promise<ActionResult> {
  return runAction(async () => {
    id.parse(recipeId);
    await withAdminTx(async (tx) => {
      const prods = await tx`select name from public.products where recipe_id = ${recipeId}`;
      if (prods.length)
        throw new Error(`Recepturu používá výrobek „${prods[0].name}“. Nejprve u něj změňte recepturu, nebo recepturu archivujte.`);
      const parents = await tx`
        select r.name from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id
        where ri.sub_recipe_id = ${recipeId} limit 1`;
      if (parents.length) throw new Error(`Polotovar je použit v receptuře „${parents[0].name}“.`);
      const r = await tx`delete from public.recipes where id = ${recipeId} returning id`;
      if (!r.length) throw new Error('Receptura nebyla nalezena.');
    });
    done();
    return undefined;
  }, 'Receptura odstraněna.');
}

// ---------------------------------------------------------------------------
// Výrobky
// ---------------------------------------------------------------------------
export async function saveProductAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = productSchema.parse(input);
    const res = await withAdminTx(async (tx) => ({ id: await upsertProduct(tx, data) }));
    done();
    return res;
  }, 'Výrobek uložen.');
}

export async function updateProductPricesAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const data = productPriceSchema.parse(input);
    const row: Record<string, number | null> = {};
    if (data.wholesalePrice !== undefined) row.wholesale_price = data.wholesalePrice;
    if (data.retailPrice !== undefined) row.retail_price = data.retailPrice;
    if (data.retailPortions !== undefined) row.retail_portions = data.retailPortions;
    if (!Object.keys(row).length) return undefined;
    await withAdminTx(async (tx) => {
      const r = await tx`update public.products set ${tx(row)} where id = ${data.id} returning id`;
      if (!r.length) throw new Error('Výrobek nebyl nalezen.');
    });
    done();
    return undefined;
  }, 'Cena uložena.');
}

export async function setProductActiveAction(productId: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    id.parse(productId);
    await withAdminTx(async (tx) => {
      const r = await tx`update public.products set is_active = ${!!active} where id = ${productId} returning id`;
      if (!r.length) throw new Error('Výrobek nebyl nalezen.');
    });
    done();
    return undefined;
  }, active ? 'Výrobek aktivován.' : 'Výrobek archivován.');
}

export async function deleteProductAction(productId: string): Promise<ActionResult> {
  return runAction(async () => {
    id.parse(productId);
    await withAdminTx(async (tx) => {
      const r = await tx`delete from public.products where id = ${productId} returning id`;
      if (!r.length) throw new Error('Výrobek nebyl nalezen.');
    });
    done();
    return undefined;
  }, 'Výrobek odstraněn.');
}

export async function productHistoryAction(productId: string) {
  return runAction(async () => {
    id.parse(productId);
    const rows = await withAdminTx((tx) => productHistory(tx, productId));
    return rows.map((r) => ({
      oldWholesalePrice: r.old_wholesale_price as number | null,
      wholesalePrice: r.wholesale_price as number | null,
      oldRetailPrice: r.old_retail_price as number | null,
      retailPrice: r.retail_price as number | null,
      changedAt: new Date(r.changed_at).toISOString(),
    }));
  });
}

// ---------------------------------------------------------------------------
// Kalkulačka
// ---------------------------------------------------------------------------
export async function saveSettingsAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const data = settingsSchema.parse(input);
    await withAdminTx((tx) => saveSettings(tx, data));
    done();
    return undefined;
  });
}

export async function savePlanAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const data = planSchema.parse(input);
    await withAdminTx((tx) => savePlan(tx, data));
    done();
    return undefined;
  });
}

/** Uloží scénář jako snímek – výsledky se počítají na serveru z aktuálních dat. */
export async function saveScenarioAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = scenarioSchema.parse(input);
    const res = await withAdminTx(async (tx) => {
      const ws = await loadWorkspace(tx);
      const products = ws.products.filter((p) => p.isActive);
      const overrides = Object.fromEntries(
        Object.entries(data.priceOverrides).filter(([k, v]) => v != null && products.some((p) => p.id === k)),
      ) as Record<string, number>;
      const base = computePlan({ products, recipes: ws.recipes, ingredients: ws.ingredients, settings: ws.settings, quantities: ws.plan });
      const scen = computePlan({ products, recipes: ws.recipes, ingredients: ws.ingredients, settings: ws.settings, quantities: ws.plan, priceOverrides: overrides });
      const results = {
        current: { revenue: base.monthly.revenue, operatingProfit: base.monthly.operatingProfit, profitBeforeLabor: base.monthly.profitBeforeLabor, returnOnSalesPct: base.monthly.returnOnSalesPct },
        scenario: { revenue: scen.monthly.revenue, operatingProfit: scen.monthly.operatingProfit, profitBeforeLabor: scen.monthly.profitBeforeLabor, returnOnSalesPct: scen.monthly.returnOnSalesPct },
        complete: scen.complete,
      };
      const [row] = await tx`
        insert into public.production_scenarios (name, note, settings_snapshot, results_snapshot)
        values (${data.name}, ${data.note}, ${tx.json(ws.settings as never)}, ${tx.json(results as never)}) returning id`;
      const items = scen.rows.map((r) => ({
        scenario_id: row.id,
        product_id: r.product.id,
        product_name: r.product.name,
        sales_unit: r.product.salesUnit,
        quantity_per_baking_day: r.planQty,
        wholesale_price: r.product.wholesalePrice,
        price_override: overrides[r.product.id] ?? null,
        unit_cost: r.cost.unitCost,
      }));
      if (items.length) await tx`insert into public.production_scenario_items ${tx(items)}`;
      return { id: row.id as string };
    });
    done();
    return res;
  }, 'Scénář uložen.');
}

/** Aplikuje ceny ze scénáře na výrobky (po potvrzení v UI). Historie cen se zapíše automaticky. */
export async function applyScenarioAction(scenarioId: string): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    id.parse(scenarioId);
    const res = await withAdminTx(async (tx) => {
      const items = await tx`
        select product_id, price_override from public.production_scenario_items
        where scenario_id = ${scenarioId} and price_override is not null and product_id is not null`;
      for (const it of items) {
        await tx`update public.products set wholesale_price = ${it.price_override} where id = ${it.product_id}`;
      }
      const r = await tx`update public.production_scenarios set applied_at = now() where id = ${scenarioId} returning id`;
      if (!r.length) throw new Error('Scénář nebyl nalezen.');
      return { updated: items.length };
    });
    done();
    return res;
  }, 'Ceny ze scénáře byly uloženy k výrobkům.');
}

export async function deleteScenarioAction(scenarioId: string): Promise<ActionResult> {
  return runAction(async () => {
    id.parse(scenarioId);
    await withAdminTx((tx) => tx`delete from public.production_scenarios where id = ${scenarioId}`);
    done();
    return undefined;
  }, 'Scénář odstraněn.');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export async function dataCountsAction() {
  return runAction(() => withAdminTx((tx) => countData(tx)));
}

export async function restoreBackupAction(json: unknown, confirmReplace: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error('Záloha není platná: ' + parsed.errors.join(' '));
    await withAdminTx(async (tx) => {
      const counts = await countData(tx);
      const hasData = counts.ingredients + counts.recipes + counts.products > 0;
      if (hasData && !confirmReplace)
        throw new Error('V aplikaci už jsou data. Obnova zálohy je přepíše – potvrďte prosím přepsání.');
      await restoreBackup(tx, parsed.backup);
    });
    done();
    return undefined;
  }, 'Záloha byla obnovena.');
}

export async function importLegacyAction(json: unknown, decisions: LegacyDecisions): Promise<ActionResult<{ products: number; ingredients: number }>> {
  return runAction(async () => {
    const parsed = parseLegacy(json);
    const res = await withAdminTx(async (tx) => {
      const ws = await loadWorkspace(tx);
      const plan = buildLegacyPlan(parsed, decisions, ws.ingredients, ws.products.map((p) => p.name));
      if (plan.unresolved.length) throw new Error(plan.unresolved[0]);
      return applyLegacyPlan(tx, plan);
    });
    done();
    return res;
  }, 'Import dokončen.');
}
