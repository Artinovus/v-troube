import type { Product, Recipe } from './types';
import type { RecipeCost } from './recipe';

/**
 * Marže (z prodejní ceny): (cena − náklad) / cena × 100.
 * Přirážka (z nákladu):    (cena − náklad) / náklad × 100.
 */
export function marginPct(price: number, cost: number): number | null {
  if (!(price > 0) || !Number.isFinite(cost)) return null;
  return ((price - cost) / price) * 100;
}

export function markupPct(price: number, cost: number): number | null {
  if (!(cost > 0) || !Number.isFinite(price)) return null;
  return ((price - cost) / cost) * 100;
}

/** Minimální cena pro dosažení požadované marže: náklad / (1 − marže). */
export function priceForMargin(cost: number, targetMarginPct: number): number | null {
  if (!Number.isFinite(cost) || cost < 0) return null;
  if (!(targetMarginPct >= 0) || targetMarginPct >= 100) return null;
  return cost / (1 - targetMarginPct / 100);
}

/** Cena pro dosažení požadované přirážky: náklad × (1 + přirážka). */
export function priceForMarkup(cost: number, targetMarkupPct: number): number | null {
  if (!Number.isFinite(cost) || cost < 0 || !(targetMarkupPct >= -100)) return null;
  return cost * (1 + targetMarkupPct / 100);
}

/** Popisek prodejní jednotky. U hmotnostního prodeje je jednotka 100 g. */
export function salesUnitLabel(p: Pick<Product, 'salesUnit'>): string {
  switch (p.salesUnit) {
    case 'piece':
      return 'ks';
    case 'whole':
      return 'celý výrobek';
    case 'weight':
      return '100 g';
  }
}

/** Popisek množství v plánu (u hmotnostního prodeje gramy). */
export function planUnitLabel(p: Pick<Product, 'salesUnit'>): string {
  return p.salesUnit === 'weight' ? 'g' : p.salesUnit === 'whole' ? 'ks (celých)' : 'ks';
}

export interface ProductCost {
  /** kolik jednotek výtěžnosti receptury připadá na 1 prodejní jednotku */
  recipeUnitsPerSale: number | null;
  /** surovinový náklad na 1 prodejní jednotku (teoretický, poměrný) */
  unitCost: number | null;
  complete: boolean;
  issue?: string;
}

/**
 * Převod mezi recepturou a prodejní jednotkou:
 * - hmotnostní prodej: receptura musí mít výtěžnost v g, prodejní jednotka = 100 g,
 * - kus / celý výrobek s recepturou v ks: 1 kus receptury = 1 prodejní jednotka,
 * - kus s recepturou v g/ml: použije se gramáž jednoho kusu.
 */
export function productCost(
  product: Pick<Product, 'salesUnit' | 'pieceWeight' | 'recipeId'>,
  recipe: Recipe | undefined,
  recipeCost: RecipeCost | undefined,
): ProductCost {
  if (!product.recipeId || !recipe || !recipeCost)
    return { recipeUnitsPerSale: null, unitCost: null, complete: false, issue: 'Výrobek nemá navázanou recepturu.' };
  let perSale: number | null = null;
  let issue: string | undefined;
  if (product.salesUnit === 'weight') {
    if (recipe.yieldUnit === 'g') perSale = 100;
    else issue = 'Pro hmotnostní prodej musí mít receptura výtěžnost v gramech.';
  } else if (recipe.yieldUnit === 'ks') {
    perSale = 1;
  } else if (product.pieceWeight && product.pieceWeight > 0) {
    perSale = product.pieceWeight;
  } else {
    issue = 'Receptura má výtěžnost v gramech – vyplňte gramáž jednoho kusu.';
  }
  const unitCost = perSale != null && recipeCost.unitCost != null ? recipeCost.unitCost * perSale : null;
  if (!issue && recipeCost.unitCost == null) issue = recipeCost.issues[0] ?? 'Náklad receptury nelze spočítat.';
  else if (!issue && !recipeCost.complete) issue = 'Náklad je neúplný: ' + (recipeCost.issues[0] ?? '');
  return { recipeUnitsPerSale: perSale, unitCost, complete: unitCost != null && recipeCost.complete, issue };
}

/** Převede množství z plánu na počet prodejních jednotek (gramy → počet 100 g). */
export function planQtyToSalesUnits(p: Pick<Product, 'salesUnit'>, qty: number): number {
  if (!Number.isFinite(qty) || qty < 0) return 0;
  return p.salesUnit === 'weight' ? qty / 100 : qty;
}
