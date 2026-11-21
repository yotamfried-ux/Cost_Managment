begin;

create function public.finance_summary(org uuid, first_day date, last_day date, project uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with scoped as (
    select c.*, case when project is null then c.amount_ils_minor
                    else round(c.amount_ils_minor * a.share_bps::numeric / 10000)::bigint end as amount
      from public.charges c
      left join public.cost_allocations a on a.charge_id=c.id and a.project_id=project
      where c.organization_id=org and c.recorded_on >= first_day - interval '11 months' and c.recorded_on < last_day
        and (project is null or a.project_id is not null)
  ), current_period as (
    select * from scoped where recorded_on >= first_day
  ), evidence as (
    select evidence as name, sum(amount) as total, count(*) as entries,
      count(*) filter (where amount is null and amount_minor is not null) as fx_missing
    from current_period group by evidence
  ), categories as (
    select category as name, sum(greatest(0,amount)) as total from current_period
    where evidence in ('verified','provider') and amount is not null group by category
    having sum(greatest(0,amount)) > 0 order by total desc
  ), trend as (
    select to_char(recorded_on,'YYYY-MM') as month,
      sum(amount) filter (where evidence='verified') as verified,
      sum(amount) filter (where evidence='provider') as provider
    from scoped group by 1 order by 1
  ), project_cost as (
    select a.project_id, sum(round(c.amount * a.share_bps::numeric / 10000)) as total
    from current_period c join public.cost_allocations a on a.charge_id=c.id
    where project is null and c.evidence in ('verified','provider') and c.amount is not null
    group by a.project_id
  ), supplier_cost as (
    select s.name, sum(greatest(0,c.amount)) as total from current_period c
    join public.suppliers s on s.id=c.supplier_id
    where c.evidence in ('verified','provider') and c.amount is not null
    group by s.name having sum(greatest(0,c.amount)) > 0 order by total desc
  ), unallocated as (
    select sum(c.amount - coalesce(a.allocated,0)) as total
    from current_period c
    left join lateral (
      select sum(round(c.amount * ca.share_bps::numeric / 10000)) as allocated
      from public.cost_allocations ca where ca.charge_id = c.id
    ) a on true
    where project is null and c.evidence in ('verified','provider') and c.amount is not null
  )
  select jsonb_build_object(
    'evidence', coalesce((select jsonb_agg(evidence) from evidence),'[]'),
    'categories',coalesce((select jsonb_agg(categories) from categories),'[]'),
    'trend',coalesce((select jsonb_agg(trend) from trend),'[]'),
    'projects',coalesce((select jsonb_agg(project_cost) from project_cost),'[]'),
    'suppliers',coalesce((select jsonb_agg(supplier_cost) from supplier_cost),'[]'),
    'unallocated',(select total from unallocated)
  );
$$;
revoke all on function public.finance_summary from public,anon,service_role;
grant execute on function public.finance_summary to authenticated;

create function public.apply_charge_rate(org uuid, charge uuid, quote text, quoted date, rate_source text)
returns void language plpgsql security definer set search_path = '' as $$
declare expense public.charges; rate_id uuid; rate numeric; precision integer;
begin
  if not d2r_private.can_access(org,true) then raise exception 'not authorized' using errcode='42501'; end if;
  select * into expense from public.charges where organization_id=org and id=charge for update;
  if expense.id is null or expense.currency='ILS' or expense.amount_minor is null or quoted>expense.recorded_on then raise exception 'invalid expense'; end if;
  if quote !~ '^[0-9]{1,8}(\.[0-9]{1,10})?$' then raise exception 'invalid exchange rate'; end if;
  rate := quote::numeric;
  if rate <= 0 then raise exception 'invalid exchange rate'; end if;
  insert into public.exchange_rates(organization_id,currency,rate_to_ils,quoted_on,source)
    values(org,expense.currency,rate,quoted,rate_source)
    on conflict (organization_id,currency,quoted_on,source) do nothing returning id into rate_id;
  if rate_id is null then
    select id into rate_id from public.exchange_rates
      where organization_id=org and currency=expense.currency and quoted_on=quoted and source=rate_source and rate_to_ils=rate;
    if rate_id is null then raise exception 'exchange source conflict'; end if;
  end if;
  precision := case when expense.currency in ('JPY','KRW','CLP','VND') then 0 when expense.currency in ('BHD','KWD','OMR','JOD','TND','IQD','LYD') then 3 else 2 end;
  update public.charges set fx_rate_id=rate_id,
    amount_ils_minor=round(expense.amount_minor*rate*100/power(10::numeric,precision)) where id=charge;
end $$;
revoke all on function public.apply_charge_rate from public,anon,service_role;
grant execute on function public.apply_charge_rate to authenticated;

create function d2r_private.flag_large_charge() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.evidence in ('verified','provider') and exists (
    select 1 from public.organizations where id=new.organization_id and new.amount_ils_minor >= alert_threshold_minor
  ) then
    insert into public.notifications(organization_id,code,reference) values(new.organization_id,'charge_threshold',new.id::text)
      on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function d2r_private.flag_large_charge() from public;
create trigger flag_large_charge after insert or update on public.charges
  for each row execute function d2r_private.flag_large_charge();

commit;
