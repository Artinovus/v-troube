export type PackageUnit = 'g' | 'ml' | 'ks';
export type UsageUnit = 'g' | 'kg' | 'ml' | 'l' | 'ks';
export type YieldUnit = 'ks' | 'g' | 'ml';
export type SalesUnit = 'piece' | 'whole' | 'weight';
export type RecipeStatus = 'draft' | 'active' | 'archived';

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  supplier: string | null;
  packageQuantity: number | null;
  packageUnit: PackageUnit;
  packagePrice: number | null;
  priceUpdatedAt: string | null;
  note: string | null;
  isActive: boolean;
}

export interface RecipeItem {
  id: string;
  ingredientId: string | null;
  subRecipeId: string | null;
  quantity: number;
  unit: UsageUnit;
  note?: string | null;
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  yieldQuantity: number | null;
  yieldUnit: YieldUnit;
  status: RecipeStatus;
  isSubrecipe: boolean;
  isVerified: boolean;
  items: RecipeItem[];
}

export interface Product {
  id: string;
  recipeId: string | null;
  name: string;
  category: string;
  salesUnit: SalesUnit;
  /** gramáž jednoho kusu v g */
  pieceWeight: number | null;
  /** cena kavárně za prodejní jednotku (u hmotnostního prodeje za 100 g) */
  wholesalePrice: number;
  /** maloobchodní cena kavárny za porci (u hmotnostního prodeje za 100 g) */
  retailPrice: number | null;
  retailPortions: number;
  targetMarginPct: number | null;
  isActive: boolean;
  notes: string | null;
  sortOrder: number;
}

export interface CostSettings {
  bakingDaysPerMonth: number;
  hoursPerBakingDay: number;
  hourlyLaborCost: number;
  monthlyEnergyCost: number;
  packagingCostPerBakingDay: number;
  deliveryCostPerBakingDay: number;
  otherMonthlyCosts: number;
  defaultTargetMarginPct: number;
  vatEnabled: boolean;
  vatRatePct: number;
}

export const DEFAULT_SETTINGS: CostSettings = {
  bakingDaysPerMonth: 8,
  hoursPerBakingDay: 7,
  hourlyLaborCost: 200,
  monthlyEnergyCost: 1000,
  packagingCostPerBakingDay: 0,
  deliveryCostPerBakingDay: 0,
  otherMonthlyCosts: 0,
  defaultTargetMarginPct: 60,
  vatEnabled: false,
  vatRatePct: 12,
};

/** Množství při jednom pečení; u hmotnostního prodeje v gramech. */
export type PlanQuantities = Record<string, number>;
