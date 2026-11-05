import { z } from 'zod';

export const BACKUP_FORMAT = 'z-trouby-zaloha';
export const BACKUP_VERSION = 1;

const num = z.number().finite();
const nnum = num.nullable();
const text = z.string().nullable();
const uuid = z.uuid();
const ts = z.string().min(1);

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: ts,
  data: z.object({
    ingredients: z.array(
      z.object({
        id: uuid,
        name: z.string().min(1),
        category: z.string(),
        brand: text,
        supplier: text,
        package_quantity: nnum.refine((v) => v == null || v > 0),
        package_unit: z.enum(['g', 'ml', 'ks']),
        package_price: nnum.refine((v) => v == null || v >= 0),
        price_updated_at: text,
        note: text,
        is_active: z.boolean(),
      }),
    ),
    ingredient_price_history: z.array(
      z.object({
        id: uuid,
        ingredient_id: uuid,
        old_price: nnum,
        new_price: nnum,
        old_package_quantity: nnum,
        package_quantity: nnum,
        package_unit: text,
        changed_at: ts,
      }),
    ),
    recipes: z.array(
      z.object({
        id: uuid,
        name: z.string().min(1),
        description: text,
        notes: text,
        yield_quantity: nnum.refine((v) => v == null || v > 0),
        yield_unit: z.enum(['ks', 'g', 'ml']),
        status: z.enum(['draft', 'active', 'archived']),
        is_subrecipe: z.boolean(),
        is_verified: z.boolean(),
      }),
    ),
    recipe_ingredients: z.array(
      z.object({
        id: uuid,
        recipe_id: uuid,
        ingredient_id: uuid.nullable(),
        sub_recipe_id: uuid.nullable(),
        quantity_used: num.positive(),
        unit: z.enum(['g', 'kg', 'ml', 'l', 'ks']),
        sort_order: z.number().int(),
        note: text,
      }),
    ),
    products: z.array(
      z.object({
        id: uuid,
        recipe_id: uuid.nullable(),
        name: z.string().min(1),
        category: z.string(),
        sales_unit: z.enum(['piece', 'whole', 'weight']),
        piece_weight: nnum,
        wholesale_price: num.min(0),
        retail_price: nnum,
        retail_portions: num.positive(),
        target_margin_pct: nnum,
        is_active: z.boolean(),
        notes: text,
        sort_order: z.number().int(),
      }),
    ),
    product_price_history: z.array(
      z.object({
        id: uuid,
        product_id: uuid,
        old_wholesale_price: nnum,
        wholesale_price: nnum,
        old_retail_price: nnum,
        retail_price: nnum,
        changed_at: ts,
      }),
    ),
    cost_settings: z
      .object({
        baking_days_per_month: num.min(0),
        hours_per_baking_day: num.min(0),
        hourly_labor_cost: num.min(0),
        monthly_energy_cost: num.min(0),
        packaging_cost_per_baking_day: num.min(0),
        delivery_cost_per_baking_day: num.min(0),
        other_monthly_costs: num.min(0),
        default_target_margin_pct: num.min(0).lt(100),
        vat_enabled: z.boolean(),
        vat_rate_pct: num.min(0).lt(100),
      })
      .nullable(),
    plan_items: z.array(z.object({ product_id: uuid, quantity_per_baking_day: num.min(0) })),
    production_scenarios: z.array(
      z.object({
        id: uuid,
        name: z.string().min(1),
        note: text,
        settings_snapshot: z.unknown(),
        results_snapshot: z.unknown().nullable(),
        created_at: ts,
        applied_at: text,
      }),
    ),
    production_scenario_items: z.array(
      z.object({
        id: uuid,
        scenario_id: uuid,
        product_id: uuid.nullable(),
        product_name: z.string(),
        sales_unit: z.string(),
        quantity_per_baking_day: num,
        wholesale_price: nnum,
        price_override: nnum,
        unit_cost: nnum,
      }),
    ),
  }),
});

export type Backup = z.infer<typeof backupSchema>;
export type BackupData = Backup['data'];

/** Kontrola referenční integrity zálohy (nad rámec tvaru dat). */
export function checkBackupIntegrity(d: BackupData): string[] {
  const errors: string[] = [];
  const ing = new Set(d.ingredients.map((i) => i.id));
  const rec = new Set(d.recipes.map((r) => r.id));
  const prod = new Set(d.products.map((p) => p.id));
  const scen = new Set(d.production_scenarios.map((s) => s.id));
  for (const it of d.recipe_ingredients) {
    if (!rec.has(it.recipe_id)) errors.push(`Řádek receptury odkazuje na neexistující recepturu ${it.recipe_id}.`);
    if ((it.ingredient_id ? 1 : 0) + (it.sub_recipe_id ? 1 : 0) !== 1) errors.push('Řádek receptury musí mít surovinu nebo polotovar.');
    if (it.ingredient_id && !ing.has(it.ingredient_id)) errors.push(`Řádek receptury odkazuje na neexistující surovinu ${it.ingredient_id}.`);
    if (it.sub_recipe_id && !rec.has(it.sub_recipe_id)) errors.push(`Řádek receptury odkazuje na neexistující polotovar ${it.sub_recipe_id}.`);
  }
  for (const p of d.products) if (p.recipe_id && !rec.has(p.recipe_id)) errors.push(`Výrobek ${p.name} odkazuje na neexistující recepturu.`);
  for (const h of d.ingredient_price_history) if (!ing.has(h.ingredient_id)) errors.push('Historie cen odkazuje na neexistující surovinu.');
  for (const h of d.product_price_history) if (!prod.has(h.product_id)) errors.push('Historie cen odkazuje na neexistující výrobek.');
  for (const p of d.plan_items) if (!prod.has(p.product_id)) errors.push('Plán odkazuje na neexistující výrobek.');
  for (const s of d.production_scenario_items) {
    if (!scen.has(s.scenario_id)) errors.push('Položka scénáře odkazuje na neexistující scénář.');
  }
  const ids = [...d.ingredients, ...d.recipes, ...d.products].map((x) => x.id);
  if (new Set(ids).size !== ids.length) errors.push('Záloha obsahuje duplicitní identifikátory.');
  return [...new Set(errors)].slice(0, 20);
}

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; errors: string[] };

export function parseBackup(json: unknown): ParsedBackup {
  const r = backupSchema.safeParse(json);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'soubor'}: ${i.message}`),
    };
  }
  const integrity = checkBackupIntegrity(r.data.data);
  if (integrity.length) return { ok: false, errors: integrity };
  return { ok: true, backup: r.data };
}
