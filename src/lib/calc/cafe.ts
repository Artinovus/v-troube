import type { CostSettings, Product } from './types';

export interface CafeRow {
  /** cena, kterou kavárna platí pekárně za 1 dodanou jednotku (u hmotnosti 100 g) */
  purchasePrice: number;
  /** maloobchodní cena za porci tak, jak je zadána */
  retailPrice: number | null;
  /** maloobchodní cena za porci použitá pro srovnání (bez DPH, pokud je DPH zapnuté) */
  retailPriceCompared: number | null;
  portionsPerUnit: number;
  deliveredUnits: number;
  portionsSold: number;
  /** tržba kavárny (základ srovnání viz basis) */
  cafeRevenue: number | null;
  /** náklady kavárny na nákup pečiva */
  cafePurchaseCost: number;
  /** hrubý rozdíl v Kč (před dalšími náklady kavárny) */
  grossDifference: number | null;
  /** hrubá marže v % z tržby kavárny */
  grossMarginPct: number | null;
  /** hrubý rozdíl na 1 dodanou jednotku */
  grossPerUnit: number | null;
  basis: 'zadané ceny (bez výpočtu DPH)' | 'ceny bez DPH';
}

/** Pro hmotnostní prodej se počítá s jednotkou 100 g (1 porce = 100 g). */
export function portionsPerDeliveredUnit(p: Pick<Product, 'salesUnit' | 'retailPortions'>): number {
  if (p.salesUnit === 'weight') return 1;
  return p.retailPortions > 0 ? p.retailPortions : 1;
}

/**
 * Hrubý rozdíl kavárny = tržba kavárny − nákup pečiva.
 * Při zapnutém DPH se maloobchodní cena (zadaná s DPH) převede na cenu bez DPH,
 * protože marže se porovnávají na cenách bez DPH. Velkoobchodní ceny jsou vždy bez DPH.
 */
export function cafeProfit(
  product: Pick<Product, 'salesUnit' | 'retailPortions' | 'retailPrice' | 'wholesalePrice'>,
  settings: Pick<CostSettings, 'vatEnabled' | 'vatRatePct'>,
  deliveredUnits: number,
  portionsSold?: number,
): CafeRow {
  const portionsPerUnit = portionsPerDeliveredUnit(product);
  const delivered = Number.isFinite(deliveredUnits) && deliveredUnits > 0 ? deliveredUnits : 0;
  const maxPortions = delivered * portionsPerUnit;
  const sold =
    portionsSold != null && Number.isFinite(portionsSold) && portionsSold >= 0 ? portionsSold : maxPortions;
  const retail = product.retailPrice;
  const compared =
    retail == null ? null : settings.vatEnabled ? retail / (1 + (settings.vatRatePct || 0) / 100) : retail;
  const purchase = delivered * product.wholesalePrice;
  const revenue = compared == null ? null : sold * compared;
  const gross = revenue == null ? null : revenue - purchase;
  const perUnitRevenue = compared == null ? null : portionsPerUnit * compared;
  return {
    purchasePrice: product.wholesalePrice,
    retailPrice: retail,
    retailPriceCompared: compared,
    portionsPerUnit,
    deliveredUnits: delivered,
    portionsSold: sold,
    cafeRevenue: revenue,
    cafePurchaseCost: purchase,
    grossDifference: gross,
    grossMarginPct: revenue && revenue > 0 && gross != null ? (gross / revenue) * 100 : null,
    grossPerUnit: perUnitRevenue == null ? null : perUnitRevenue - product.wholesalePrice,
    basis: settings.vatEnabled ? 'ceny bez DPH' : 'zadané ceny (bez výpočtu DPH)',
  };
}
