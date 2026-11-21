begin;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_number text,
  contact_email text,
  alert_threshold_minor bigint check (alert_threshold_minor > 0),
  created_at timestamptz not null default now()
);
create table public.memberships (
  organization_id uuid not null references public.organizations,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  primary key (organization_id, user_id)
);
create index memberships_user on public.memberships (user_id);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '',
  status text not null default 'active' check (status in ('active','planned','archived')),
  monthly_budget_minor bigint check (monthly_budget_minor >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, name)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  name text not null check (length(trim(name)) between 1 and 100),
  category text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, name)
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  supplier_id uuid not null,
  label text not null,
  amount_minor bigint check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cycle text not null check (cycle in ('monthly','annual','usage')),
  next_charge_on date,
  status text not null default 'active' check (status in ('active','paused','ended')),
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id,id)
);
create table public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  provider text not null,
  external_account_id text not null,
  supplier_id uuid not null,
  last_synced_at timestamptz,
  unique (organization_id,id), unique (organization_id,provider,external_account_id),
  foreign key (organization_id,supplier_id) references public.suppliers (organization_id,id)
);
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  rate_to_ils numeric(20,10) not null check (rate_to_ils > 0),
  quoted_on date not null,
  source text not null,
  unique (organization_id,id), unique (organization_id,currency,quoted_on,source)
);
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  supplier_id uuid,
  provider_account_id uuid,
  external_key text,
  request_id uuid not null default gen_random_uuid(),
  description text not null check (length(trim(description)) between 1 and 240),
  category text not null,
  amount_minor bigint check (abs(amount_minor) <= 1000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  evidence text not null check (evidence in ('verified','provider','estimate','missing')),
  source text not null,
  recorded_on date not null,
  usage_on date,
  billing_period_start date,
  billing_period_end date,
  paid_at timestamptz,
  fx_rate_id uuid,
  amount_ils_minor bigint,
  tax_class text not null default 'review' check (tax_class in ('review','business','personal','mixed')),
  created_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,request_id), unique (provider_account_id,external_key),
  foreign key (organization_id,supplier_id) references public.suppliers (organization_id,id),
  foreign key (organization_id,provider_account_id) references public.provider_accounts (organization_id,id),
  foreign key (organization_id,fx_rate_id) references public.exchange_rates (organization_id,id),
  check ((evidence = 'missing') = (amount_minor is null)),
  check (billing_period_end is null or billing_period_end >= billing_period_start)
);
create index charges_period on public.charges (organization_id,recorded_on desc,id);
create index charges_supplier on public.charges (organization_id,supplier_id,recorded_on desc);
create table public.cost_allocations (
  organization_id uuid not null,
  charge_id uuid not null,
  project_id uuid not null,
  share_bps integer not null check (share_bps between 1 and 10000),
  primary key (charge_id,project_id),
  foreign key (organization_id,charge_id) references public.charges (organization_id,id),
  foreign key (organization_id,project_id) references public.projects (organization_id,id)
);
create index allocations_project on public.cost_allocations (organization_id,project_id,charge_id);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  supplier_id uuid not null,
  invoice_number text not null,
  issued_on date not null,
  amount_minor bigint not null check (amount_minor between 0 and 1000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  archive_object_key text generated always as (organization_id::text || '/' || sha256 || '.pdf') stored,
  original_name text not null,
  status text not null default 'review' check (status in ('review','matched')),
  created_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,sha256), unique (organization_id,supplier_id,invoice_number),
  foreign key (organization_id,supplier_id) references public.suppliers (organization_id,id)
);
create index invoices_period on public.invoices (organization_id,issued_on desc,id);
create table public.reconciliation_matches (
  organization_id uuid not null,
  charge_id uuid primary key,
  invoice_id uuid not null unique,
  matched_at timestamptz not null default now(),
  actor_id uuid references auth.users,
  foreign key (organization_id,charge_id) references public.charges (organization_id,id),
  foreign key (organization_id,invoice_id) references public.invoices (organization_id,id)
);
create table public.cost_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  provider_account_id uuid not null,
  external_key text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  observed_at timestamptz not null default now(),
  unique (provider_account_id,external_key,payload_hash),
  foreign key (organization_id,provider_account_id) references public.provider_accounts (organization_id,id)
);
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  provider_account_id uuid not null,
  status text not null check (status in ('running','completed','failed')),
  observed_count integer not null default 0,
  reason text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (organization_id,provider_account_id) references public.provider_accounts (organization_id,id)
);
create index sync_runs_latest on public.sync_runs (organization_id,started_at desc);
create table public.notifications (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations,
  code text not null,
  reference text not null,
  created_at timestamptz not null default now(),
  unique (organization_id,code,reference)
);
create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  actor_id uuid,
  entity text not null,
  operation text not null,
  before_row jsonb,
  after_row jsonb,
  created_at timestamptz not null default now()
);
create index audit_org_time on public.audit_log (organization_id,created_at desc);
create table public.feature_flags (
  organization_id uuid not null references public.organizations,
  flag text not null check (flag in ('customers','revenue','products','payments')),
  enabled boolean not null default false,
  primary key (organization_id,flag)
);
create table public.webhook_events (
  organization_id uuid not null references public.organizations,
  provider_id text not null,
  kind text not null check (kind in ('payment','invoice')),
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (organization_id,provider_id,kind,event_id)
);

create schema d2r_private;
revoke all on schema d2r_private from public;
grant usage on schema d2r_private to authenticated;
create function d2r_private.can_access(target uuid, require_write boolean default false)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m where m.organization_id = target and m.user_id = (select auth.uid())
      and (not require_write or m.role in ('owner','editor'))
      and (select auth.jwt()->>'aal') = 'aal2'
  );
$$;
revoke all on function d2r_private.can_access(uuid,boolean) from public;
grant execute on function d2r_private.can_access(uuid,boolean) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['organizations','memberships','projects','suppliers','subscriptions','provider_accounts','exchange_rates','charges','cost_allocations','invoices','reconciliation_matches','cost_events','sync_runs','notifications','audit_log','feature_flags','webhook_events'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from anon,authenticated,service_role',table_name);
  end loop;
  foreach table_name in array array['projects','suppliers','subscriptions','provider_accounts','exchange_rates','charges','cost_allocations','invoices','reconciliation_matches','sync_runs','notifications','audit_log','feature_flags'] loop
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('create policy member_read on public.%I for select to authenticated using (d2r_private.can_access(organization_id))',table_name);
  end loop;
  foreach table_name in array array['projects','suppliers','subscriptions'] loop
    execute format('grant insert on public.%I to authenticated',table_name);
    execute format('create policy member_insert on public.%I for insert to authenticated with check (d2r_private.can_access(organization_id,true))',table_name);
  end loop;
end $$;
grant select on public.organizations,public.memberships to authenticated;
create policy org_read on public.organizations for select to authenticated using (d2r_private.can_access(id));
create policy own_membership on public.memberships for select to authenticated using (user_id = (select auth.uid()));
grant select on public.provider_accounts to service_role;
grant select,insert,update on public.sync_runs to service_role;

create function d2r_private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare old_row jsonb; new_row jsonb;
begin
  if tg_op <> 'INSERT' then old_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_row := to_jsonb(new); end if;
  insert into public.audit_log(organization_id,actor_id,entity,operation,before_row,after_row)
    values (coalesce(new_row->>'organization_id',old_row->>'organization_id',new_row->>'id',old_row->>'id')::uuid,
            auth.uid(),tg_table_name,tg_op,old_row,new_row);
  return coalesce(new,old);
end $$;
revoke all on function d2r_private.audit_change() from public;
do $$
declare table_name text;
begin
  foreach table_name in array array['organizations','memberships','projects','suppliers','subscriptions','provider_accounts','charges','invoices','cost_allocations','reconciliation_matches','feature_flags'] loop
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function d2r_private.audit_change()',table_name);
  end loop;
end $$;

create function public.create_manual_charge(
  org uuid, request_key uuid, details text, charge_category text, minor bigint, unit text,
  charge_evidence text, recorded date, supplier uuid default null, project uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare charge_id uuid;
begin
  if not d2r_private.can_access(org,true) then raise exception 'not authorized' using errcode='42501'; end if;
  if charge_evidence not in ('estimate','missing') or minor < 0 then raise exception 'invalid manual charge'; end if;
  insert into public.charges (organization_id,request_id,supplier_id,description,category,amount_minor,currency,evidence,source,recorded_on,amount_ils_minor)
    values(org,request_key,supplier,details,charge_category,minor,unit,charge_evidence,'manual',recorded,
      case when unit='ILS' then minor end)
    on conflict (organization_id,request_id) do nothing returning id into charge_id;
  if charge_id is null then
    select id into charge_id from public.charges where organization_id=org and request_id=request_key;
  elsif project is not null then
    insert into public.cost_allocations values(org,charge_id,project,10000);
  end if;
  return charge_id;
end $$;
revoke all on function public.create_manual_charge from public,anon,service_role;
grant execute on function public.create_manual_charge to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('d2r-invoices','d2r-invoices',false,4194304,array['application/pdf']);
create policy invoice_private_upload on storage.objects for insert to authenticated with check (
  bucket_id='d2r-invoices' and
  case when name ~ '^[0-9a-f-]{36}/[a-f0-9]{64}\.pdf$' then d2r_private.can_access(split_part(name,'/',1)::uuid,true) else false end
);
create policy invoice_private_read on storage.objects for select to authenticated using (
  bucket_id='d2r-invoices' and exists (select 1 from public.invoices i where i.archive_object_key=name)
);
create function public.register_invoice(org uuid, supplier uuid, number text, issued date, minor bigint, unit text, digest text, filename text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invoice_id uuid;
begin
  if not d2r_private.can_access(org,true) then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from storage.objects where bucket_id='d2r-invoices' and name=org::text || '/' || digest || '.pdf') then
    raise exception 'missing source file';
  end if;
  insert into public.invoices(organization_id,supplier_id,invoice_number,issued_on,amount_minor,currency,sha256,original_name)
    values(org,supplier,number,issued,minor,unit,digest,filename)
    on conflict (organization_id,sha256) do nothing returning id into invoice_id;
  if invoice_id is null then select id into invoice_id from public.invoices where organization_id=org and sha256=digest; end if;
  return invoice_id;
end $$;
revoke all on function public.register_invoice from public,anon,service_role;
grant execute on function public.register_invoice to authenticated;

create function public.match_invoice(org uuid, invoice uuid, charge uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; expense public.charges;
begin
  if not d2r_private.can_access(org,true) then raise exception 'not authorized' using errcode='42501'; end if;
  select * into inv from public.invoices where organization_id=org and id=invoice for update;
  select * into expense from public.charges where organization_id=org and id=charge for update;
  if inv.id is null or expense.id is null or expense.amount_minor is null or
     inv.amount_minor <> expense.amount_minor or inv.currency <> expense.currency or inv.supplier_id is distinct from expense.supplier_id then
    raise exception 'invoice and charge differ';
  end if;
  insert into public.reconciliation_matches values(org,charge,invoice,now(),auth.uid())
    on conflict (charge_id) do nothing;
  if not exists (select 1 from public.reconciliation_matches where charge_id=charge and invoice_id=invoice) then
    raise exception 'charge already matched';
  end if;
  update public.invoices set status='matched' where id=invoice and status<>'matched';
  update public.charges set evidence='verified' where id=charge and evidence<>'verified';
end $$;
revoke all on function public.match_invoice from public,anon,service_role;
grant execute on function public.match_invoice to authenticated;

create function public.update_business(org uuid, business_name text, number text, email text, threshold bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not d2r_private.can_access(org,true) or not exists (select 1 from public.memberships where organization_id=org and user_id=auth.uid() and role='owner') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  update public.organizations set name=business_name,business_number=number,contact_email=email,alert_threshold_minor=threshold where id=org;
end $$;
revoke all on function public.update_business from public,anon,service_role;
grant execute on function public.update_business to authenticated;

create function public.ingest_provider_cost(account uuid, event_key text, digest text, event jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare source_account public.provider_accounts; new_event bigint; amount bigint;
begin
  select * into strict source_account from public.provider_accounts where id=account for update;
  insert into public.cost_events(organization_id,provider_account_id,external_key,payload_hash,payload)
    values(source_account.organization_id,account,event_key,digest,event)
    on conflict do nothing returning id into new_event;
  if new_event is null then return; end if;
  amount := (event->>'minor')::bigint;
  insert into public.charges(organization_id,supplier_id,provider_account_id,external_key,description,category,amount_minor,currency,evidence,source,recorded_on,billing_period_start,billing_period_end,amount_ils_minor)
    values(source_account.organization_id,source_account.supplier_id,account,event_key,event->>'label','כלי AI',amount,event->>'currency',
      'provider',source_account.provider,(event->>'start')::date,(event->>'start')::date,(event->>'end')::date,
      case when event->>'currency'='ILS' then amount end)
    on conflict (provider_account_id,external_key) do update set
      amount_minor=excluded.amount_minor, amount_ils_minor=excluded.amount_ils_minor
    where charges.evidence='provider';
  if exists(select 1 from public.charges where provider_account_id=account and external_key=event_key and evidence='verified' and amount_minor<>amount) then
    insert into public.notifications(organization_id,code,reference)
      values(source_account.organization_id,'verified_source_changed',account::text || ':' || event_key) on conflict do nothing;
  end if;
  update public.provider_accounts set last_synced_at=now() where id=account;
end $$;
revoke all on function public.ingest_provider_cost from public,anon,authenticated;
grant execute on function public.ingest_provider_cost to service_role;

commit;
