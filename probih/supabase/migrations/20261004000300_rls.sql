-- Row Level Security: every table is private to its owner. Nothing is readable by anon.

alter table public.profiles           enable row level security;
alter table public.vehicles           enable row level security;
alter table public.odometer_entries   enable row level security;
alter table public.saved_places       enable row level security;
alter table public.trips              enable row level security;
alter table public.trip_points        enable row level security;
alter table public.vehicle_locations  enable row level security;
alter table public.maintenance_items  enable row level security;
alter table public.maintenance_events enable row level security;
alter table public.fuel_entries       enable row level security;

revoke all on all tables in schema public from anon;
revoke all on public.maintenance_item_status from anon;
revoke execute on function public.calculate_vehicle_odometer(uuid, numeric) from anon, public;

-- Profiles ------------------------------------------------------------------
create policy "profiles: own select" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles: own update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Directly user-owned tables ---------------------------------------------------
create policy "vehicles: own select" on public.vehicles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "vehicles: own insert" on public.vehicles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "vehicles: own update" on public.vehicles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "vehicles: own delete" on public.vehicles for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "saved_places: own select" on public.saved_places for select to authenticated
  using (user_id = (select auth.uid()));
create policy "saved_places: own insert" on public.saved_places for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "saved_places: own update" on public.saved_places for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "saved_places: own delete" on public.saved_places for delete to authenticated
  using (user_id = (select auth.uid()));

-- Vehicle-owned tables: the vehicle must belong to the caller ------------------
do $$
declare
  t text;
begin
  foreach t in array array['odometer_entries', 'trips', 'vehicle_locations', 'maintenance_items', 'maintenance_events', 'fuel_entries']
  loop
    execute format(
      'create policy "%1$s: own select" on public.%1$I for select to authenticated
         using (vehicle_id in (select v.id from public.vehicles v where v.user_id = (select auth.uid())))', t);
    execute format(
      'create policy "%1$s: own insert" on public.%1$I for insert to authenticated
         with check (vehicle_id in (select v.id from public.vehicles v where v.user_id = (select auth.uid())))', t);
    execute format(
      'create policy "%1$s: own update" on public.%1$I for update to authenticated
         using (vehicle_id in (select v.id from public.vehicles v where v.user_id = (select auth.uid())))
         with check (vehicle_id in (select v.id from public.vehicles v where v.user_id = (select auth.uid())))', t);
    execute format(
      'create policy "%1$s: own delete" on public.%1$I for delete to authenticated
         using (vehicle_id in (select v.id from public.vehicles v where v.user_id = (select auth.uid())))', t);
  end loop;
end;
$$;

-- Trip points: owned through trip → vehicle. Raw samples are append-only (no update policy).
create policy "trip_points: own select" on public.trip_points for select to authenticated
  using (trip_id in (select t.id from public.trips t join public.vehicles v on v.id = t.vehicle_id
                     where v.user_id = (select auth.uid())));
create policy "trip_points: own insert" on public.trip_points for insert to authenticated
  with check (trip_id in (select t.id from public.trips t join public.vehicles v on v.id = t.vehicle_id
                          where v.user_id = (select auth.uid())));
create policy "trip_points: own delete" on public.trip_points for delete to authenticated
  using (trip_id in (select t.id from public.trips t join public.vehicles v on v.id = t.vehicle_id
                     where v.user_id = (select auth.uid())));
