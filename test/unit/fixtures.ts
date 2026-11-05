import type { Ingredient, Product, Recipe, RecipeItem } from '@/lib/calc';
import { DEFAULT_SETTINGS } from '@/lib/calc';

export const ing = (id: string, packageQuantity: number | null, packagePrice: number | null, packageUnit: Ingredient['packageUnit'] = 'g'): Ingredient => ({
  id, name: id, category: 'test', brand: null, supplier: null, packageQuantity, packageUnit, packagePrice, priceUpdatedAt: null, note: null, isActive: true,
});

let n = 0;
export const item = (ref: string, quantity: number, unit: RecipeItem['unit'] = 'g', sub = false): RecipeItem => ({
  id: `it${++n}`, ingredientId: sub ? null : ref, subRecipeId: sub ? ref : null, quantity, unit,
});

export const recipe = (id: string, yieldQuantity: number | null, yieldUnit: Recipe['yieldUnit'], items: RecipeItem[], isSubrecipe = false): Recipe => ({
  id, name: id, description: null, notes: null, yieldQuantity, yieldUnit, status: 'active', isSubrecipe, isVerified: true, items,
});

export const product = (id: string, recipeId: string | null, salesUnit: Product['salesUnit'], wholesalePrice: number, extra: Partial<Product> = {}): Product => ({
  id, recipeId, name: id, category: 'test', salesUnit, pieceWeight: null, wholesalePrice, retailPrice: null, retailPortions: 1, targetMarginPct: null, isActive: true, notes: null, sortOrder: 0, ...extra,
});

export const settings = (extra: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...extra });
