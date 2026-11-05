import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.describe.configure({ mode: 'serial' });

async function login(page: Page, email = 'admin@ztrouby.test', password = 'heslo123', expectOk = true) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  if (expectOk) await expect(page).toHaveURL('http://localhost:3100/');
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Odhlásit se' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
}

async function editIngredient(page: Page, name: string, qty: string, price: string) {
  await page.goto('/ingredients');
  await page.getByTestId('ingredient-row').filter({ hasText: name }).first().click();
  await page.fill('#ing-qty', qty);
  await page.fill('#ing-price', price);
  await page.getByRole('button', { name: 'Uložit' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

const nbsp = (s: string) => new RegExp(s.replace(/ /g, '[\\s\\u00a0]'));

test('14. ochrana stránek a API bez přihlášení', async ({ page, request }) => {
  for (const path of ['/', '/ingredients', '/recipes', '/products', '/calculator', '/cafe-profit', '/settings', '/recipes/new']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  for (const kind of ['backup', 'ingredients', 'products', 'calculation']) {
    const res = await request.get(`/api/export/${kind}`);
    expect(res.status()).toBe(401);
  }
});

test('chybné heslo a uživatel bez role admin', async ({ page }) => {
  await login(page, 'admin@ztrouby.test', 'spatne', false);
  await expect(page.getByText('Nesprávný e-mail nebo heslo.')).toBeVisible();
  await login(page, 'host@ztrouby.test', 'heslo123', false);
  await expect(page).toHaveURL(/error=forbidden/);
  await expect(page.getByText('nemá oprávnění administrátora')).toBeVisible();
  await page.goto('/ingredients');
  await expect(page).toHaveURL(/error=forbidden/);
});

test('hlavní scénář: suroviny → receptura → výrobek → kalkulace → kavárna', async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL('http://localhost:3100/');
  await expect(page.getByRole('heading', { name: 'Přehled' })).toBeVisible();
  await expect(page.getByTestId('dashboard-products')).toContainText('Medovník z dvojité dávky');

  // Suroviny – cena balení
  await editIngredient(page, 'Máslo', '250', '65');
  await editIngredient(page, 'Vejce', '10', '65');
  await page.getByRole('button', { name: 'Přidat surovinu' }).first().click();
  await page.fill('#ing-name', 'Pistácie loupané');
  await page.fill('#ing-qty', '200');
  await page.fill('#ing-price', '189,90');
  await page.getByRole('button', { name: 'Uložit' }).click();
  await expect(page.getByTestId('ingredient-row').filter({ hasText: 'Pistácie loupané' })).toContainText(nbsp('189,90 Kč'));

  // Receptura cookies – 113 g másla, 2 vejce
  await page.goto('/recipes');
  await page.getByTestId('recipe-row').filter({ hasText: 'Cookie s pistáciemi' }).click();
  await page.getByRole('button', { name: 'Přidat surovinu' }).click();
  await page.getByLabel('Surovina 1').selectOption({ label: 'Máslo' });
  await page.getByLabel('Množství 1').fill('113');
  await page.getByRole('button', { name: 'Přidat surovinu' }).click();
  await page.getByLabel('Surovina 2').selectOption({ label: 'Vejce' });
  await page.getByLabel('Množství 2').fill('2');
  await expect(page.getByTestId('line-cost').nth(0)).toHaveText(nbsp('29,38 Kč'));
  await expect(page.getByTestId('line-cost').nth(1)).toHaveText(nbsp('13,00 Kč'));
  await expect(page.getByTestId('batch-cost')).toHaveText(nbsp('42,38 Kč'));
  await expect(page.getByTestId('unit-cost')).toHaveText(nbsp('5,30 Kč / ks'));
  await expect(page.getByText('Uloženo')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('batch-cost')).toHaveText(nbsp('42,38 Kč'));

  // Změna ceny másla → náhled dopadu a přepočet receptury
  await page.goto('/ingredients');
  await page.getByTestId('ingredient-row').filter({ hasText: 'Máslo' }).first().click();
  await page.fill('#ing-price', '75');
  await expect(page.getByTestId('price-impact')).toContainText('Cookie s pistáciemi');
  await page.getByRole('button', { name: 'Uložit' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto('/recipes');
  await page.getByTestId('recipe-row').filter({ hasText: 'Cookie s pistáciemi' }).click();
  await expect(page.getByTestId('batch-cost')).toHaveText(nbsp('46,90 Kč'));

  // Nový výrobek
  await page.goto('/products');
  await page.getByRole('link', { name: 'Přidat výrobek' }).click();
  await page.fill('#p-name', 'Cookie mini');
  await page.getByLabel('Navázaná receptura').selectOption({ label: 'Cookie s pistáciemi a bílou čokoládou (8 ks)' });
  await page.fill('#p-ws', '39');
  await page.getByRole('button', { name: 'Vytvořit výrobek' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('product-unit-cost')).toHaveText(nbsp('5,86 Kč'));

  // Úprava ceny přímo v seznamu
  await page.goto('/products');
  const row = page.getByTestId('product-row').filter({ hasText: 'čokoládou, 70 g' });
  await row.getByLabel(/Cena kavárně/).fill('46');
  await expect(row.getByText('Uloženo')).toBeVisible({ timeout: 15_000 });
  await row.getByLabel(/Cena kavárně/).fill('45');
  await expect(row.getByText('Uloženo')).toBeVisible({ timeout: 15_000 });

  // Kalkulačka – 15 cookies, 8 pečení × 7 h
  await page.goto('/calculator');
  await page.fill('#c-days', '8');
  await page.fill('#c-hours', '7');
  await page.fill('#c-pack', '120');
  const plan = page.getByTestId('plan-row').filter({ hasText: 'Cookie s pistáciemi' });
  await plan.getByLabel(/Množství/).fill('15');
  await expect(page.getByTestId('kpi-day-revenue')).toHaveText(nbsp('675,00 Kč'));
  await expect(page.getByTestId('batch-count')).toHaveText('2');
  await expect(page.getByTestId('kpi-day-material')).toHaveText(nbsp('93,80 Kč'));
  await expect(page.getByTestId('kpi-revenue')).toHaveText(nbsp('5 400 Kč'));
  // 5400 − 750,40 − 11200 − 960 − 1000 = −8510,40
  await expect(page.getByTestId('kpi-profit')).toHaveText(nbsp('[-−]8 510 Kč'));
  await expect(page.getByText('Uloženo').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  // Kavárna
  await page.goto('/cafe-profit');
  const cafe = page.getByTestId('cafe-row').filter({ hasText: 'Cookie s pistáciemi' });
  await expect(cafe.getByTestId('cafe-unit-gross')).toHaveText(nbsp('34,00 Kč'));
  const med = page.getByTestId('cafe-row').filter({ hasText: 'Medovník' });
  await expect(med.getByTestId('cafe-unit-revenue')).toHaveText(nbsp('1 780,00 Kč'));
  await expect(med.getByTestId('cafe-unit-gross')).toHaveText(nbsp('740,00 Kč'));
  await expect(page.getByText('hrubý rozdíl kavárny')).toBeVisible();

  // Odhlášení a opětovné přihlášení – data zůstala
  await logout(page);
  await login(page);
  await page.goto('/calculator');
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Cookie s pistáciemi' }).getByLabel(/Množství/)).toHaveValue('15');
  await expect(page.locator('#c-pack')).toHaveValue('120');
  await expect(page.getByTestId('kpi-revenue')).toHaveText(nbsp('5 400 Kč'));
});

test('cenový scénář – uložit a použít', async ({ page }) => {
  await login(page);
  await page.goto('/calculator');
  await page.getByLabel('Scénář – Cookie s pistáciemi a bílou čokoládou, 70 g').fill('49');
  await expect(page.getByTestId('scenario-compare')).toContainText(nbsp('5 880 Kč'));
  await page.getByLabel('Název scénáře').fill('Cookie za 49');
  await page.getByRole('button', { name: 'Uložit scénář' }).click();
  await expect(page.getByTestId('scenario-item').filter({ hasText: 'Cookie za 49' })).toBeVisible();
  // uložená cena se nezměnila
  await page.goto('/products');
  await expect(page.getByTestId('product-row').filter({ hasText: 'čokoládou, 70 g' }).getByLabel(/Cena kavárně/)).toHaveValue('45');
  await page.goto('/calculator');
  await page.getByTestId('scenario-item').filter({ hasText: 'Cookie za 49' }).getByRole('button', { name: 'Použít ceny' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Použít ceny' }).click();
  await page.waitForLoadState('networkidle');
  await page.goto('/products');
  await expect(page.getByTestId('product-row').filter({ hasText: 'čokoládou, 70 g' }).getByLabel(/Cena kavárně/)).toHaveValue('49');
});

test('13. export a import zálohy, archivace výrobku', async ({ page }) => {
  await login(page);
  const res = await page.request.get('/api/export/backup');
  expect(res.status()).toBe(200);
  const backup = await res.json();
  expect(backup.format).toBe('z-trouby-zaloha');
  expect(backup.data.products.some((p: { name: string }) => p.name === 'Cookie mini')).toBe(true);
  const csv = await (await page.request.get('/api/export/products')).text();
  expect(csv).toContain('Cookie mini');

  // archivace výrobku
  await page.goto('/products');
  await page.getByTestId('product-row').filter({ hasText: 'Cookie mini' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Archivovat' }).click();
  await expect(page.getByText('Uloženo')).toBeVisible({ timeout: 15_000 });
  await page.goto('/products');
  await expect(page.getByTestId('product-row').filter({ hasText: 'Cookie mini' })).toHaveCount(0);

  // obnova zálohy (výrobek znovu aktivní, jako v době exportu)
  await page.goto('/settings');
  await page.getByTestId('import-file').setInputFiles({ name: 'zaloha.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByText('Záloha Z trouby')).toBeVisible();
  await page.getByRole('button', { name: 'Obnovit zálohu' }).click();
  await page.getByLabel('Potvrzení').fill('PŘEPSAT');
  await page.getByRole('button', { name: 'Přepsat a obnovit' }).click();
  await expect(page).toHaveURL('http://localhost:3100/', { timeout: 15_000 });
  await page.goto('/products');
  await expect(page.getByTestId('product-row').filter({ hasText: 'Cookie mini' })).toHaveCount(1);

  // neplatný soubor
  await page.goto('/settings');
  await page.getByTestId('import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"jiny"}') });
  await expect(page.getByText('Záloha není platná')).toBeVisible();
});

test('import ze staré kalkulačky', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  const legacy = readFileSync('test/fixtures/z-trouby-zaloha.json');
  await page.getByTestId('import-file').setInputFiles({ name: 'z-trouby-zaloha.json', mimeType: 'application/json', buffer: legacy });
  const wiz = page.getByTestId('legacy-wizard');
  await expect(wiz).toBeVisible();
  await expect(page.getByRole('button', { name: 'Importovat' })).toBeDisabled();
  await wiz.getByLabel('Varianta – Hladká mouka').selectOption({ index: 1 });
  await wiz.getByLabel('Existující surovina – Hladká mouka').selectOption('use');
  await wiz.getByLabel('Existující surovina – Máslo').selectOption('use');
  await wiz.getByLabel('Existující surovina – Banány').selectOption('update');
  await wiz.getByLabel('Existující výrobek – Banánový chlebíček').selectOption('skip');
  await page.getByRole('button', { name: 'Importovat' }).click();
  await expect(page.getByText(/Importováno 1 výrobků/)).toBeVisible();
  await page.goto('/products');
  await expect(page.getByTestId('product-row').filter({ hasText: 'Linecké cukroví' })).toHaveCount(1);
});

test('15. druhý účet nevidí data prvního', async ({ page }) => {
  await login(page, 'druha@ztrouby.test');
  await page.goto('/products');
  await expect(page.getByTestId('product-row').first()).toBeVisible();
  await expect(page.getByTestId('product-row').filter({ hasText: 'Cookie mini' })).toHaveCount(0);
  await page.goto('/ingredients');
  await expect(page.getByTestId('ingredient-row').filter({ hasText: 'Pistácie loupané' })).toHaveCount(0);
});

test('mobilní zobrazení bez vodorovného posunu', async ({ page }) => {
  await login(page);
  const recipeId = await page.request.get('/api/export/backup').then((r) => r.json()).then((b) => b.data.recipes[0].id as string);
  for (const path of ['/', '/ingredients', '/recipes', `/recipes/${recipeId}`, '/products', '/products/new', '/calculator', '/cafe-profit', '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `vodorovný posun na ${path}`).toBeLessThanOrEqual(1);
  }
});
