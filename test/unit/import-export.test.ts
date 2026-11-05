import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLegacy, buildLegacyPlan, isLegacyFormat } from '@/lib/backup/legacy';
import { parseBackup, checkBackupIntegrity, BACKUP_FORMAT } from '@/lib/backup/schema';
import { toCsv } from '@/lib/backup/csv';
import { parseCzNumber, formatCzk, toInputValue } from '@/lib/format';
import { buildCalculationCsv, buildProductsCsv } from '@/lib/backup/exports';
import { DEFAULT_SETTINGS } from '@/lib/calc';
import { ing, item, recipe, product } from './fixtures';

const legacy = JSON.parse(readFileSync('test/fixtures/z-trouby-zaloha.json', 'utf8'));

describe('import staré kalkulačky', () => {
  it('rozpozná formát a převede jednotky', () => {
    expect(isLegacyFormat(legacy)).toBe(true);
    expect(isLegacyFormat({ format: BACKUP_FORMAT, products: [] })).toBe(false);
    const p = parseLegacy(legacy);
    expect(p.products).toHaveLength(2);
    const mouka = p.ingredients.find((i) => i.name === 'Hladká mouka')!;
    // "hladká mouka" a "Hladká mouka" jsou stejná surovina; 1 kg → 1000 g
    expect(mouka.variants.map((v) => [v.size, v.price])).toEqual([[1000, 22], [1000, 25]]);
    expect(mouka.ambiguous).toBe(true);
    expect(p.products[1].lines[0]).toMatchObject({ used: 0.25, unit: 'kg' });
    expect(p.ingredients.find((i) => i.name === 'Banány')!.variants[0].price).toBeCloseTo(39.9);
    expect(p.settings).toMatchObject({ bakingDaysPerMonth: 8, hoursPerBakingDay: 7, hourlyLaborCost: 200, monthlyEnergyCost: 1000, packagingCostPerBakingDay: 120, deliveryCostPerBakingDay: 150, otherMonthlyCosts: 0 });
    expect(p.products[1].suggestedSalesUnit).toBe('whole');
  });
  it('nejednoznačnosti a shody vyžadují rozhodnutí; nic se nepřepíše bez něj', () => {
    const p = parseLegacy(legacy);
    const existing = [{ id: '00000000-0000-4000-8000-000000000001', name: 'máslo', packageUnit: 'g' as const, packageQuantity: 250, packagePrice: 70 }];
    const plan = buildLegacyPlan(p, { variant: {}, existingIngredient: {}, existingProduct: {}, salesUnit: {}, importSettings: false }, existing, ['Banánový chlebíček']);
    expect(plan.unresolved).toHaveLength(3);
    const ok = buildLegacyPlan(p, { variant: { 'hladká mouka|g': 1 }, existingIngredient: { 'máslo|g': 'use' }, existingProduct: { 'Banánový chlebíček': 'new' }, salesUnit: {}, importSettings: false }, existing, ['Banánový chlebíček']);
    expect(ok.unresolved).toEqual([]);
    expect(ok.ingredientsToUpdate).toEqual([]);
    expect(ok.ingredientIdByKey['máslo|g']).toBe(existing[0].id);
    expect(ok.ingredientsToCreate.find((i) => i.name === 'Hladká mouka')!.price).toBe(25);
    expect(ok.products.map((x) => x.finalName)).toEqual(['Linecké cukroví', 'Banánový chlebíček (import)']);
    expect(ok.settings).toBeNull();
  });
  it('neplatný soubor', () => {
    expect(() => parseLegacy({ foo: 1 })).toThrow();
    const p = parseLegacy({ products: [null, { name: 'X', ingredients: [{ name: 'Y', used: 1, unit: 'hrnek' }] }] });
    expect(p.warnings.length).toBe(2);
  });
});

describe('záloha', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const base = {
    format: BACKUP_FORMAT, version: 1, exportedAt: '2026-11-05T10:00:00Z',
    data: {
      ingredients: [{ id: id(1), name: 'Máslo', category: 'tuky', brand: null, supplier: null, package_quantity: 250, package_unit: 'g', package_price: 65, price_updated_at: null, note: null, is_active: true }],
      ingredient_price_history: [], recipes: [{ id: id(2), name: 'R', description: null, notes: null, yield_quantity: 1, yield_unit: 'ks', status: 'active', is_subrecipe: false, is_verified: false }],
      recipe_ingredients: [{ id: id(3), recipe_id: id(2), ingredient_id: id(1), sub_recipe_id: null, quantity_used: 10, unit: 'g', sort_order: 0, note: null }],
      products: [], product_price_history: [], cost_settings: null, plan_items: [], production_scenarios: [], production_scenario_items: [],
    },
  };
  it('platná záloha projde', () => expect(parseBackup(base).ok).toBe(true));
  it('odhalí porušenou integritu', () => {
    const bad = structuredClone(base);
    bad.data.recipe_ingredients[0].ingredient_id = id(99);
    const r = parseBackup(bad);
    expect(r.ok).toBe(false);
    expect(checkBackupIntegrity(bad.data as never).length).toBe(1);
  });
  it('odmítne záporné ceny', () => {
    const bad = structuredClone(base);
    bad.data.ingredients[0].package_price = -1;
    expect(parseBackup(bad).ok).toBe(false);
  });
});

describe('CSV a formátování', () => {
  it('český formát, escapování a ochrana proti vzorcům', () => {
    const csv = toCsv(['a', 'b'], [[1.5, 'x;y'], ['=SUM(A1)', true]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('1,5;"x;y"');
    expect(csv).toContain("'=SUM(A1);ano");
  });
  it('exporty ceníku a kalkulace', () => {
    const ws = { ingredients: [ing('m', 1000, 40)], recipes: [recipe('r', 8, 'ks', [item('m', 800)])], products: [product('p', 'r', 'piece', 45)], settings: DEFAULT_SETTINGS, plan: { p: 15 } };
    expect(buildProductsCsv(ws)).toContain('p;test;ks;r;;45;;1;4;41;91,1111');
    const calc = buildCalculationCsv(ws);
    expect(calc).toContain('Měsíční tržby;5400');
  });
  it('parsování českých čísel', () => {
    expect(parseCzNumber('29,38')).toBe(29.38);
    expect(parseCzNumber('1 040')).toBe(1040);
    expect(parseCzNumber('1 040,5 Kč')).toBe(1040.5);
    expect(parseCzNumber('')).toBeNull();
    expect(parseCzNumber('abc')).toBeNaN();
    expect(toInputValue(29.38)).toBe('29,38');
    expect(formatCzk(1040)).toMatch(/1\s040,00\sKč/);
  });
});
