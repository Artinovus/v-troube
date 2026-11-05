import type { Workspace } from '@/lib/data/repo';
import type { Product } from '@/lib/calc';
import { computeAllRecipeCosts, marginPct, markupPct, priceForMargin, productCost } from '@/lib/calc';

export function productEconomics(p: Product, ws: Pick<Workspace, 'recipes' | 'ingredients' | 'settings'>, costs = computeAllRecipeCosts(ws.recipes, ws.ingredients)) {
  const recipe = ws.recipes.find((r) => r.id === p.recipeId);
  const pc = productCost(p, recipe, recipe ? costs.get(recipe.id) : undefined);
  const target = p.targetMarginPct ?? ws.settings.defaultTargetMarginPct;
  return {
    recipe,
    cost: pc,
    contribution: pc.unitCost != null ? p.wholesalePrice - pc.unitCost : null,
    margin: pc.unitCost != null ? marginPct(p.wholesalePrice, pc.unitCost) : null,
    markup: pc.unitCost != null ? markupPct(p.wholesalePrice, pc.unitCost) : null,
    target,
    recommended: pc.unitCost != null ? priceForMargin(pc.unitCost, target) : null,
  };
}

export const SALES_UNIT_TEXT = { piece: 'Kus', whole: 'Celý výrobek', weight: 'Na váhu (cena za 100 g)' } as const;
