# Z trouby

Webová aplikace pro řízení nákladů, receptur a cenotvorby řemeslné domácí pekárny, která dodává sladké pečivo a dezerty do kaváren.

- Suroviny s cenou **konkrétního balení** (nemusíte znát cenu za kg) a historií cen.
- Receptury s libovolným počtem surovin, sdílenými polotovary (např. základní těsto) a výtěžností dávky.
- Výrobky a ceník pro kavárny (kus / celý výrobek / na váhu za 100 g), marže, přirážka, doporučená cena.
- Kalkulačka výroby: plán pečení, celé výrobní dávky a přebytky, práce, balení, doprava, provoz, bod zvratu.
- Zisk kavárny: hrubý rozdíl a hrubá marže odběratele, porce, DPH režim.
- Cenové scénáře (bez přepsání uložených cen), export CSV/JSON, import zálohy i staré HTML kalkulačky.
- Pouze po přihlášení, data chráněná na serveru i Row Level Security v databázi. Mobile‑first, instalovatelné jako PWA.

---

## Obsah

1. [Technologie a architektura](#1-technologie-a-architektura)
2. [Datový model](#2-datový-model)
3. [Výpočty a vzorce](#3-výpočty-a-vzorce)
4. [Instalace a lokální vývoj](#4-instalace-a-lokální-vývoj)
5. [Nastavení Supabase](#5-nastavení-supabase)
6. [Vytvoření administrátorského účtu](#6-vytvoření-administrátorského-účtu)
7. [Nasazení na Vercel](#7-nasazení-na-vercel)
8. [Import původních dat](#8-import-původních-dat)
9. [Krátký návod k používání](#9-krátký-návod-k-používání)
10. [Testy](#10-testy)
11. [Bezpečnost](#11-bezpečnost)
12. [Předpoklady a rozhodnutí](#12-předpoklady-a-rozhodnutí)

---

## 1. Technologie a architektura

| Vrstva | Technologie |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 4, komponenty ve stylu shadcn/ui nad Radix UI, ikony Lucide, notifikace Sonner |
| Databáze | PostgreSQL v Supabase (migrace v `supabase/migrations`) |
| Autentizace | Supabase Auth (e‑mail + heslo), relace v HTTP‑only cookies přes `@supabase/ssr` |
| Validace | Zod (všechny vstupy server actions a import) |
| Grafy | jednoduché přístupné pruhové grafy v CSS (bez další knihovny) |
| Testy | Vitest (výpočty, import/export, databáze + RLS), Playwright (end‑to‑end) |
| Nasazení | Vercel + Supabase |

```
src/
  proxy.ts                 1. vrstva ochrany: obnova relace, přesměrování na /login, 401 pro /api
  lib/
    calc/                  BUSINESS LOGIKA – čisté, testovatelné funkce (bez DB a UI)
      recipe.ts            náklad suroviny, dávky, polotovary, dopad změny ceny
      pricing.ts           marže, přirážka, doporučená cena, převod receptura ↔ prodejní jednotka
      plan.ts              měsíční kalkulace, výrobní dávky, přebytky, bod zvratu
      cafe.ts              hrubý rozdíl a marže kavárny, DPH
    auth.ts                AUTORIZACE – ověření relace na serveru, role admin
    db/                    DATABÁZE – připojení, transakce pod rolí "authenticated" (RLS)
    data/                  repozitář (načítání, ukládání, záloha, import)
    backup/                formát zálohy (Zod), CSV, převod staré kalkulačky
    validation.ts          Zod schémata vstupů
  app/
    actions.ts             server actions (každá ověřuje admina + validuje vstup)
    api/export/[kind]      CSV / JSON exporty (ověřují admina)
    login/                 jediná veřejná stránka
    (app)/                 chráněné stránky: přehled, suroviny, receptury, výrobky, kalkulačka, kavárna, nastavení
  components/              UI komponenty
supabase/migrations/       schéma, RLS, triggery historie, výchozí data
scripts/create-admin.mjs   bezpečné vytvoření prvního administrátora
test/                      unit, db a e2e testy
```

**Jak se přistupuje k datům.** Server ověří relaci přes `supabase.auth.getUser()` (token ověřuje Supabase Auth). Poté spustí dotazy v transakci, kde nastaví `role = authenticated` a `request.jwt.claims.sub = <id uživatele>` – stejně jako to dělá Supabase API. Funkce `auth.uid()` i všechny RLS politiky tak platí i pro serverové dotazy. Díky přímému připojení jsou složitější operace (uložení receptury se všemi řádky, obnova zálohy, import) **atomické** – buď se provedou celé, nebo vůbec.

**Ukládání v UI.** Formuláře se přepočítávají okamžitě v prohlížeči (stejné funkce z `lib/calc`), změny se ukládají do databáze automaticky s krátkým zpožděním. Indikátor ukazuje *Neuložené změny / Ukládám… / Uloženo / Chyba / Offline*. „Uloženo“ se zobrazí **jen po potvrzení serverem**. Při odchodu ze stránky se rozpracované změny odešlou okamžitě, při zavírání okna prohlížeč varuje.

## 2. Datový model

Všechny tabulky používají UUID a mají `owner_id` (vlastník = uživatel). Vazby mezi tabulkami jsou **složené cizí klíče `(owner_id, id)`**, takže záznam nemůže odkazovat na data jiného uživatele.

| Tabulka | Účel |
|---|---|
| `profiles` | e‑mail a role (`admin` / `user`); vzniká automaticky triggerem, roli admin nastavuje jen skript |
| `ingredients` | surovina: název, kategorie, značka, dodavatel, obsah balení + jednotka (g/ml/ks), cena balení, datum ceny, aktivní |
| `ingredient_price_history` | každá změna ceny / balení (trigger); jen čtení a vkládání |
| `recipes` | receptura: výtěžnost + jednotka (ks/g/ml), stav (koncept/aktivní/archiv), polotovar, „gramáže ověřeny“ |
| `recipe_ingredients` | řádek receptury: **buď** surovina, **nebo** polotovar (podreceptura), množství, jednotka (g/kg/ml/l/ks); trigger brání cyklům |
| `products` | prodejný výrobek: receptura, prodejní jednotka (kus/celý/na váhu), gramáž kusu, cena kavárně, doporučená MO cena, porce, požadovaná marže |
| `product_price_history` | historie velkoobchodních a maloobchodních cen (trigger) |
| `cost_settings` | počet pečení, hodiny, hodinová odměna, energie, balení/doprava na pečení, ostatní, výchozí marže, DPH |
| `plan_items` | aktuální výrobní plán – množství na jedno pečení (u hmotnostního prodeje v gramech) |
| `production_scenarios` + `_items` | uložené cenové scénáře se **snímkem** nastavení, cen, nákladů a výsledků |

Historie i scénáře ukládají hodnoty, ne odkazy na aktuální ceny – pozdější změna receptury či ceny je nepřepíše. Smazání výrobku nastaví ve scénáři `product_id = NULL`, ale název a čísla zůstanou.

Receptura nebo surovina, kterou něco používá, nejde smazat (`ON DELETE RESTRICT`) – nabízí se archivace / deaktivace.

## 3. Výpočty a vzorce

Vše je v `src/lib/calc` a pokryto testy (`test/unit/calc.test.ts`).

| Veličina | Vzorec |
|---|---|
| Cena spotřebované suroviny | (spotřeba převedená na jednotku balení / velikost balení) × cena balení — např. 113 / 250 × 65 = **29,38 Kč** |
| Cena recepturové dávky | Σ cen řádků (polotovar: množství × cena dávky polotovaru / výtěžnost polotovaru) |
| Jednotkový náklad | cena dávky / výtěžnost (Kč/ks, nebo Kč/g → zobrazeno i za 100 g) |
| Náklad prodejní jednotky | kus/celý z receptury v ks: = jednotkový náklad; kus z receptury v g: × gramáž kusu; na váhu: × 100 (za 100 g) |
| Počet výrobních dávek | ⌈ potřebné množství / výtěžnost ⌉ (sčítá se po recepturách) |
| Skutečný surovinový náklad | počet dávek × cena dávky |
| Teoretický náklad / přebytek | potřebné množství × jednotkový náklad; přebytek = vyrobeno − potřeba |
| Měsíční tržby (pekárny) | Σ (prodejní jednotky × cena kavárně) × počet pečení |
| Měsíční práce | počet pečení × hodin na pečení × hodinová odměna |
| Provozní zisk | tržby − suroviny − práce − balení − doprava − energie − ostatní |
| Výsledek před oceněním práce | provozní zisk + práce |
| Rentabilita tržeb | provozní zisk / tržby × 100 (při nulových tržbách „—“) |
| Marže | (cena − náklad) / cena × 100 |
| Přirážka | (cena − náklad) / náklad × 100 |
| Doporučená minimální cena | náklad / (1 − požadovaná marže) |
| Bod zvratu (počet pečení) | ⌈ (energie + ostatní) / (tržby − suroviny − balení − doprava − práce za jedno pečení) ⌉ |
| Bod zvratu (tržby) | (práce + balení + doprava + energie + ostatní) / ((tržby − teoretické suroviny) / tržby) |
| Hrubý rozdíl kavárny | prodané porce × MO cena (bez DPH, je‑li zapnuté) − dodané jednotky × cena kavárně |

Neplatné vstupy (záporné, prázdné, NaN) se počítají jako 0 a dělení nulou vrací „—“. Chybějící cena nebo balení **nikdy** nevede k tiché nule – výsledek je označen jako neúplný s vysvětlením.

## 4. Instalace a lokální vývoj

Požadavky: Node.js 20.9+ (doporučeno 22), účet Supabase.

```bash
git clone <repo> && cd v-troube
npm ci
cp .env.example .env.local     # vyplňte hodnoty ze Supabase (viz níže)
npm run dev                    # http://localhost:3000
```

## 5. Nastavení Supabase

1. Na <https://supabase.com> vytvořte nový projekt (region např. *Central EU – Frankfurt*). Heslo k databázi si uložte.
2. **Vypněte veřejnou registraci:** *Authentication → Sign In / Providers → Email*: ponechte zapnuté přihlášení e‑mailem, vypněte **Allow new users to sign up**. (Volitelně vypněte *Confirm email* – účty zakládá admin.)
3. **Spusťte migraci** jedním ze způsobů:
   - SQL Editor → vložte obsah `supabase/migrations/20261105000000_init.sql` → *Run*, nebo
   - Supabase CLI: `npx supabase link --project-ref <ref>` a `npx supabase db push`.
4. Zjistěte hodnoty do `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` a `NEXT_PUBLIC_SUPABASE_ANON_KEY` – *Project Settings → API* (anon / publishable key),
   - `DATABASE_URL` – *Connect → Connection string → Transaction pooler* (port **6543**), doplňte heslo,
   - `SUPABASE_SERVICE_ROLE_KEY` – *Project Settings → API* (service_role / secret). **Jen lokálně pro skript, nikam jinam.**
5. *Authentication → URL Configuration*: nastavte *Site URL* na adresu aplikace (po nasazení na Vercel).

## 6. Vytvoření administrátorského účtu

```bash
npm run create-admin -- vas-email@example.cz
# zadejte heslo (min. 12 znaků) – nezobrazuje se
```

Skript vytvoří potvrzený účet v Supabase Auth a nastaví mu roli `admin`. Pokud účet už existuje (např. vytvořený v *Authentication → Users → Add user*), jen ho povýší.

Alternativa bez skriptu: vytvořte uživatele v dashboardu (*Add user → Create new user*, zaškrtněte *Auto Confirm*) a v SQL Editoru spusťte:

```sql
update public.profiles set role = 'admin' where email = 'vas-email@example.cz';
```

Při prvním přihlášení se automaticky založí výchozí sortiment (7 výrobků s orientačními cenami, receptury jako **koncepty bez surovin**, katalog běžných surovin **bez cen**). Nic z toho se nevydává za ověřené – doplňte suroviny, gramáže a ceny.

## 7. Nasazení na Vercel

1. Pushněte repozitář na GitHub a ve Vercelu zvolte *Add New → Project → Import*.
2. Framework se rozpozná (Next.js). V *Environment Variables* nastavte:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   - `DATABASE_URL` (Transaction pooler, port 6543),
   - volitelně `DATABASE_POOL_MAX` (výchozí 5).
   - **Nenastavujte** `SUPABASE_SERVICE_ROLE_KEY`.
3. *Deploy*. Po nasazení nastavte v Supabase *Site URL* na doménu Vercelu.
4. Na iPhonu otevřete aplikaci v Safari → *Sdílet → Přidat na plochu*. Ikona „Z trouby“ se otevře jako samostatná aplikace; přihlášení zůstává zachováno.

## 8. Import původních dat

*Nastavení → Import dat → Vybrat soubor* a zvolte `z-trouby-zaloha.json` ze staré HTML kalkulačky. Aplikace formát rozpozná a zobrazí průvodce:

- stejné suroviny z různých výrobků se **sloučí do jedné sdílené** (podle názvu bez ohledu na velikost písmen a jednotky; kg → g, l → ml),
- pokud se liší cena nebo velikost balení, **musíte vybrat**, která varianta platí,
- pokud surovina či výrobek se stejným názvem už existuje, zvolíte *použít stávající / aktualizovat cenu / vytvořit novou*, resp. *přeskočit / vytvořit nový*,
- u každého výrobku zvolíte prodejní jednotku (kus / celý výrobek / na váhu),
- nastavení (`days, hours, hourly, fixed, packing, delivery, other`) se přepíše jen po zapnutí přepínače.

Mapování polí: `qty` → množství na jedno pečení v plánu, `wholesale` → cena kavárně, `cafePrice` → doporučená MO cena, `cafePortions` → porce, `yield` → výtěžnost receptury, `ingredients[].used/unit/size/price` → řádek receptury a cena balení suroviny. Importované receptury jsou koncepty označené „zkontrolujte“. Import proběhne v jedné transakci.

Záloha z této aplikace (*Nastavení → Úplná záloha (JSON)*) se obnovuje stejným tlačítkem. Soubor se validuje (tvar i odkazy mezi záznamy); pokud v aplikaci už data jsou, je nutné přepsání potvrdit napsáním **PŘEPSAT**.

## 9. Krátký návod k používání

1. **Suroviny** – u každé suroviny zadejte, co jste koupila: např. *Máslo, 250 g, 65 Kč*. Cena za kg se dopočítá. Při změně ceny uvidíte, kterých receptur se dotkne a jak se změní jejich náklad.
2. **Receptury** – otevřete recepturu, přidejte suroviny a množství pro jednu dávku a vyplňte výtěžnost (např. 12 ks, nebo 700 g u perníčků). Náklad dávky i kusu se počítá hned. Společné těsto založte jako *polotovar* (výtěžnost v g) a přidejte ho do receptur uzlů v množství, které spotřebují.
3. **Výrobky a ceny** – výrobek = co prodáváte. Navažte ho na recepturu, zvolte jednotku (kus / celý výrobek / na váhu za 100 g) a ceny. Seznam ukazuje náklad, rozdíl, marži a přirážku; ceny lze měnit přímo v seznamu. Doporučenou cenu použijete až po potvrzení.
4. **Kalkulačka** – nastavte počet pečení, hodiny (hned pod tím) a odměnu, kolik kusů upečete při jednom pečení a provozní náklady (balení, doprava, energie). Uvidíte tržby, náklady, zisk před a po ocenění práce, rentabilitu, výrobní dávky s přebytky a bod zvratu. V části *Cenové scénáře* vyzkoušíte jiné ceny, scénář uložíte a případně ceny použijete.
5. **Zisk kavárny** – zadejte maloobchodní cenu a počet porcí (např. medovník 20 porcí × 89 Kč). Uvidíte hrubý rozdíl a marži kavárny – před jejími dalšími náklady.
6. **Přehled** – souhrn měsíce a výrobků.
7. **Nastavení** – DPH, výchozí marže, exporty, import, odhlášení.

## 10. Testy

| Příkaz | Co ověřuje |
|---|---|
| `npm test` | výpočty (suroviny, dávky, polotovary, změna ceny, dvojitá dávka, medovník na porce, perníčky na gramy, celé dávky a přebytky, měsíc, marže vs. přirážka, bod zvratu), import/export, CSV, česká čísla |
| `npm run test:db` | migrace na čistém PostgreSQL, RLS a izolace uživatelů, zákaz cizích odkazů, zákaz povýšení role, historie cen, cykly polotovarů, uložení a načtení, záloha a obnova, import staré kalkulačky |
| `npm run test:e2e` | v prohlížeči (mobilní viewport): ochrana stránek a API, přihlášení, celý scénář surovina → receptura → výrobek → kalkulace → kavárna, odhlášení a opětovné přihlášení, scénáře, export a obnova zálohy, import staré kalkulačky, izolace druhého účtu, žádný vodorovný posun na mobilu |
| `npm run test:all` | vše výše + typová kontrola a produkční build |

Databázové a E2E testy potřebují lokální PostgreSQL (`postgresql://postgres:postgres@localhost:5432`, lze změnit přes `TEST_PG_ADMIN_URL`). Skript `scripts/test-db-reset.mjs` vytvoří databázi `ztrouby_test`, doplní malý shim prostředí Supabase (`test/support/supabase-shim.sql`: role `anon`/`authenticated`, `auth.users`, `auth.uid()`) a spustí migrace. E2E testy používají `test/support/mock-auth-server.mjs` – **pouze testovací** náhradu Supabase Auth API. Před `npm run test:e2e` spusťte `npm run build` s proměnnými z `.env.test`:

```bash
set -a && . ./.env.test && set +a && npm run build && npm run test:e2e
```

GitHub Actions (`.github/workflows/ci.yml`) spouští všechny testy automaticky.

## 11. Bezpečnost

- Jediná veřejná stránka je `/login` (a technické soubory: manifest, ikony, service worker). Žádná registrace.
- Ochrana ve třech vrstvách: `proxy.ts` (přesměrování / 401), ověření admina v každé stránce, server action i API (`lib/auth.ts`), a **RLS v databázi** (`owner_id = auth.uid() AND is_admin()`).
- Role `anon` nemá k tabulkám žádná práva; uživatel bez role admin nevidí ani nezapíše nic. Uživatel si nemůže změnit roli (profil je jen pro čtení).
- Historie cen nejde upravit ani smazat.
- V klientském kódu je jen veřejný anon klíč. `DATABASE_URL` je pouze serverová proměnná; service role klíč se používá výhradně lokálně ve skriptu.
- Bezpečnostní hlavičky (`X-Frame-Options: DENY`, `nosniff`, …), CSV export chráněný proti vkládání vzorců.
- PWA záměrně **neukládá data offline**. Bez připojení aplikace ukáže upozornění a změny nikdy neoznačí jako uložené.

## 12. Předpoklady a rozhodnutí

- **Ceny pro kavárnu jsou bez DPH.** Ve výchozím režimu se ceny porovnávají tak, jak jsou zadané. Po zapnutí DPH se maloobchodní ceny kavárny (zadávané s DPH) převádějí na ceny bez DPH sazbou z Nastavení (výchozí 12 %).
- **Hmotnostní prodej:** cena se zadává a ukládá za 100 g; v plánu se zadávají gramy.
- **Balení** je samostatná položka na jedno pečení, ne surovina receptury.
- **Polotovary** se do finální receptury započítávají poměrně (množství × cena za gram polotovaru); zaokrouhlení na celé dávky se počítá pro finální receptury.
- Výrobky ze **stejné receptury** se při výpočtu dávek sčítají (např. dva výrobky z jednoho těsta).
- **Bod zvratu** je uveden jako minimální počet pečení se stávajícím sortimentem a jako minimální měsíční tržby při zadaném počtu pečení.
- Pro kalkulace se používá **aktuální** cena suroviny; historie slouží pro sledování zdražování.
- Výchozí receptury nemají vymyšlené gramáže – mají jen výtěžnost z podkladů (12 uzlů, 8 cookies, 700 g perníčků…) a jsou označené jako neověřené koncepty.
- Architektura je připravena pro více uživatelů (`owner_id` všude); v první verzi má přístup jen role `admin`.
