import { describe, it, expect } from 'vitest';
import {
  ingredientCost, computeAllRecipeCosts, productCost, computePlan, marginPct, markupPct,
  priceForMargin, priceForMarkup, cafeProfit, ingredientChangeImpact, wouldCreateCycle, convertQuantity,
} from '@/lib/calc';
import { ing, item, recipe, product, settings } from './fixtures';

describe('1. náklad suroviny z ceny balení', () => {
  it('máslo 113 g z balení 250 g za 65 Kč = 29,38 Kč', () => {
    expect(ingredientCost(ing('maslo', 250, 65), 113).cost).toBeCloseTo(29.38, 2);
  });
  it('vejce na kusy: 2 z 10 ks za 65 Kč = 13 Kč', () => {
    expect(ingredientCost(ing('vejce', 10, 65, 'ks'), 2, 'ks').cost).toBeCloseTo(13, 6);
  });
  it('převádí kg → g a l → ml', () => {
    expect(ingredientCost(ing('mouka', 1000, 20), 0.5, 'kg').cost).toBeCloseTo(10, 6);
    expect(ingredientCost(ing('mleko', 1000, 30, 'ml'), 0.25, 'l').cost).toBeCloseTo(7.5, 6);
    expect(convertQuantity(1, 'ks', 'g')).toBeNull();
  });
  it('chybějící cena / balení / nekompatibilní jednotka se hlásí, nepočítá se nula', () => {
    expect(ingredientCost(ing('x', 250, null), 10)).toEqual({ cost: null, issue: 'missing_price' });
    expect(ingredientCost(ing('x', null, 10), 10)).toEqual({ cost: null, issue: 'missing_package' });
    expect(ingredientCost(ing('x', 10, 10, 'ks'), 10, 'g')).toEqual({ cost: null, issue: 'unit_mismatch' });
    expect(ingredientCost(ing('x', 10, 10), NaN).issue).toBe('invalid_quantity');
  });
});

describe('2.–3. cena dávky a jednotkový náklad', () => {
  const ingredients = [ing('maslo', 250, 65), ing('mouka', 1000, 25), ing('vejce', 10, 65, 'ks')];
  const r = recipe('uzly', 12, 'ks', [item('maslo', 113), item('mouka', 500), item('vejce', 2, 'ks')]);
  it('součet řádků a dělení výtěžností', () => {
    const c = computeAllRecipeCosts([r], ingredients).get('uzly')!;
    const expected = 113 / 250 * 65 + 500 / 1000 * 25 + 13;
    expect(c.batchCost).toBeCloseTo(expected, 6);
    expect(c.unitCost).toBeCloseTo(expected / 12, 6);
    expect(c.complete).toBe(true);
  });
  it('neúplný recept je označen a nevydává se za přesný', () => {
    const c = computeAllRecipeCosts([recipe('r', 12, 'ks', [item('maslo', 100), item('neni', 5)])], ingredients).get('r')!;
    expect(c.complete).toBe(false);
    expect(c.lines[1].issue).toBe('missing_ingredient');
    expect(c.issues.length).toBeGreaterThan(0);
  });
  it('chybějící výtěžnost → jednotkový náklad null', () => {
    const c = computeAllRecipeCosts([recipe('r', null, 'ks', [item('maslo', 100)])], ingredients).get('r')!;
    expect(c.unitCost).toBeNull();
    expect(c.complete).toBe(false);
  });
  it('prázdný recept nemá jednotkový náklad', () => {
    expect(computeAllRecipeCosts([recipe('r', 5, 'ks', [])], []).get('r')!.unitCost).toBeNull();
  });
});

describe('4. změna ceny sdílené suroviny přepočítá všechny receptury', () => {
  const r1 = recipe('a', 10, 'ks', [item('maslo', 250)]);
  const r2 = recipe('b', 5, 'ks', [item('maslo', 125)]);
  const r3 = recipe('c', 1, 'ks', [item('mouka', 100)]);
  it('65 → 75 Kč', () => {
    const before = computeAllRecipeCosts([r1, r2, r3], [ing('maslo', 250, 65), ing('mouka', 1000, 20)]);
    const after = computeAllRecipeCosts([r1, r2, r3], [ing('maslo', 250, 75), ing('mouka', 1000, 20)]);
    expect(before.get('a')!.batchCost).toBeCloseTo(65);
    expect(after.get('a')!.batchCost).toBeCloseTo(75);
    expect(after.get('b')!.batchCost).toBeCloseTo(37.5);
    expect(after.get('c')!.batchCost).toBeCloseTo(before.get('c')!.batchCost);
  });
  it('přehled dopadu změny ceny, včetně receptů přes polotovar', () => {
    const dough = recipe('testo', 1000, 'g', [item('maslo', 250)], true);
    const final = recipe('uzel', 10, 'ks', [item('testo', 500, 'g', true)]);
    const ingredients = [ing('maslo', 250, 65)];
    const impact = ingredientChangeImpact([dough, final, r3], ingredients, { ...ingredients[0], packagePrice: 75 });
    expect(impact.map((i) => i.recipeId).sort()).toEqual(['testo', 'uzel']);
    const u = impact.find((i) => i.recipeId === 'uzel')!;
    expect(u.oldUnitCost).toBeCloseTo(3.25);
    expect(u.newUnitCost).toBeCloseTo(3.75);
  });
});

describe('sdílené polotovary bez dvojího započtení', () => {
  it('náklad těsta se dělí podle použitého množství', () => {
    const ingredients = [ing('mouka', 1000, 20), ing('mak', 500, 100)];
    const dough = recipe('testo', 1200, 'g', [item('mouka', 1000)], true); // 20 Kč / 1200 g
    const makUzel = recipe('mak', 12, 'ks', [item('testo', 600, 'g', true), item('mak', 100)]);
    const orechUzel = recipe('orech', 12, 'ks', [item('testo', 0.6, 'kg', true)]);
    const costs = computeAllRecipeCosts([dough, makUzel, orechUzel], ingredients);
    expect(costs.get('mak')!.batchCost).toBeCloseTo(10 + 20, 6);
    expect(costs.get('orech')!.batchCost).toBeCloseTo(10, 6);
    // dohromady použito 1200 g těsta = přesně 1 dávka těsta = 20 Kč, nic navíc
    expect(costs.get('mak')!.lines[0].cost! + costs.get('orech')!.lines[0].cost!).toBeCloseTo(20, 6);
  });
  it('detekce cyklů', () => {
    const a = recipe('a', 1, 'g', [item('b', 1, 'g', true)]);
    const b = recipe('b', 1, 'g', []);
    expect(wouldCreateCycle([a, b], 'b', 'a')).toBe(true);
    expect(wouldCreateCycle([a, b], 'a', 'b')).toBe(false);
    const cyc = computeAllRecipeCosts([a, { ...b, items: [item('a', 1, 'g', true)] }], []);
    expect(cyc.get('a')!.complete).toBe(false);
  });
});

describe('5.–7. typy výrobků', () => {
  it('dvojitá dávka medovníku = 1 celý výrobek, kavárna 20 porcí × 89 Kč', () => {
    const ingredients = [ing('med', 1000, 300)];
    const r = recipe('medovnik', 1, 'ks', [item('med', 2 * 250)]); // dvojitá dávka
    const rc = computeAllRecipeCosts([r], ingredients).get('medovnik')!;
    const p = product('medovnik', 'medovnik', 'whole', 1040, { retailPrice: 89, retailPortions: 20 });
    const pc = productCost(p, r, rc);
    expect(pc.unitCost).toBeCloseTo(150);
    const cafe = cafeProfit(p, settings(), 1);
    expect(cafe.cafeRevenue).toBeCloseTo(1780);
    expect(cafe.grossDifference).toBeCloseTo(740);
    expect(cafe.grossMarginPct).toBeCloseTo(740 / 1780 * 100);
  });
  it('banánový chlebíček – celý kus, 12 plátků', () => {
    const p = product('b', 'b', 'whole', 360, { retailPrice: 55, retailPortions: 12 });
    expect(cafeProfit(p, settings(), 2).cafeRevenue).toBeCloseTo(2 * 12 * 55);
  });
  it('perníčky na gramy: 700 g z dávky, náklad na 1 g a 100 g', () => {
    const r = recipe('pernik', 700, 'g', [item('mouka', 1000)]);
    const rc = computeAllRecipeCosts([r], [ing('mouka', 1000, 70)]).get('pernik')!;
    expect(rc.unitCost).toBeCloseTo(0.1); // za 1 g
    const p = product('pernik', 'pernik', 'weight', 49);
    const pc = productCost(p, r, rc);
    expect(pc.recipeUnitsPerSale).toBe(100);
    expect(pc.unitCost).toBeCloseTo(10); // za 100 g
    const plan = computePlan({ products: [p], recipes: [r], ingredients: [ing('mouka', 1000, 70)], settings: settings({ bakingDaysPerMonth: 1, hoursPerBakingDay: 0, monthlyEnergyCost: 0 }), quantities: { pernik: 1000 } });
    expect(plan.perDay.revenue).toBeCloseTo(490); // 10 × 100 g × 49 Kč
    expect(plan.batches[0].batches).toBe(2); // 1000 g potřebuje 2 dávky po 700 g
    expect(plan.batches[0].surplus).toBeCloseTo(400);
  });
  it('hmotnostní prodej vyžaduje výtěžnost v gramech', () => {
    const r = recipe('r', 10, 'ks', [item('mouka', 100)]);
    const rc = computeAllRecipeCosts([r], [ing('mouka', 1000, 20)]).get('r')!;
    expect(productCost(product('p', 'r', 'weight', 10), r, rc).unitCost).toBeNull();
  });
  it('kus z receptury v gramech použije gramáž kusu (cookie 70 g)', () => {
    const r = recipe('testo', 560, 'g', [item('mouka', 1000)]);
    const rc = computeAllRecipeCosts([r], [ing('mouka', 1000, 56)]).get('testo')!;
    expect(productCost(product('c', 'testo', 'piece', 45, { pieceWeight: 70 }), r, rc).unitCost).toBeCloseTo(7);
  });
});

describe('8. plné výrobní dávky a přebytky', () => {
  it('výtěžnost 8 cookies, odběr 15 → 2 dávky, 16 ks, přebytek 1 ks', () => {
    const r = recipe('cookie', 8, 'ks', [item('mouka', 800)]);
    const ingredients = [ing('mouka', 1000, 40)]; // dávka 32 Kč, kus 4 Kč
    const plan = computePlan({ products: [product('cookie', 'cookie', 'piece', 45)], recipes: [r], ingredients, settings: settings(), quantities: { cookie: 15 } });
    const b = plan.batches[0];
    expect(b.batches).toBe(2);
    expect(b.produced).toBe(16);
    expect(b.surplus).toBe(1);
    expect(b.actualCost).toBeCloseTo(64);
    expect(b.theoreticalCost).toBeCloseTo(60);
    expect(b.surplusCost).toBeCloseTo(4);
    expect(plan.perDay.materialActual).toBeCloseTo(64);
    expect(plan.perDay.materialTheoretical).toBeCloseTo(60);
  });
  it('více výrobků ze stejné receptury se sčítá do jedné výroby', () => {
    const r = recipe('cookie', 8, 'ks', [item('mouka', 800)]);
    const plan = computePlan({ products: [product('a', 'cookie', 'piece', 45), product('b', 'cookie', 'piece', 50)], recipes: [r], ingredients: [ing('mouka', 1000, 40)], settings: settings(), quantities: { a: 4, b: 4 } });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].batches).toBe(1);
  });
  it('přesný násobek nevytváří dávku navíc (plovoucí čárka)', () => {
    const r = recipe('r', 0.1 + 0.2, 'ks', [item('mouka', 1)]);
    const plan = computePlan({ products: [product('p', 'r', 'piece', 1)], recipes: [r], ingredients: [ing('mouka', 1, 1)], settings: settings(), quantities: { p: 0.3 } });
    expect(plan.batches[0].batches).toBe(1);
  });
});

describe('9. měsíční tržby a náklady', () => {
  const r = recipe('cookie', 8, 'ks', [item('mouka', 800)]); // 32 Kč dávka
  const ingredients = [ing('mouka', 1000, 40)];
  const s = settings({ bakingDaysPerMonth: 8, hoursPerBakingDay: 7, hourlyLaborCost: 200, monthlyEnergyCost: 1000, packagingCostPerBakingDay: 50, deliveryCostPerBakingDay: 100, otherMonthlyCosts: 300 });
  const plan = computePlan({ products: [product('cookie', 'cookie', 'piece', 45)], recipes: [r], ingredients, settings: s, quantities: { cookie: 16 } });
  it('vzorce bez dvojího započtení', () => {
    const m = plan.monthly;
    expect(plan.perDay.revenue).toBe(720);
    expect(m.revenue).toBe(5760);
    expect(m.material).toBeCloseTo(512);
    expect(m.labor).toBe(11200);
    expect(m.packaging).toBe(400);
    expect(m.delivery).toBe(800);
    expect(m.energy).toBe(1000);
    expect(m.other).toBe(300);
    expect(m.totalCosts).toBeCloseTo(512 + 11200 + 400 + 800 + 1000 + 300);
    expect(m.operatingProfit).toBeCloseTo(5760 - m.totalCosts);
    expect(m.profitBeforeLabor).toBeCloseTo(m.operatingProfit + 11200);
    expect(m.returnOnSalesPct).toBeCloseTo(m.operatingProfit / 5760 * 100);
    expect(m.hours).toBe(56);
  });
  it('bod zvratu', () => {
    // příspěvek na pečení před prací: 720 − 64 − 50 − 100 = 506; fixní 1300 → 3 pečení
    expect(plan.breakEven.bakingDaysBeforeLabor).toBe(3);
    // po práci: 506 − 1400 < 0 → bod zvratu nedosažitelný
    expect(plan.breakEven.bakingDays).toBeNull();
    expect(plan.breakEven.revenue).toBeGreaterThan(plan.monthly.revenue);
  });
  it('dělení nulou a neplatné vstupy', () => {
    const p = computePlan({ products: [product('cookie', 'cookie', 'piece', 45)], recipes: [r], ingredients, settings: settings({ bakingDaysPerMonth: NaN as number, hoursPerBakingDay: -5 }), quantities: { cookie: -3 } });
    expect(p.monthly.revenue).toBe(0);
    expect(p.monthly.returnOnSalesPct).toBeNull();
    expect(p.monthly.labor).toBe(0);
    expect(p.breakEven.volumePct).toBeNull();
  });
  it('cenový scénář nepřepisuje uložené ceny', () => {
    const products = [product('cookie', 'cookie', 'piece', 45)];
    const p = computePlan({ products, recipes: [r], ingredients, settings: s, quantities: { cookie: 16 }, priceOverrides: { cookie: 49 } });
    expect(p.perDay.revenue).toBe(16 * 49);
    expect(products[0].wholesalePrice).toBe(45);
  });
});

describe('10. marže vs. přirážka', () => {
  it('cena 100, náklad 60', () => {
    expect(marginPct(100, 60)).toBeCloseTo(40);
    expect(markupPct(100, 60)).toBeCloseTo(66.667, 2);
  });
  it('doporučená cena podle marže a přirážky', () => {
    expect(priceForMargin(60, 40)).toBeCloseTo(100);
    expect(priceForMarkup(60, 50)).toBeCloseTo(90);
    expect(priceForMargin(60, 100)).toBeNull();
    expect(marginPct(0, 10)).toBeNull();
    expect(markupPct(10, 0)).toBeNull();
  });
});

describe('kavárna', () => {
  it('cookie 45 → 79 Kč, rozdíl 34 Kč', () => {
    const c = cafeProfit(product('c', null, 'piece', 45, { retailPrice: 79 }), settings(), 1);
    expect(c.grossDifference).toBe(34);
    expect(c.basis).toContain('bez výpočtu DPH');
  });
  it('při zapnutém DPH porovnává ceny bez DPH', () => {
    const c = cafeProfit(product('c', null, 'piece', 45, { retailPrice: 112 }), settings({ vatEnabled: true, vatRatePct: 12 }), 1);
    expect(c.retailPriceCompared).toBeCloseTo(100);
    expect(c.grossDifference).toBeCloseTo(55);
  });
  it('perníčky za 100 g', () => {
    const c = cafeProfit(product('p', null, 'weight', 49, { retailPrice: 89, retailPortions: 5 }), settings(), 10);
    expect(c.portionsPerUnit).toBe(1);
    expect(c.cafeRevenue).toBeCloseTo(890);
    expect(c.grossDifference).toBeCloseTo(400);
  });
  it('neprodané porce snižují tržbu kavárny', () => {
    const c = cafeProfit(product('m', null, 'whole', 1040, { retailPrice: 89, retailPortions: 20 }), settings(), 1, 15);
    expect(c.cafeRevenue).toBeCloseTo(1335);
    expect(c.grossDifference).toBeCloseTo(295);
  });
});
