/**
 * Import zálohy ze staré HTML kalkulačky (z-trouby-zaloha.json).
 *
 * Očekávaný (tolerantně čtený) tvar:
 * {
 *   products: [{ name, qty, wholesale, cafePrice, cafePortions, yield,
 *                ingredients: [{ name, used, unit, size, price }] }],
 *   days, hours, hourly, fixed, packing, delivery, other
 * }
 * Nastavení může být i ve vnořeném objektu "settings".
 */
import type { PackageUnit, SalesUnit, UsageUnit } from '@/lib/calc';

export interface LegacyIngredientVariant {
  size: number | null;
  unit: PackageUnit;
  price: number | null;
  /** výrobky, kde se varianta vyskytla */
  usedIn: string[];
}

export interface LegacyIngredient {
  key: string;
  name: string;
  unit: PackageUnit;
  variants: LegacyIngredientVariant[];
  /** true, pokud se varianty liší velikostí balení nebo cenou – vyžaduje potvrzení */
  ambiguous: boolean;
}

export interface LegacyProduct {
  name: string;
  qty: number;
  wholesale: number;
  cafePrice: number | null;
  cafePortions: number;
  yield: number | null;
  suggestedSalesUnit: SalesUnit;
  lines: { ingredientKey: string; used: number; unit: UsageUnit }[];
}

export interface LegacySettings {
  bakingDaysPerMonth?: number;
  hoursPerBakingDay?: number;
  hourlyLaborCost?: number;
  monthlyEnergyCost?: number;
  packagingCostPerBakingDay?: number;
  deliveryCostPerBakingDay?: number;
  otherMonthlyCosts?: number;
}

export interface LegacyParseResult {
  ingredients: LegacyIngredient[];
  products: LegacyProduct[];
  settings: LegacySettings;
  warnings: string[];
}

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.replace(/kč/i, '').replace(/[\s ]/g, '').replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const normalizeName = (s: string) =>
  s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('cs-CZ');

function normalizeUnit(u: unknown): { pkg: PackageUnit; usage: UsageUnit; factor: number } | null {
  const s = typeof u === 'string' ? u.trim().toLowerCase().replace('.', '') : 'g';
  switch (s) {
    case '':
    case 'g':
    case 'gram':
    case 'gramy':
      return { pkg: 'g', usage: 'g', factor: 1 };
    case 'kg':
      return { pkg: 'g', usage: 'kg', factor: 1000 };
    case 'ml':
      return { pkg: 'ml', usage: 'ml', factor: 1 };
    case 'l':
      return { pkg: 'ml', usage: 'l', factor: 1000 };
    case 'ks':
    case 'kus':
    case 'kusy':
    case 'pcs':
      return { pkg: 'ks', usage: 'ks', factor: 1 };
    default:
      return null;
  }
}

export function isLegacyFormat(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const o = json as Record<string, unknown>;
  return Array.isArray(o.products) && !('format' in o);
}

export function parseLegacy(json: unknown): LegacyParseResult {
  if (!isLegacyFormat(json)) throw new Error('Soubor nevypadá jako záloha staré kalkulačky (chybí pole products).');
  const o = json as Record<string, unknown>;
  const s = (o.settings && typeof o.settings === 'object' ? o.settings : o) as Record<string, unknown>;
  const warnings: string[] = [];
  const ingMap = new Map<string, LegacyIngredient>();
  const products: LegacyProduct[] = [];

  (o.products as unknown[]).forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Výrobek č. ${idx + 1} má neplatný formát a byl přeskočen.`);
      return;
    }
    const p = raw as Record<string, unknown>;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Výrobek ${idx + 1}`;
    const lines: LegacyProduct['lines'] = [];
    const ings = Array.isArray(p.ingredients) ? p.ingredients : [];
    ings.forEach((ri: unknown, j: number) => {
      if (!ri || typeof ri !== 'object') return;
      const r = ri as Record<string, unknown>;
      const iname = typeof r.name === 'string' ? r.name.trim() : '';
      if (!iname) {
        warnings.push(`${name}: surovina č. ${j + 1} nemá název a byla přeskočena.`);
        return;
      }
      const unit = normalizeUnit(r.unit);
      if (!unit) {
        warnings.push(`${name}: surovina „${iname}“ má neznámou jednotku „${String(r.unit)}“ a byla přeskočena.`);
        return;
      }
      const used = toNum(r.used);
      const sizeRaw = toNum(r.size);
      const size = sizeRaw != null && sizeRaw > 0 ? sizeRaw * unit.factor : null;
      const price = toNum(r.price);
      const key = `${normalizeName(iname)}|${unit.pkg}`;
      let entry = ingMap.get(key);
      if (!entry) {
        entry = { key, name: iname, unit: unit.pkg, variants: [], ambiguous: false };
        ingMap.set(key, entry);
      }
      let variant = entry.variants.find((v) => v.size === size && v.price === price);
      if (!variant) {
        variant = { size, unit: unit.pkg, price: price != null && price >= 0 ? price : null, usedIn: [] };
        entry.variants.push(variant);
      }
      if (!variant.usedIn.includes(name)) variant.usedIn.push(name);
      if (used != null && used > 0) lines.push({ ingredientKey: key, used, unit: unit.usage });
      else warnings.push(`${name}: surovina „${iname}“ nemá platné použité množství a do receptury nebyla přidána.`);
    });

    const portions = toNum(p.cafePortions);
    const y = toNum(p.yield);
    const lname = normalizeName(name);
    const suggestedSalesUnit: SalesUnit = /perní[čc]k/.test(lname) ? 'weight' : portions != null && portions > 1 ? 'whole' : 'piece';
    products.push({
      name,
      qty: Math.max(0, toNum(p.qty) ?? 0),
      wholesale: Math.max(0, toNum(p.wholesale) ?? 0),
      cafePrice: toNum(p.cafePrice),
      cafePortions: portions != null && portions > 0 ? portions : 1,
      yield: y != null && y > 0 ? y : null,
      suggestedSalesUnit,
      lines,
    });
  });

  const ingredients = [...ingMap.values()].map((i) => ({ ...i, ambiguous: i.variants.length > 1 }));
  const settings: LegacySettings = {};
  const map: [keyof LegacySettings, string][] = [
    ['bakingDaysPerMonth', 'days'],
    ['hoursPerBakingDay', 'hours'],
    ['hourlyLaborCost', 'hourly'],
    ['monthlyEnergyCost', 'fixed'],
    ['packagingCostPerBakingDay', 'packing'],
    ['deliveryCostPerBakingDay', 'delivery'],
    ['otherMonthlyCosts', 'other'],
  ];
  for (const [k, legacyKey] of map) {
    const v = toNum(s[legacyKey]);
    if (v != null && v >= 0) settings[k] = v;
  }
  return { ingredients, products, settings, warnings };
}

// ---------------------------------------------------------------------------
// Rozhodnutí uživatelky a výsledný plán importu
// ---------------------------------------------------------------------------

export interface ExistingIngredientRef {
  id: string;
  name: string;
  packageUnit: PackageUnit;
  packageQuantity: number | null;
  packagePrice: number | null;
}

export interface LegacyDecisions {
  /** index zvolené varianty pro nejednoznačné suroviny (klíč suroviny → index) */
  variant: Record<string, number>;
  /** surovina se shodným názvem už existuje: použít stávající / aktualizovat cenu / vytvořit novou */
  existingIngredient: Record<string, 'use' | 'update' | 'new'>;
  /** výrobek se shodným názvem existuje: přeskočit / vytvořit nový */
  existingProduct: Record<string, 'skip' | 'new'>;
  salesUnit: Record<string, SalesUnit>;
  importSettings: boolean;
}

export interface LegacyImportPlan {
  ingredientsToCreate: { tempKey: string; name: string; unit: PackageUnit; size: number | null; price: number | null }[];
  ingredientsToUpdate: { id: string; size: number | null; price: number | null }[];
  /** klíč suroviny → existující id (pro "use"/"update") */
  ingredientIdByKey: Record<string, string>;
  products: (LegacyProduct & { salesUnit: SalesUnit; finalName: string })[];
  settings: LegacySettings | null;
  unresolved: string[];
}

export function findExistingIngredient(
  ing: LegacyIngredient,
  existing: ExistingIngredientRef[],
): ExistingIngredientRef | undefined {
  return existing.find((e) => normalizeName(e.name) === normalizeName(ing.name) && e.packageUnit === ing.unit);
}

/**
 * Sestaví plán importu. Nejednoznačné ceny a shody s existujícími daty musí mít
 * rozhodnutí – jinak jsou vráceny v `unresolved` a import nelze provést.
 */
export function buildLegacyPlan(
  parsed: LegacyParseResult,
  decisions: LegacyDecisions,
  existingIngredients: ExistingIngredientRef[],
  existingProductNames: string[],
): LegacyImportPlan {
  const unresolved: string[] = [];
  const plan: LegacyImportPlan = {
    ingredientsToCreate: [],
    ingredientsToUpdate: [],
    ingredientIdByKey: {},
    products: [],
    settings: decisions.importSettings ? parsed.settings : null,
    unresolved,
  };
  for (const ing of parsed.ingredients) {
    let variant = ing.variants[0];
    if (ing.ambiguous) {
      const idx = decisions.variant[ing.key];
      if (idx == null || !ing.variants[idx]) {
        unresolved.push(`Zvolte cenu a balení pro surovinu „${ing.name}“.`);
        continue;
      }
      variant = ing.variants[idx];
    }
    const ex = findExistingIngredient(ing, existingIngredients);
    if (ex) {
      const d = decisions.existingIngredient[ing.key];
      if (!d) {
        unresolved.push(`Surovina „${ing.name}“ už existuje – zvolte, zda použít stávající, aktualizovat cenu, nebo vytvořit novou.`);
        continue;
      }
      if (d === 'use' || d === 'update') {
        plan.ingredientIdByKey[ing.key] = ex.id;
        if (d === 'update') plan.ingredientsToUpdate.push({ id: ex.id, size: variant.size, price: variant.price });
        continue;
      }
      plan.ingredientsToCreate.push({ tempKey: ing.key, name: `${ing.name} (import)`, unit: ing.unit, size: variant.size, price: variant.price });
      continue;
    }
    plan.ingredientsToCreate.push({ tempKey: ing.key, name: ing.name, unit: ing.unit, size: variant.size, price: variant.price });
  }
  const existingNames = new Set(existingProductNames.map(normalizeName));
  for (const p of parsed.products) {
    let finalName = p.name;
    if (existingNames.has(normalizeName(p.name))) {
      const d = decisions.existingProduct[p.name];
      if (!d) {
        unresolved.push(`Výrobek „${p.name}“ už existuje – zvolte, zda ho přeskočit, nebo vytvořit nový.`);
        continue;
      }
      if (d === 'skip') continue;
      finalName = `${p.name} (import)`;
    }
    plan.products.push({ ...p, finalName, salesUnit: decisions.salesUnit[p.name] ?? p.suggestedSalesUnit });
  }
  return plan;
}
