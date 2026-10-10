-- Build 90 — access by function.
--
-- A section (Finance, Sales …) still opens the department. Inside Finance
-- and Sales, a user can now be limited to some functions only (for example
-- Finance → "Catalog photos" for a person who only uploads product photos).
--
-- Rule (same as src/core/auth/functions.ts):
--   * Super Admin / Business Admin: every function.
--   * A user with NO function rows for a section: every function of that
--     section (how it worked before this build).
--   * A user WITH function rows for a section: only those functions.
--   * "Catalog items & prices" also allows "Catalog photos".
--
-- The screens, menus, shortcuts and server actions enforce this. The
-- catalog photo screen reads and writes through the server (service role)
-- after the function check, so a photos-only user needs no other rights.

create table if not exists public.app_functions (
  code text primary key,
  section_code text not null,
  label text not null,
  hint text,
  sort int not null default 0
);
alter table public.app_functions enable row level security;
drop policy if exists app_functions_read on public.app_functions;
create policy app_functions_read on public.app_functions for select using (auth.uid() is not null);
grant select on public.app_functions to authenticated;

insert into public.app_functions (code, section_code, label, hint, sort) values
  ('catalog.photos',        'finance', 'Catalog photos',                 'See the catalog list and upload / replace product photos. No costs or prices.', 10),
  ('catalog.edit',          'finance', 'Catalog items & prices',         'Add / edit items, import / export, markups, price requests and price review. Includes catalog photos.', 20),
  ('procurement.suppliers', 'finance', 'Suppliers & supplier quotes',    'Supplier master, documents and supplier quotes.', 30),
  ('procurement.pr',        'finance', 'Purchase requisitions',          'Create and process purchase requisitions.', 40),
  ('procurement.po',        'finance', 'Purchase orders',                'Create and process purchase orders.', 50),
  ('finance.ap',            'finance', 'Accounts payable',               'Supplier invoices, payments, supplier statements.', 60),
  ('finance.ar',            'finance', 'Accounts receivable',            'Customer invoices, receipts, statements; storefront (view).', 70),
  ('finance.expenses',      'finance', 'Expenses',                       'Finance expenses and the all-expenses register.', 80),
  ('finance.payroll',       'finance', 'Payroll',                        'Payroll runs, periods and pay profiles.', 90),
  ('finance.cash',          'finance', 'Bank / cash & reconciliation',   'Cash accounts, check register, reconciliation.', 100),
  ('finance.budgets',       'finance', 'Budgets & cost centers',         'Budgets, forecasting and cost centers.', 110),
  ('finance.accounting',    'finance', 'Dashboard & accounting',         'Finance dashboard, financial summary, opening stock.', 120),
  ('sales.counter',         'sales',   'Counter sales',                  'New sale, sales register, orders, returns, approvals at the storefront.', 10),
  ('sales.ar_collect',      'sales',   'Receive AR at the counter',      'Receive payments on old invoices at the storefront.', 20),
  ('sales.closing',         'sales',   'Cash drawer & day closing',      'Opening float, cash out, daily closing.', 30),
  ('sales.quotes',          'sales',   'Quotations & sales orders',      'Sales / revenue pipeline.', 40),
  ('sales.agents',          'sales',   'Agents',                         'Sales agents list and settings.', 50),
  ('sales.price_review',    'sales',   'Price review & supplier quotes', 'Price review and supplier quotes (Sales side).', 60),
  ('sales.reports',         'sales',   'Sales & commission reports',     'Monthly sales and commission reporting.', 70),
  ('sales.expenses',        'sales',   'Expenses',                       'Sales expenses.', 80)
on conflict (code) do update set section_code = excluded.section_code, label = excluded.label, hint = excluded.hint, sort = excluded.sort;

create table if not exists public.user_functions (
  user_id uuid not null references public.users(id) on delete cascade,
  function_code text not null references public.app_functions(code) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  primary key (user_id, function_code)
);
alter table public.user_functions enable row level security;

drop policy if exists user_functions_select on public.user_functions;
create policy user_functions_select on public.user_functions for select using (
  user_id = auth.uid()
  or public.is_super_admin()
  or (public.is_business_admin() and exists (select 1 from public.users u where u.id = user_functions.user_id and u.business_id = public.current_business_id()))
);
drop policy if exists user_functions_manage on public.user_functions;
create policy user_functions_manage on public.user_functions for all using (
  public.is_super_admin()
  or (public.is_business_admin() and exists (select 1 from public.users u where u.id = user_functions.user_id
        and u.business_id = public.current_business_id() and u.role not in ('super_admin','business_admin')))
) with check (
  public.is_super_admin()
  or (public.is_business_admin() and exists (select 1 from public.users u where u.id = user_functions.user_id
        and u.business_id = public.current_business_id() and u.role not in ('super_admin','business_admin')))
);
grant select, insert, delete on public.user_functions to authenticated;

-- Does the signed-in user hold this function? (mirror of hasFunction in the app)
create or replace function public.has_function(p_code text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_section text; v_role text; v_home text; v_restricted boolean;
begin
  if auth.uid() is null then return false; end if;
  if public.is_super_admin() or public.is_business_admin() then return true; end if;
  select section_code into v_section from public.app_functions where code = p_code;
  if v_section is null then return false; end if;
  select u.role::text, s.code into v_role, v_home from public.users u left join public.sections s on s.id = u.section_id
   where u.id = auth.uid() and u.is_active;
  if v_role is null then return false; end if;
  if not (v_role = v_section or coalesce(v_home = v_section, false) or public.has_section_access(v_section)) then return false; end if;
  select exists (select 1 from public.user_functions uf join public.app_functions f on f.code = uf.function_code
                  where uf.user_id = auth.uid() and f.section_code = v_section) into v_restricted;
  if not coalesce(v_restricted, false) then return true; end if;
  return exists (select 1 from public.user_functions uf where uf.user_id = auth.uid()
                  and (uf.function_code = p_code or (p_code = 'catalog.photos' and uf.function_code = 'catalog.edit')));
end $$;
revoke all on function public.has_function(text) from public;
grant execute on function public.has_function(text) to authenticated;

-- Product Search for the catalog-photos people too. can_read_shared_catalog()
-- also guards the catalog TABLES (costs), so it is left alone; only the two
-- read-only search RPCs accept the wider test.
create or replace function public.can_search_catalog()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_shared_catalog() or public.has_function('catalog.photos');
$$;
revoke all on function public.can_search_catalog() from public;
grant execute on function public.can_search_catalog() to authenticated;

do $$
declare d text;
begin
  for d in
    select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('catalog_product_search', 'catalog_product_detail')
  loop
    execute replace(d, 'public.can_read_shared_catalog()', 'public.can_search_catalog()');
  end loop;
end $$;
