-- Z trouby – počáteční schéma
-- Všechna podnikatelská data jsou vázaná na vlastníka (owner_id = auth.users.id)
-- a chráněná Row Level Security. V první verzi má přístup pouze role "admin".

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Profily a role
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

-- Profil vzniká automaticky při vytvoření uživatele. Role admin se NIKDY
-- nepřiděluje automaticky – nastavuje ji skript create-admin (service role).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Pomocné funkce
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suroviny
-- ---------------------------------------------------------------------------
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  category text not null default 'ostatní',
  brand text,
  supplier text,
  package_quantity numeric(12, 3) check (package_quantity is null or package_quantity > 0),
  package_unit text not null default 'g' check (package_unit in ('g', 'ml', 'ks')),
  package_price numeric(12, 2) check (package_price is null or package_price >= 0),
  price_updated_at date,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);
create unique index ingredients_owner_name_brand_uq
  on public.ingredients (owner_id, lower(name), lower(coalesce(brand, '')));
create index ingredients_owner_idx on public.ingredients (owner_id);
create trigger ingredients_updated_at before update on public.ingredients
  for each row execute function public.set_updated_at();

create table public.ingredient_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ingredient_id uuid not null,
  old_price numeric(12, 2),
  new_price numeric(12, 2),
  old_package_quantity numeric(12, 3),
  package_quantity numeric(12, 3),
  package_unit text,
  changed_at timestamptz not null default now(),
  foreign key (owner_id, ingredient_id) references public.ingredients (owner_id, id) on delete cascade
);
create index ingredient_price_history_ing_idx on public.ingredient_price_history (ingredient_id, changed_at desc);

create or replace function public.log_ingredient_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- obnova ze zálohy vkládá historii přímo ze souboru
  if coalesce(current_setting('ztrouby.skip_history', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.package_price is not null then
      insert into public.ingredient_price_history
        (owner_id, ingredient_id, old_price, new_price, old_package_quantity, package_quantity, package_unit)
      values (new.owner_id, new.id, null, new.package_price, null, new.package_quantity, new.package_unit);
    end if;
  elsif new.package_price is distinct from old.package_price
     or new.package_quantity is distinct from old.package_quantity
     or new.package_unit is distinct from old.package_unit then
    insert into public.ingredient_price_history
      (owner_id, ingredient_id, old_price, new_price, old_package_quantity, package_quantity, package_unit)
    values (new.owner_id, new.id, old.package_price, new.package_price, old.package_quantity, new.package_quantity, new.package_unit);
  end if;
  return new;
end;
$$;
create trigger ingredients_price_history after insert or update on public.ingredients
  for each row execute function public.log_ingredient_price();

-- ---------------------------------------------------------------------------
-- Receptury
-- ---------------------------------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  notes text,
  yield_quantity numeric(12, 3) check (yield_quantity is null or yield_quantity > 0),
  yield_unit text not null default 'ks' check (yield_unit in ('ks', 'g', 'ml')),
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  is_subrecipe boolean not null default false,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);
create index recipes_owner_idx on public.recipes (owner_id);
create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id uuid not null,
  ingredient_id uuid,
  sub_recipe_id uuid,
  quantity_used numeric(12, 3) not null check (quantity_used > 0),
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'ks')),
  sort_order integer not null default 0,
  note text,
  check (num_nonnulls(ingredient_id, sub_recipe_id) = 1),
  check (sub_recipe_id is null or sub_recipe_id <> recipe_id),
  foreign key (owner_id, recipe_id) references public.recipes (owner_id, id) on delete cascade,
  foreign key (owner_id, ingredient_id) references public.ingredients (owner_id, id) on delete restrict,
  foreign key (owner_id, sub_recipe_id) references public.recipes (owner_id, id) on delete restrict
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);
create index recipe_ingredients_sub_idx on public.recipe_ingredients (sub_recipe_id);

-- Zabrání cyklům v podrecepturách (A používá B, B používá A).
create or replace function public.check_recipe_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  has_cycle boolean;
begin
  if new.sub_recipe_id is null then
    return new;
  end if;
  with recursive deps(id) as (
    select new.sub_recipe_id
    union
    select ri.sub_recipe_id
    from public.recipe_ingredients ri
    join deps d on ri.recipe_id = d.id
    where ri.sub_recipe_id is not null
  )
  select exists (select 1 from deps where id = new.recipe_id) into has_cycle;
  if has_cycle then
    raise exception 'Podreceptura by vytvořila cyklus.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger recipe_ingredients_cycle before insert or update on public.recipe_ingredients
  for each row execute function public.check_recipe_cycle();

-- ---------------------------------------------------------------------------
-- Výrobky
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id uuid,
  name text not null check (length(btrim(name)) > 0),
  category text not null default 'ostatní',
  -- piece = kus, whole = celý výrobek, weight = hmotnostní prodej (cena za 100 g)
  sales_unit text not null default 'piece' check (sales_unit in ('piece', 'whole', 'weight')),
  piece_weight numeric(12, 3) check (piece_weight is null or piece_weight > 0),
  -- cena za prodejní jednotku; u hmotnostního prodeje cena za 100 g
  wholesale_price numeric(12, 2) not null default 0 check (wholesale_price >= 0),
  -- maloobchodní cena kavárny za porci; u hmotnostního prodeje za 100 g
  retail_price numeric(12, 2) check (retail_price is null or retail_price >= 0),
  retail_portions numeric(12, 3) not null default 1 check (retail_portions > 0),
  target_margin_pct numeric(5, 2) check (target_margin_pct is null or (target_margin_pct >= 0 and target_margin_pct < 100)),
  is_active boolean not null default true,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, recipe_id) references public.recipes (owner_id, id) on delete restrict
);
create index products_owner_idx on public.products (owner_id);
create index products_recipe_idx on public.products (recipe_id);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create table public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null,
  old_wholesale_price numeric(12, 2),
  wholesale_price numeric(12, 2),
  old_retail_price numeric(12, 2),
  retail_price numeric(12, 2),
  changed_at timestamptz not null default now(),
  foreign key (owner_id, product_id) references public.products (owner_id, id) on delete cascade
);
create index product_price_history_idx on public.product_price_history (product_id, changed_at desc);

create or replace function public.log_product_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- obnova ze zálohy vkládá historii přímo ze souboru
  if coalesce(current_setting('ztrouby.skip_history', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.product_price_history (owner_id, product_id, wholesale_price, retail_price)
    values (new.owner_id, new.id, new.wholesale_price, new.retail_price);
  elsif new.wholesale_price is distinct from old.wholesale_price
     or new.retail_price is distinct from old.retail_price then
    insert into public.product_price_history
      (owner_id, product_id, old_wholesale_price, wholesale_price, old_retail_price, retail_price)
    values (new.owner_id, new.id, old.wholesale_price, new.wholesale_price, old.retail_price, new.retail_price);
  end if;
  return new;
end;
$$;
create trigger products_price_history after insert or update on public.products
  for each row execute function public.log_product_price();

-- ---------------------------------------------------------------------------
-- Nastavení nákladů a výrobní plán
-- ---------------------------------------------------------------------------
create table public.cost_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() unique references auth.users (id) on delete cascade,
  baking_days_per_month numeric(6, 2) not null default 8 check (baking_days_per_month >= 0),
  hours_per_baking_day numeric(6, 2) not null default 7 check (hours_per_baking_day >= 0),
  hourly_labor_cost numeric(12, 2) not null default 200 check (hourly_labor_cost >= 0),
  monthly_energy_cost numeric(12, 2) not null default 1000 check (monthly_energy_cost >= 0),
  packaging_cost_per_baking_day numeric(12, 2) not null default 0 check (packaging_cost_per_baking_day >= 0),
  delivery_cost_per_baking_day numeric(12, 2) not null default 0 check (delivery_cost_per_baking_day >= 0),
  other_monthly_costs numeric(12, 2) not null default 0 check (other_monthly_costs >= 0),
  default_target_margin_pct numeric(5, 2) not null default 60 check (default_target_margin_pct >= 0 and default_target_margin_pct < 100),
  vat_enabled boolean not null default false,
  vat_rate_pct numeric(5, 2) not null default 12 check (vat_rate_pct >= 0 and vat_rate_pct < 100),
  updated_at timestamptz not null default now()
);
create trigger cost_settings_updated_at before update on public.cost_settings
  for each row execute function public.set_updated_at();

-- Aktuální (pracovní) výrobní plán: kolik se vyrobí při jednom pečení.
-- U hmotnostního prodeje je množství v gramech.
create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null,
  quantity_per_baking_day numeric(12, 3) not null default 0 check (quantity_per_baking_day >= 0),
  unique (owner_id, product_id),
  foreign key (owner_id, product_id) references public.products (owner_id, id) on delete cascade
);

-- Uložené scénáře: obsahují snímek nastavení, cen a nákladů v okamžiku uložení,
-- takže pozdější změny receptů či cen jejich hodnoty nepřepíší.
create table public.production_scenarios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  note text,
  settings_snapshot jsonb not null,
  results_snapshot jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (owner_id, id)
);
create index production_scenarios_owner_idx on public.production_scenarios (owner_id, created_at desc);

create table public.production_scenario_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scenario_id uuid not null,
  product_id uuid,
  product_name text not null,
  sales_unit text not null,
  quantity_per_baking_day numeric(12, 3) not null default 0,
  wholesale_price numeric(12, 2),
  price_override numeric(12, 2),
  unit_cost numeric(12, 4),
  foreign key (owner_id, scenario_id) references public.production_scenarios (owner_id, id) on delete cascade,
  foreign key (owner_id, product_id) references public.products (owner_id, id) on delete set null (product_id)
);
create index production_scenario_items_scenario_idx on public.production_scenario_items (scenario_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_price_history enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.products enable row level security;
alter table public.product_price_history enable row level security;
alter table public.cost_settings enable row level security;
alter table public.plan_items enable row level security;
alter table public.production_scenarios enable row level security;
alter table public.production_scenario_items enable row level security;

-- Profil: uživatel smí číst pouze svůj profil. Změnu role nesmí provádět sám.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'ingredients', 'recipes', 'recipe_ingredients', 'products',
    'cost_settings', 'plan_items', 'production_scenarios', 'production_scenario_items'
  ] loop
    execute format(
      'create policy %1$s_owner_admin on public.%1$I for all to authenticated
         using (owner_id = (select auth.uid()) and (select public.is_admin()))
         with check (owner_id = (select auth.uid()) and (select public.is_admin()))', t);
  end loop;
  -- Historie: čtení a vkládání (triggery, import zálohy), bez úprav a mazání.
  foreach t in array array['ingredient_price_history', 'product_price_history'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using (owner_id = (select auth.uid()) and (select public.is_admin()))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
         with check (owner_id = (select auth.uid()) and (select public.is_admin()))', t);
  end loop;
end;
$$;

-- Supabase přiděluje rolím anon/authenticated výchozí práva na nové tabulky – odebereme je
-- a přidělíme jen to, co aplikace potřebuje. Řádky navíc filtruje RLS.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on
  public.ingredients, public.recipes, public.recipe_ingredients, public.products,
  public.cost_settings, public.plan_items, public.production_scenarios, public.production_scenario_items
  to authenticated;
grant select, insert on public.ingredient_price_history, public.product_price_history to authenticated;

-- ---------------------------------------------------------------------------
-- Výchozí data při prvním přihlášení administrátora
-- Ceny surovin ani gramáže nejsou známy – zůstávají nevyplněné.
-- ---------------------------------------------------------------------------
create or replace function public.seed_initial_data()
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r_uzel_mak uuid; r_uzel_orech uuid; r_uzel_kard uuid; r_cookie uuid;
  r_medovnik uuid; r_banan uuid; r_pernik uuid;
  unverified text := 'Výchozí orientační receptura – suroviny a gramáže zatím nejsou ověřené, doplňte je.';
begin
  if uid is null or not public.is_admin() then
    raise exception 'Nepřihlášený nebo neoprávněný uživatel.';
  end if;
  -- Souběžná volání: unikátní owner_id zajistí, že data vzniknou jen jednou.
  insert into public.cost_settings (owner_id) values (uid) on conflict (owner_id) do nothing;
  if not found then
    return false;
  end if;

  insert into public.ingredients (owner_id, name, category, package_unit) values
    (uid, 'Hladká mouka', 'mouka', 'g'),
    (uid, 'Polohrubá mouka', 'mouka', 'g'),
    (uid, 'Máslo', 'tuky', 'g'),
    (uid, 'Mléko', 'mléčné výrobky', 'ml'),
    (uid, 'Smetana ke šlehání', 'mléčné výrobky', 'ml'),
    (uid, 'Vejce', 'vejce', 'ks'),
    (uid, 'Cukr krupice', 'cukry', 'g'),
    (uid, 'Moučkový cukr', 'cukry', 'g'),
    (uid, 'Med', 'cukry', 'g'),
    (uid, 'Droždí', 'kypřidla', 'g'),
    (uid, 'Kypřicí prášek', 'kypřidla', 'g'),
    (uid, 'Jedlá soda', 'kypřidla', 'g'),
    (uid, 'Skořice', 'koření', 'g'),
    (uid, 'Kardamom', 'koření', 'g'),
    (uid, 'Perníkové koření', 'koření', 'g'),
    (uid, 'Mák', 'semena', 'g'),
    (uid, 'Švestková povidla', 'ovoce', 'g'),
    (uid, 'Banány', 'ovoce', 'g'),
    (uid, 'Vlašské ořechy', 'ořechy', 'g'),
    (uid, 'Pistácie', 'ořechy', 'g'),
    (uid, 'Bílá čokoláda', 'čokoláda', 'g');

  insert into public.recipes (owner_id, name, yield_quantity, yield_unit, status, notes)
    values (uid, 'Uzel mák + švestky', 12, 'ks', 'draft', unverified) returning id into r_uzel_mak;
  insert into public.recipes (owner_id, name, yield_quantity, yield_unit, status, notes)
    values (uid, 'Uzel skořice + ořechy', 12, 'ks', 'draft', unverified) returning id into r_uzel_orech;
  insert into public.recipes (owner_id, name, yield_quantity, yield_unit, status, notes)
    values (uid, 'Uzel skořice + kardamom', 12, 'ks', 'draft', unverified) returning id into r_uzel_kard;
  insert into public.recipes (owner_id, name, yield_quantity, yield_unit, status, notes)
    values (uid, 'Cookie s pistáciemi a bílou čokoládou', 8, 'ks', 'draft', unverified) returning id into r_cookie;
  insert into public.recipes (owner_id, name, description, yield_quantity, yield_unit, status, notes)
    values (uid, 'Medovník (dvojitá dávka)', 'Receptura obsahuje dvojitou dávku – výsledkem je 1 celý medovník.', 1, 'ks', 'draft', unverified) returning id into r_medovnik;
  insert into public.recipes (owner_id, name, yield_quantity, yield_unit, status, notes)
    values (uid, 'Banánový chlebíček', 1, 'ks', 'draft', unverified) returning id into r_banan;
  insert into public.recipes (owner_id, name, yield_quantity, yield_unit, status, notes)
    values (uid, 'Perníčky', 700, 'g', 'draft', unverified) returning id into r_pernik;
  insert into public.recipes (owner_id, name, description, yield_unit, status, is_subrecipe, notes)
    values (uid, 'Základní kynuté těsto na uzly', 'Sdílený polotovar pro všechny uzly. Doplňte suroviny a výtěžnost v gramech a poté jej přidejte do receptur uzlů.', 'g', 'draft', true, unverified);

  insert into public.products (owner_id, recipe_id, name, category, sales_unit, piece_weight, wholesale_price, retail_price, retail_portions, sort_order) values
    (uid, r_uzel_mak, 'Uzel mák + švestky', 'uzly', 'piece', null, 49, null, 1, 1),
    (uid, r_uzel_orech, 'Uzel skořice + ořechy', 'uzly', 'piece', null, 47, null, 1, 2),
    (uid, r_uzel_kard, 'Uzel skořice + kardamom', 'uzly', 'piece', null, 43, null, 1, 3),
    (uid, r_cookie, 'Cookie s pistáciemi a bílou čokoládou, 70 g', 'cookies', 'piece', 70, 45, 79, 1, 4),
    (uid, r_medovnik, 'Medovník z dvojité dávky', 'dorty', 'whole', null, 1040, 89, 20, 5),
    (uid, r_banan, 'Banánový chlebíček', 'chlebíčky', 'whole', null, 360, null, 12, 6),
    (uid, r_pernik, 'Perníčky', 'perníčky', 'weight', null, 49, null, 1, 7);

  return true;
end;
$$;
revoke all on function public.seed_initial_data() from public, anon;
grant execute on function public.seed_initial_data() to authenticated;
grant execute on function public.is_admin() to authenticated;
