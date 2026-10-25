-- Build 141a — the online shop's posts, the Studio and the Shop Inbox follow the Super Admin's "Acting as" store
-- (owner's report 2026-10-25: saving a promotion in Sales → Online Shop failed with "null value in column
-- business_id of relation shop_posts"). current_business_id() is empty for the Super Admin; the acting store is
-- super_admin_view_business(). Same fix as Build 97a (clients).
do $$
declare f text; src text;
begin
  foreach f in array array['public.shop_post_save(jsonb)', 'public.studio_products()', 'public.studio_font_save(text)',
                           'public.studio_post(jsonb)', 'public.shop_inbox_seen()', 'public.shop_inbox_count()'] loop
    src := pg_get_functiondef(f::regprocedure);
    if position('public.current_business_id()' in src) = 0 then raise exception 'Unexpected definition of %', f; end if;
    src := replace(src, 'public.current_business_id()', 'coalesce(public.current_business_id(), public.super_admin_view_business())');
    execute src;
  end loop;
  -- no store chosen: a clear message instead of a database error
  src := pg_get_functiondef('public.shop_post_save(jsonb)'::regprocedure);
  if position('if not public.shop_can_edit(v_b) then' in src) = 0 then raise exception 'Unexpected definition of shop_post_save'; end if;
  src := replace(src, 'if not public.shop_can_edit(v_b) then', 'if v_b is null then raise exception ''Choose a store in "Acting as" first.''; end if;
  if not public.shop_can_edit(v_b) then');
  execute src;
end $$;
