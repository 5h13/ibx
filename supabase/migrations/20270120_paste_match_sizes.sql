-- Build 120 — Paste list matching, after the owner's test with a supplier DR photo.
--  * Sizes are kept: 1/4, 3/8, 0.71 stay one word (before, "1/4" became "1 4" and one-character pieces were
--    dropped, so Soft Drawn 1/4, 1/2, 3/8 and 5/8 all looked the same and none could be picked).
--  * Words joined or split: "soft drawn" finds SOFTDRAWN and "softdrawn" finds SOFT DRAWN (the catalog text is
--    also compared with its spaces taken out).
create or replace function public.catalog_paste_phrase(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(
           regexp_replace(lower(coalesce(p, '')), '[^a-z0-9./]+', ' ', 'g'),
           '(?<![0-9])[./]|[./](?![0-9])', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.catalog_paste_match(p_lines jsonb, p_business uuid default null, p_items uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := coalesce(p_business, public.pricing_business_id(), public.current_business_id());
  ln record; v_words text[]; v_phrase text; v_out jsonb := '[]'::jsonb; v_cands jsonb; v_alias uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 200 then raise exception 'Paste at most 200 lines at a time.'; end if;
  for ln in select ord, value as raw from jsonb_array_elements_text(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(value, ord) loop
    v_phrase := public.catalog_paste_phrase(ln.raw);
    v_words := public.catalog_paste_words(ln.raw);
    v_alias := (select a.item_id from public.catalog_paste_aliases a join public.finance_procurement_items i on i.id = a.item_id and i.active
                 where a.business_id = b and a.phrase = v_phrase and (p_items is null or a.item_id = any(p_items)));
    if cardinality(v_words) = 0 and v_alias is null then
      v_out := v_out || jsonb_build_object('line', ln.ord, 'text', ln.raw, 'words', '[]'::jsonb, 'candidates', '[]'::jsonb);
      continue;
    end if;
    select coalesce(jsonb_agg(c order by (c->>'remembered')::boolean desc, (c->>'score')::int desc, c->>'item_name'), '[]'::jsonb) into v_cands
      from (
        select jsonb_build_object('item_id', x.id, 'item_code', x.item_code, 'item_name', x.item_name, 'unit', x.unit, 'brand', x.brand,
                 'score', x.score, 'matched', x.matched, 'missed', x.missed, 'remembered', coalesce(x.id = v_alias, false)) as c
          from (
            select i.id, i.item_code, i.item_name, i.unit, i.brand,
                   sum(case when hit then (case when w ~ '[0-9]' then 5 else 2 end) + (case when h.hay ~ ('(^|[^a-z0-9])' || regexp_replace(w, '([./])', '\\\1', 'g')) then 1 else 0 end)
                            else 0 end)::int as score,
                   coalesce(jsonb_agg(w) filter (where hit), '[]'::jsonb) as matched,
                   coalesce(jsonb_agg(w) filter (where not hit), '[]'::jsonb) as missed
              from public.finance_procurement_items i
              cross join lateral (select lower(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand, i.description, i.category, i.specification)) as hay) h
              cross join lateral (select replace(h.hay, ' ', '') as joined) j
              cross join unnest(case when cardinality(v_words) > 0 then v_words else array[''] end) w
              cross join lateral (select (w <> '' and (position(w in h.hay) > 0 or position(w in j.joined) > 0)) as hit) m
             where i.active and (p_items is null or i.id = any(p_items))
               and (i.id = v_alias or (cardinality(v_words) > 0 and exists (
                     select 1 from unnest(v_words) w2 where position(w2 in h.hay) > 0 or position(w2 in replace(h.hay, ' ', '')) > 0)))
             group by i.id, i.item_code, i.item_name, i.unit, i.brand
             order by coalesce(i.id = v_alias, false) desc, 6 desc, i.item_name
             limit 5
          ) x
      ) s(c);
    v_out := v_out || jsonb_build_object('line', ln.ord, 'text', ln.raw, 'words', to_jsonb(v_words), 'candidates', v_cands);
  end loop;
  return v_out;
end $$;
grant execute on function public.catalog_paste_match(jsonb, uuid, uuid[]) to authenticated;
