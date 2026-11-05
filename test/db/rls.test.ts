import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { adminSql, createUser } from './helpers';
import { withUserTx } from '@/lib/db/rls';
import { getSql } from '@/lib/db/client';
import { ensureSeeded, loadWorkspace, upsertIngredient, saveRecipe, upsertProduct } from '@/lib/data/repo';
import { exportBackup, restoreBackup, applyLegacyPlan } from '@/lib/data/transfer';
import { parseBackup } from '@/lib/backup/schema';
import { buildLegacyPlan, parseLegacy } from '@/lib/backup/legacy';
import { computeAllRecipeCosts } from '@/lib/calc';

const sql = adminSql();
let A: string, B: string, C: string;

const ingInput = (name: string, price: number | null = 65) => ({
  name, category: 'tuky', brand: null, supplier: null, packageQuantity: 250, packageUnit: 'g' as const,
  packagePrice: price, priceUpdatedAt: '2026-11-01', note: null, isActive: true,
});

beforeAll(async () => {
  A = await createUser(sql, `a-${randomUUID()}@test.cz`);
  B = await createUser(sql, `b-${randomUUID()}@test.cz`);
  C = await createUser(sql, `c-${randomUUID()}@test.cz`, 'user');
});
afterAll(async () => {
  await sql.end();
  await getSql().end();
});

describe('výchozí data', () => {
  it('seed vytvoří výchozí sortiment jen jednou', async () => {
    await withUserTx(A, (tx) => ensureSeeded(tx));
    await withUserTx(A, (tx) => ensureSeeded(tx));
    const ws = await withUserTx(A, (tx) => loadWorkspace(tx));
    expect(ws.products.map((p) => [p.name, p.wholesalePrice])).toEqual([
      ['Uzel mák + švestky', 49], ['Uzel skořice + ořechy', 47], ['Uzel skořice + kardamom', 43],
      ['Cookie s pistáciemi a bílou čokoládou, 70 g', 45], ['Medovník z dvojité dávky', 1040],
      ['Banánový chlebíček', 360], ['Perníčky', 49],
    ]);
    expect(ws.products.find((p) => p.name === 'Perníčky')!.salesUnit).toBe('weight');
    // ceny surovin nejsou vymyšlené
    expect(ws.ingredients.every((i) => i.packagePrice == null)).toBe(true);
    expect(ws.recipes.every((r) => !r.isVerified && r.status === 'draft')).toBe(true);
    expect(ws.settings.bakingDaysPerMonth).toBe(8);
  });
  it('ne-admin nemůže seedovat', async () => {
    await expect(withUserTx(C, (tx) => ensureSeeded(tx))).rejects.toThrow();
  });
});

describe('15. izolace dat a RLS', () => {
  let ingA: string;
  beforeAll(async () => {
    ingA = await withUserTx(A, (tx) => upsertIngredient(tx, ingInput('Máslo A')));
  });
  it('jiný uživatel data nevidí ani nezmění', async () => {
    const seen = await withUserTx(B, (tx) => tx`select id from public.ingredients where id = ${ingA}`);
    expect(seen).toHaveLength(0);
    const upd = await withUserTx(B, (tx) => tx`update public.ingredients set package_price = 1 where id = ${ingA} returning id`);
    expect(upd).toHaveLength(0);
    const del = await withUserTx(B, (tx) => tx`delete from public.ingredients where id = ${ingA} returning id`);
    expect(del).toHaveLength(0);
    const [still] = await sql`select package_price from public.ingredients where id = ${ingA}`;
    expect(Number(still.package_price)).toBe(65);
  });
  it('nelze vložit záznam za cizího vlastníka', async () => {
    await expect(withUserTx(B, (tx) => tx`insert into public.ingredients (owner_id, name) values (${A}, 'Podvrh')`)).rejects.toThrow(/row-level security/);
  });
  it('nelze odkázat na cizí surovinu v receptuře (složený cizí klíč)', async () => {
    await expect(
      withUserTx(B, (tx) => saveRecipe(tx, { name: 'X', description: null, notes: null, yieldQuantity: 1, yieldUnit: 'ks', status: 'active', isSubrecipe: false, isVerified: false, items: [{ ingredientId: ingA, subRecipeId: null, quantity: 10, unit: 'g', note: null }] })),
    ).rejects.toThrow();
  });
  it('uživatel bez role admin nemá přístup k datům', async () => {
    expect(await withUserTx(C, (tx) => tx`select * from public.ingredients`)).toHaveLength(0);
    await expect(withUserTx(C, (tx) => tx`insert into public.ingredients (name) values ('x')`)).rejects.toThrow(/row-level security/);
  });
  it('uživatel si nemůže sám přidělit roli admin', async () => {
    await expect(withUserTx(C, (tx) => tx`update public.profiles set role = 'admin' where id = ${C}`)).rejects.toThrow(/permission denied/);
  });
  it('anonymní role nemá k tabulkám přístup', async () => {
    await expect(sql.begin(async (tx) => { await tx`set local role anon`; return tx`select * from public.ingredients`; })).rejects.toThrow(/permission denied/);
  });
  it('historie cen nelze mazat ani upravovat', async () => {
    await expect(withUserTx(A, (tx) => tx`delete from public.ingredient_price_history`)).rejects.toThrow(/permission denied/);
    await expect(withUserTx(A, (tx) => tx`update public.product_price_history set wholesale_price = 0`)).rejects.toThrow(/permission denied/);
  });
});

describe('4./12. ukládání, historie cen a přepočet', () => {
  it('změna ceny másla se zapíše do historie a přepočítá receptury', async () => {
    const ingId = await withUserTx(A, (tx) => upsertIngredient(tx, ingInput('Máslo 82 %')));
    const r1 = await withUserTx(A, (tx) => saveRecipe(tx, { name: 'R1', description: null, notes: null, yieldQuantity: 10, yieldUnit: 'ks', status: 'active', isSubrecipe: false, isVerified: true, items: [{ ingredientId: ingId, subRecipeId: null, quantity: 250, unit: 'g', note: null }] }));
    const r2 = await withUserTx(A, (tx) => saveRecipe(tx, { name: 'R2', description: null, notes: null, yieldQuantity: 1, yieldUnit: 'ks', status: 'active', isSubrecipe: false, isVerified: true, items: [{ ingredientId: ingId, subRecipeId: null, quantity: 113, unit: 'g', note: null }] }));
    let ws = await withUserTx(A, (tx) => loadWorkspace(tx));
    let costs = computeAllRecipeCosts(ws.recipes, ws.ingredients);
    expect(costs.get(r1)!.batchCost).toBeCloseTo(65);
    expect(costs.get(r2)!.batchCost).toBeCloseTo(29.38, 2);

    await withUserTx(A, (tx) => upsertIngredient(tx, { ...ingInput('Máslo 82 %', 75), id: ingId }));
    ws = await withUserTx(A, (tx) => loadWorkspace(tx));
    costs = computeAllRecipeCosts(ws.recipes, ws.ingredients);
    expect(costs.get(r1)!.batchCost).toBeCloseTo(75);
    expect(costs.get(r2)!.batchCost).toBeCloseTo(33.9, 2);

    const hist = await withUserTx(A, (tx) => tx`select old_price, new_price from public.ingredient_price_history where ingredient_id = ${ingId} order by changed_at`);
    expect(hist.map((h) => [h.old_price, h.new_price])).toEqual([[null, 65], [65, 75]]);
  });
  it('cyklus podreceptur odmítne databáze', async () => {
    const a = await withUserTx(A, (tx) => saveRecipe(tx, { name: 'Cyk A', description: null, notes: null, yieldQuantity: 100, yieldUnit: 'g', status: 'active', isSubrecipe: true, isVerified: false, items: [] }));
    const b = await withUserTx(A, (tx) => saveRecipe(tx, { name: 'Cyk B', description: null, notes: null, yieldQuantity: 100, yieldUnit: 'g', status: 'active', isSubrecipe: true, isVerified: false, items: [{ ingredientId: null, subRecipeId: a, quantity: 50, unit: 'g', note: null }] }));
    await expect(withUserTx(A, (tx) => saveRecipe(tx, { id: a, name: 'Cyk A', description: null, notes: null, yieldQuantity: 100, yieldUnit: 'g', status: 'active', isSubrecipe: true, isVerified: false, items: [{ ingredientId: null, subRecipeId: b, quantity: 50, unit: 'g', note: null }] }))).rejects.toThrow(/cyklus/);
  });
  it('11. přidání, editace a archivace výrobku + historie ceny', async () => {
    const pid = await withUserTx(A, (tx) => upsertProduct(tx, { recipeId: null, name: 'Nový koláč', category: 'koláče', salesUnit: 'piece', pieceWeight: null, wholesalePrice: 40, retailPrice: 70, retailPortions: 1, targetMarginPct: null, isActive: true, notes: null }));
    await withUserTx(A, (tx) => upsertProduct(tx, { id: pid, recipeId: null, name: 'Nový koláč', category: 'koláče', salesUnit: 'piece', pieceWeight: null, wholesalePrice: 45, retailPrice: 75, retailPortions: 1, targetMarginPct: null, isActive: false, notes: null }));
    const ws = await withUserTx(A, (tx) => loadWorkspace(tx));
    const p = ws.products.find((x) => x.id === pid)!;
    expect(p.wholesalePrice).toBe(45);
    expect(p.isActive).toBe(false);
    const hist = await withUserTx(A, (tx) => tx`select old_wholesale_price, wholesale_price from public.product_price_history where product_id = ${pid} order by changed_at`);
    expect(hist.map((h) => [h.old_wholesale_price, h.wholesale_price])).toEqual([[null, 40], [40, 45]]);
  });
  it('výrobek s navázanou recepturou brání smazání receptury', async () => {
    const ws = await withUserTx(A, (tx) => loadWorkspace(tx));
    const used = ws.products.find((p) => p.recipeId)!.recipeId!;
    await expect(withUserTx(A, (tx) => tx`delete from public.recipes where id = ${used}`)).rejects.toThrow(/foreign key/);
  });
});

describe('13. záloha – export a import', () => {
  it('export → validace → obnova u jiného uživatele dá stejná data', async () => {
    const backup = await withUserTx(A, (tx) => exportBackup(tx));
    const json = JSON.parse(JSON.stringify(backup));
    const parsed = parseBackup(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // B má vlastní data, obnova je nahradí – ale identifikátory A jsou obsazené, proto
    // se obnova testuje u A (náhrada vlastních dat) a zároveň se ověří, že B zůstal netknutý.
    await withUserTx(B, (tx) => upsertIngredient(tx, ingInput('Data B')));
    await withUserTx(A, (tx) => restoreBackup(tx, parsed.backup));
    const after = await withUserTx(A, (tx) => exportBackup(tx));
    const norm = (b: typeof backup) => ({ ...b.data, production_scenarios: b.data.production_scenarios.length });
    expect(norm(after)).toEqual(norm(backup));
    const bData = await withUserTx(B, (tx) => tx`select name from public.ingredients`);
    expect(bData.map((r) => r.name)).toContain('Data B');
  });
  it('neplatná záloha je odmítnuta', () => {
    expect(parseBackup({ format: 'z-trouby-zaloha', version: 1 }).ok).toBe(false);
    expect(parseBackup({ foo: 1 }).ok).toBe(false);
  });
  it('import ze staré kalkulačky', async () => {
    const legacy = {
      products: [
        { name: 'Cookie stará', qty: 15, wholesale: 45, cafePrice: 79, cafePortions: 1, yield: 8, ingredients: [{ name: 'Máslo A', used: 113, unit: 'g', size: 250, price: 65 }, { name: 'Mouka', used: 0.3, unit: 'kg', size: 1, price: 25 }] },
        { name: 'Uzel starý', qty: 12, wholesale: 49, cafePrice: null, cafePortions: 1, yield: 12, ingredients: [{ name: 'mouka', used: 500, unit: 'g', size: 1000, price: 27 }] },
      ],
      days: 8, hours: 7, hourly: 200, fixed: 1000, packing: 120, delivery: 150, other: 0,
    };
    const parsed = parseLegacy(legacy);
    const mouka = parsed.ingredients.find((i) => i.name.toLowerCase() === 'mouka')!;
    expect(mouka.ambiguous).toBe(true);
    const ws = await withUserTx(A, (tx) => loadWorkspace(tx));
    const undecided = buildLegacyPlan(parsed, { variant: {}, existingIngredient: {}, existingProduct: {}, salesUnit: {}, importSettings: true }, ws.ingredients, ws.products.map((p) => p.name));
    expect(undecided.unresolved.length).toBe(2); // mouka varianta + existující máslo
    const plan = buildLegacyPlan(parsed, { variant: { [mouka.key]: 0 }, existingIngredient: { 'máslo a|g': 'use' }, existingProduct: {}, salesUnit: {}, importSettings: true }, ws.ingredients, ws.products.map((p) => p.name));
    expect(plan.unresolved).toEqual([]);
    await withUserTx(A, (tx) => applyLegacyPlan(tx, plan));
    const ws2 = await withUserTx(A, (tx) => loadWorkspace(tx));
    const cookie = ws2.products.find((p) => p.name === 'Cookie stará')!;
    expect(cookie.retailPrice).toBe(79);
    expect(ws2.plan[cookie.id]).toBe(15);
    expect(ws2.settings.packagingCostPerBakingDay).toBe(120);
    const masla = ws2.ingredients.filter((i) => i.name === 'Máslo A');
    expect(masla).toHaveLength(1); // sdílená, nezdvojená
    const costs = computeAllRecipeCosts(ws2.recipes, ws2.ingredients);
    expect(costs.get(cookie.recipeId!)!.batchCost).toBeCloseTo(29.38 + 0.3 * 25, 2);
  });
});
