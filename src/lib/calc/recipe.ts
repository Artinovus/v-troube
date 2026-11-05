import type { Ingredient, Recipe, UsageUnit, YieldUnit, PackageUnit } from './types';

export type Dimension = 'mass' | 'volume' | 'count';

const UNIT_INFO: Record<UsageUnit, { dim: Dimension; factor: number }> = {
  g: { dim: 'mass', factor: 1 },
  kg: { dim: 'mass', factor: 1000 },
  ml: { dim: 'volume', factor: 1 },
  l: { dim: 'volume', factor: 1000 },
  ks: { dim: 'count', factor: 1 },
};

export function unitDimension(u: UsageUnit | PackageUnit | YieldUnit): Dimension {
  return UNIT_INFO[u].dim;
}

/** Jednotky použitelné v receptu pro surovinu / polotovar s danou základní jednotkou. */
export function compatibleUnits(base: PackageUnit | YieldUnit): UsageUnit[] {
  const dim = unitDimension(base);
  return (Object.keys(UNIT_INFO) as UsageUnit[]).filter((u) => UNIT_INFO[u].dim === dim);
}

/**
 * Převede množství na základní jednotku (g, ml, ks).
 * Vrací null, pokud se jednotky nedají převést (např. ks → g).
 */
export function convertQuantity(qty: number, from: UsageUnit, to: PackageUnit | YieldUnit): number | null {
  const a = UNIT_INFO[from];
  const b = UNIT_INFO[to];
  if (!a || !b || a.dim !== b.dim) return null;
  return (qty * a.factor) / b.factor;
}

export const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export type LineIssue =
  | 'missing_ingredient'
  | 'missing_price'
  | 'missing_package'
  | 'unit_mismatch'
  | 'invalid_quantity'
  | 'subrecipe_incomplete'
  | 'subrecipe_cycle'
  | 'inactive_ingredient';

export const LINE_ISSUE_TEXT: Record<LineIssue, string> = {
  missing_ingredient: 'Surovina nebo polotovar neexistuje',
  missing_price: 'Chybí cena balení',
  missing_package: 'Chybí velikost balení',
  unit_mismatch: 'Jednotka neodpovídá jednotce suroviny',
  invalid_quantity: 'Neplatné množství',
  subrecipe_incomplete: 'Náklad polotovaru není úplný',
  subrecipe_cycle: 'Cyklická podreceptura',
  inactive_ingredient: 'Surovina je neaktivní (cena se přesto používá)',
};

/**
 * Cena spotřebované suroviny = (spotřeba / velikost balení) × cena balení.
 * Spotřeba se nejprve převede do jednotky balení (např. kg → g).
 */
export function ingredientCost(
  ingredient: Pick<Ingredient, 'packageQuantity' | 'packageUnit' | 'packagePrice'>,
  quantityUsed: number,
  unit: UsageUnit = ingredient.packageUnit,
): { cost: number | null; issue?: LineIssue } {
  if (!isFiniteNumber(quantityUsed) || quantityUsed < 0) return { cost: null, issue: 'invalid_quantity' };
  if (ingredient.packagePrice == null || !isFiniteNumber(ingredient.packagePrice)) return { cost: null, issue: 'missing_price' };
  if (ingredient.packageQuantity == null || !(ingredient.packageQuantity > 0)) return { cost: null, issue: 'missing_package' };
  const qty = convertQuantity(quantityUsed, unit, ingredient.packageUnit);
  if (qty == null) return { cost: null, issue: 'unit_mismatch' };
  return { cost: (qty / ingredient.packageQuantity) * ingredient.packagePrice };
}

export interface RecipeLineCost {
  itemId: string;
  kind: 'ingredient' | 'subrecipe';
  refId: string | null;
  name: string;
  quantity: number;
  unit: UsageUnit;
  /** náklad řádku; null pokud ho nelze spočítat */
  cost: number | null;
  issue?: LineIssue;
  warning?: LineIssue;
}

export interface RecipeCost {
  recipeId: string;
  /** součet spočitatelných řádků */
  batchCost: number;
  /** náklad na jednotku výtěžnosti (ks / g / ml); null pokud chybí výtěžnost */
  unitCost: number | null;
  /** true pokud jsou všechny řádky spočítané a recept má suroviny i výtěžnost */
  complete: boolean;
  lines: RecipeLineCost[];
  issues: string[];
}

/**
 * Spočítá náklady všech receptur najednou (včetně vnořených polotovarů).
 * Náklad polotovaru se do finální receptury započítá poměrně podle použitého
 * množství: množství × (cena dávky polotovaru / výtěžnost polotovaru).
 * Suroviny polotovaru se tak nikdy nezapočítají dvakrát.
 */
export function computeAllRecipeCosts(recipes: Recipe[], ingredients: Ingredient[]): Map<string, RecipeCost> {
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  const recById = new Map(recipes.map((r) => [r.id, r]));
  const result = new Map<string, RecipeCost>();
  const visiting = new Set<string>();

  const compute = (recipe: Recipe): RecipeCost => {
    const cached = result.get(recipe.id);
    if (cached) return cached;
    visiting.add(recipe.id);
    const lines: RecipeLineCost[] = [];
    const issues: string[] = [];
    let batchCost = 0;
    let complete = true;

    for (const item of recipe.items) {
      if (item.subRecipeId) {
        const sub = recById.get(item.subRecipeId);
        const line: RecipeLineCost = {
          itemId: item.id,
          kind: 'subrecipe',
          refId: item.subRecipeId,
          name: sub?.name ?? 'Neznámý polotovar',
          quantity: item.quantity,
          unit: item.unit,
          cost: null,
        };
        if (!sub) line.issue = 'missing_ingredient';
        else if (visiting.has(sub.id)) line.issue = 'subrecipe_cycle';
        else if (!isFiniteNumber(item.quantity) || item.quantity < 0) line.issue = 'invalid_quantity';
        else {
          const subCost = compute(sub);
          const qty = convertQuantity(item.quantity, item.unit, sub.yieldUnit);
          if (qty == null) line.issue = 'unit_mismatch';
          else if (subCost.unitCost == null) line.issue = 'subrecipe_incomplete';
          else {
            line.cost = qty * subCost.unitCost;
            if (!subCost.complete) line.warning = 'subrecipe_incomplete';
          }
          if (!subCost.complete) complete = false;
        }
        lines.push(line);
      } else {
        const ing = item.ingredientId ? ingById.get(item.ingredientId) : undefined;
        const line: RecipeLineCost = {
          itemId: item.id,
          kind: 'ingredient',
          refId: item.ingredientId,
          name: ing?.name ?? 'Neznámá surovina',
          quantity: item.quantity,
          unit: item.unit,
          cost: null,
        };
        if (!ing) line.issue = 'missing_ingredient';
        else {
          const r = ingredientCost(ing, item.quantity, item.unit);
          line.cost = r.cost;
          line.issue = r.issue;
          if (!ing.isActive) line.warning = 'inactive_ingredient';
        }
        lines.push(line);
      }
      const last = lines[lines.length - 1];
      if (last.cost == null) complete = false;
      else batchCost += last.cost;
    }

    if (recipe.items.length === 0) {
      complete = false;
      issues.push('Receptura nemá žádné suroviny.');
    }
    const missing = lines.filter((l) => l.issue);
    if (missing.length > 0) issues.push(`${missing.length} ${missing.length === 1 ? 'řádek nelze spočítat' : 'řádků nelze spočítat'} (chybí cena, balení nebo jednotka).`);
    if (lines.some((l) => l.warning === 'subrecipe_incomplete' || l.issue === 'subrecipe_incomplete')) issues.push('Některý polotovar nemá úplný náklad.');

    let unitCost: number | null = null;
    if (recipe.yieldQuantity != null && recipe.yieldQuantity > 0) unitCost = batchCost / recipe.yieldQuantity;
    else {
      complete = false;
      issues.push('Chybí výtěžnost dávky.');
    }
    if (recipe.items.length === 0) unitCost = null;

    visiting.delete(recipe.id);
    const rc: RecipeCost = { recipeId: recipe.id, batchCost, unitCost, complete, lines, issues };
    result.set(recipe.id, rc);
    return rc;
  };

  for (const r of recipes) compute(r);
  return result;
}

/** Recepty (přímo i přes polotovary), kterých se dotkne změna dané suroviny. */
export function recipesUsingIngredient(recipes: Recipe[], ingredientId: string): Recipe[] {
  const direct = new Set(recipes.filter((r) => r.items.some((i) => i.ingredientId === ingredientId)).map((r) => r.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of recipes) {
      if (!direct.has(r.id) && r.items.some((i) => i.subRecipeId && direct.has(i.subRecipeId))) {
        direct.add(r.id);
        changed = true;
      }
    }
  }
  return recipes.filter((r) => direct.has(r.id));
}

export interface PriceChangeImpact {
  recipeId: string;
  name: string;
  yieldUnit: YieldUnit;
  oldBatchCost: number;
  newBatchCost: number;
  oldUnitCost: number | null;
  newUnitCost: number | null;
}

/** Dopad změny ceny/balení suroviny na všechny dotčené receptury. */
export function ingredientChangeImpact(
  recipes: Recipe[],
  ingredients: Ingredient[],
  changed: Ingredient,
): PriceChangeImpact[] {
  const affected = recipesUsingIngredient(recipes, changed.id);
  if (affected.length === 0) return [];
  const before = computeAllRecipeCosts(recipes, ingredients);
  const after = computeAllRecipeCosts(
    recipes,
    ingredients.map((i) => (i.id === changed.id ? changed : i)),
  );
  return affected.map((r) => ({
    recipeId: r.id,
    name: r.name,
    yieldUnit: r.yieldUnit,
    oldBatchCost: before.get(r.id)!.batchCost,
    newBatchCost: after.get(r.id)!.batchCost,
    oldUnitCost: before.get(r.id)!.unitCost,
    newUnitCost: after.get(r.id)!.unitCost,
  }));
}

/** Vrací true, pokud by přidání polotovaru subId do receptu recipeId vytvořilo cyklus. */
export function wouldCreateCycle(recipes: Recipe[], recipeId: string, subId: string): boolean {
  if (recipeId === subId) return true;
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const stack = [subId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === recipeId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const it of byId.get(id)?.items ?? []) if (it.subRecipeId) stack.push(it.subRecipeId);
  }
  return false;
}
