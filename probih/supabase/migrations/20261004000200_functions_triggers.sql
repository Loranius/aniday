-- Derived values (odometer, last service) live in the database so every client agrees.

-- ---------------------------------------------------------------------------
-- New user → profile
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Odometer: baseline (latest reading or initial) + valid trips + manual distance after it.
-- Mirrors calculateOdometerBreakdown() in src/domain/odometer.ts.
-- ---------------------------------------------------------------------------
create or replace function public.calculate_vehicle_odometer(p_vehicle_id uuid, p_initial numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base   numeric;
  v_at     timestamptz;
  v_trips  numeric;
  v_manual numeric;
begin
  select e.value_km, e.recorded_at into v_base, v_at
  from public.odometer_entries e
  where e.vehicle_id = p_vehicle_id and e.kind = 'reading'
  order by e.recorded_at desc, e.created_at desc
  limit 1;

  if not found then
    v_base := coalesce(p_initial, 0);
    v_at := '-infinity';
  end if;

  select coalesce(sum(t.distance_km), 0) into v_trips
  from public.trips t
  where t.vehicle_id = p_vehicle_id and t.is_valid and t.ended_at > v_at;

  select coalesce(sum(e.value_km), 0) into v_manual
  from public.odometer_entries e
  where e.vehicle_id = p_vehicle_id and e.kind = 'manual_distance' and e.recorded_at > v_at;

  return round(v_base + v_trips + v_manual, 1);
end;
$$;

-- current_odometer can never be set by a client: it is recomputed on every insert/update.
create or replace function public.vehicles_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.current_odometer := public.calculate_vehicle_odometer(new.id, new.initial_odometer);
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;      -- ownership is immutable
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger vehicles_before_write before insert or update on public.vehicles
  for each row execute function public.vehicles_before_write();

-- Touching the vehicle re-runs vehicles_before_write → odometer recalculated.
create or replace function public.touch_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.vehicles set updated_at = now() where id = old.vehicle_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id) then
    update public.vehicles set updated_at = now() where id = new.vehicle_id;
  end if;
  return null;
end;
$$;

create trigger trips_touch_vehicle
  after insert or delete or update of distance_km, is_valid, ended_at, vehicle_id on public.trips
  for each row execute function public.touch_vehicle_odometer();

create trigger odometer_entries_touch_vehicle
  after insert or update or delete on public.odometer_entries
  for each row execute function public.touch_vehicle_odometer();

-- ---------------------------------------------------------------------------
-- Trips are an audit record: measured data is immutable. Only annotations change.
-- ---------------------------------------------------------------------------
create or replace function public.trips_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vehicle_id is distinct from old.vehicle_id
     or new.started_at is distinct from old.started_at
     or new.ended_at is distinct from old.ended_at
     or new.distance_km is distinct from old.distance_km
     or new.duration_seconds is distinct from old.duration_seconds
     or new.route_geometry is distinct from old.route_geometry
     or new.source is distinct from old.source then
    raise exception 'Measured trip data is immutable; mark the trip invalid instead'
      using errcode = 'check_violation';
  end if;
  if new.is_valid then
    new.invalid_reason := null;
  end if;
  return new;
end;
$$;

create trigger trips_guard_immutable before update on public.trips
  for each row execute function public.trips_guard_immutable();

-- ---------------------------------------------------------------------------
-- Maintenance: last_service_* derived from the latest event of the item.
-- ---------------------------------------------------------------------------
create or replace function public.maintenance_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_odo  numeric;
begin
  select e.date, e.odometer into v_date, v_odo
  from public.maintenance_events e
  where e.maintenance_item_id = new.id
  order by e.date desc, e.odometer desc
  limit 1;

  new.last_service_date := v_date;       -- null when there are no events
  new.last_service_odometer := v_odo;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.vehicle_id := old.vehicle_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger maintenance_items_before_write before insert or update on public.maintenance_items
  for each row execute function public.maintenance_items_before_write();

create or replace function public.touch_maintenance_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.maintenance_items set updated_at = now() where id = old.maintenance_item_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.maintenance_items set updated_at = now() where id = new.maintenance_item_id;
  end if;
  return null;
end;
$$;

create trigger maintenance_events_touch_item
  after insert or update or delete on public.maintenance_events
  for each row execute function public.touch_maintenance_item();

-- ---------------------------------------------------------------------------
-- Status view (server-side counterpart of calculateNextService(); handy for future
-- notifications). Runs with the caller's permissions, so RLS applies.
-- ---------------------------------------------------------------------------
create or replace view public.maintenance_item_status
with (security_invoker = true)
as
with p as (
  select
    i.*,
    v.current_odometer,
    case when i.interval_km is not null and i.last_service_odometer is not null
      then greatest(v.current_odometer - i.last_service_odometer, 0) / i.interval_km end as km_share,
    case when i.interval_days is not null and i.last_service_date is not null
      then greatest(current_date - i.last_service_date, 0)::numeric / i.interval_days end as time_share
  from public.maintenance_items i
  join public.vehicles v on v.id = i.vehicle_id
)
select
  p.id, p.vehicle_id, p.name, p.enabled, p.interval_km, p.interval_days,
  p.last_service_odometer, p.last_service_date,
  p.last_service_odometer + p.interval_km as due_odometer,
  p.last_service_date + p.interval_days as due_date,
  greatest(p.km_share, p.time_share) as progress,
  case
    when greatest(p.km_share, p.time_share) is null then 'unknown'
    when greatest(p.km_share, p.time_share) > 1 then 'overdue'
    when greatest(p.km_share, p.time_share) >= 0.97 then 'due'
    when greatest(p.km_share, p.time_share) >= 0.85 then 'soon'
    else 'ok'
  end as current_status
from p;
