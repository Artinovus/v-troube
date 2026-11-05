import { z } from 'zod';

const optText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null));
const name = z.string().trim().min(1, 'Vyplňte název.').max(200, 'Název je příliš dlouhý.');
const money = z.number({ error: 'Zadejte číslo.' }).finite().min(0, 'Částka nesmí být záporná.').max(10_000_000);
const positive = z.number({ error: 'Zadejte číslo.' }).finite().positive('Hodnota musí být větší než 0.').max(10_000_000);
const nonNeg = z.number({ error: 'Zadejte číslo.' }).finite().min(0, 'Hodnota nesmí být záporná.').max(10_000_000);
const uuid = z.uuid();

export const ingredientSchema = z.object({
  id: uuid.optional(),
  name,
  category: z.string().trim().min(1).max(100).default('ostatní'),
  brand: optText,
  supplier: optText,
  packageQuantity: positive.nullable(),
  packageUnit: z.enum(['g', 'ml', 'ks']),
  packagePrice: money.nullable(),
  priceUpdatedAt: z.iso.date().nullish().transform((v) => v ?? null),
  note: optText,
  isActive: z.boolean().default(true),
});
export type IngredientInput = z.infer<typeof ingredientSchema>;

export const recipeItemSchema = z
  .object({
    id: uuid.optional(),
    ingredientId: uuid.nullable(),
    subRecipeId: uuid.nullable(),
    quantity: positive,
    unit: z.enum(['g', 'kg', 'ml', 'l', 'ks']),
    note: optText,
  })
  .refine((v) => (v.ingredientId ? 1 : 0) + (v.subRecipeId ? 1 : 0) === 1, 'Každý řádek musí mít surovinu nebo polotovar.');

export const recipeSchema = z.object({
  id: uuid.optional(),
  name,
  description: optText,
  notes: optText,
  yieldQuantity: positive.nullable(),
  yieldUnit: z.enum(['ks', 'g', 'ml']),
  status: z.enum(['draft', 'active', 'archived']),
  isSubrecipe: z.boolean(),
  isVerified: z.boolean(),
  items: z.array(recipeItemSchema).max(200),
});
export type RecipeInput = z.infer<typeof recipeSchema>;

export const productSchema = z.object({
  id: uuid.optional(),
  recipeId: uuid.nullable(),
  name,
  category: z.string().trim().min(1).max(100).default('ostatní'),
  salesUnit: z.enum(['piece', 'whole', 'weight']),
  pieceWeight: positive.nullable(),
  wholesalePrice: money,
  retailPrice: money.nullable(),
  retailPortions: positive,
  targetMarginPct: z.number().finite().min(0).lt(100, 'Marže musí být menší než 100 %.').nullable(),
  isActive: z.boolean(),
  notes: optText,
});
export type ProductInput = z.infer<typeof productSchema>;

export const productPriceSchema = z.object({
  id: uuid,
  wholesalePrice: money.optional(),
  retailPrice: money.nullable().optional(),
  retailPortions: positive.optional(),
});

export const settingsSchema = z.object({
  bakingDaysPerMonth: nonNeg.max(31, 'Měsíc má nejvýše 31 dní.'),
  hoursPerBakingDay: nonNeg.max(24, 'Den má 24 hodin.'),
  hourlyLaborCost: money,
  monthlyEnergyCost: money,
  packagingCostPerBakingDay: money,
  deliveryCostPerBakingDay: money,
  otherMonthlyCosts: money,
  defaultTargetMarginPct: z.number().finite().min(0).lt(100),
  vatEnabled: z.boolean(),
  vatRatePct: z.number().finite().min(0).lt(100),
});

export const planSchema = z.array(z.object({ productId: uuid, quantity: nonNeg })).max(500);

export const scenarioSchema = z.object({
  name,
  note: optText,
  priceOverrides: z.record(z.string(), money.nullable()),
});

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export function zodMessage(e: z.ZodError): string {
  const first = e.issues[0];
  return first ? first.message : 'Neplatná data.';
}
