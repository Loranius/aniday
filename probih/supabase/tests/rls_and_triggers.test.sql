-- Behavioural tests for triggers and RLS. Any failed assertion raises and aborts (ON_ERROR_STOP).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'profile created for every new user';
end $$;

-- ===== act as user A =====
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true); end $$;

insert into public.vehicles (id, make, model, year, initial_odometer, current_odometer, vin)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Nissan', 'Tiida', 2008, 184000, 999999, 'JN1BC11E08U000001');

do $$ begin
  assert (select current_odometer from public.vehicles) = 184000, 'client cannot set current_odometer';
end $$;

-- trips add to the odometer, duplicates are rejected by PK, invalid trips are excluded
insert into public.trips (id, vehicle_id, started_at, ended_at, distance_km, duration_seconds) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-01 08:00Z', '2026-10-01 08:32Z', 21.3, 1920),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-01 12:00Z', '2026-10-01 12:11Z', 4.7, 660);
insert into public.trips (id, vehicle_id, started_at, ended_at, distance_km)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-01 08:00Z', '2026-10-01 08:32Z', 21.3)
on conflict (id) do nothing;

do $$ begin
  assert (select current_odometer from public.vehicles) = 184026.0, 'odometer = initial + trips (duplicate ignored)';
end $$;

update public.trips set is_valid = false, invalid_reason = 'GPS drift' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$ begin
  assert (select current_odometer from public.vehicles) = 184021.3, 'invalid trip excluded';
end $$;

do $$ begin
  begin
    update public.trips set distance_km = 500 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'distance edit should have failed';
  exception when check_violation then null;
  end;
end $$;

-- odometer correction and manual distance
insert into public.odometer_entries (vehicle_id, kind, value_km, recorded_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'reading', 184500, '2026-10-02 00:00Z'),
       ('aaaaaaaa-0000-0000-0000-000000000001', 'manual_distance', 42, '2026-10-03 00:00Z');
insert into public.trips (id, vehicle_id, started_at, ended_at, distance_km)
values ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-03 09:00Z', '2026-10-03 09:20Z', 10);
do $$ begin
  assert (select current_odometer from public.vehicles) = 184552.0, 'reading is the new baseline';
end $$;

update public.vehicles set initial_odometer = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  assert (select current_odometer from public.vehicles) = 184552.0, 'initial ignored once a reading exists';
end $$;

-- maintenance: last service derived from the latest event
insert into public.maintenance_items (id, vehicle_id, name, interval_km, interval_days, last_service_odometer)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Моторне масло', 10000, 365, 1);
do $$ begin
  assert (select last_service_odometer from public.maintenance_items) is null, 'client cannot set last service';
end $$;
insert into public.maintenance_events (vehicle_id, maintenance_item_id, date, odometer, cost) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-03-01', 178000, 1850),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-09-20', 184000, 1900);
do $$ begin
  assert (select last_service_odometer from public.maintenance_items) = 184000, 'latest event wins';
  assert (select current_status from public.maintenance_item_status) = 'ok', 'status view works';
end $$;
delete from public.maintenance_events where date = '2026-09-20';
do $$ begin
  assert (select last_service_odometer from public.maintenance_items) = 178000, 'recalculated after delete';
end $$;

insert into public.fuel_entries (vehicle_id, date, odometer, liters, total_cost)
values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-01', 184020, 40, 2300);
insert into public.saved_places (name, latitude, longitude) values ('Дім', 50.45, 30.52);
insert into public.vehicle_locations (vehicle_id, latitude, longitude) values ('aaaaaaaa-0000-0000-0000-000000000001', 50.45, 30.52);
insert into public.trip_points (trip_id, seq, recorded_at, latitude, longitude)
values ('bbbbbbbb-0000-0000-0000-000000000001', 0, '2026-10-01 08:00Z', 50.45, 30.52);

-- ===== act as user B: sees nothing of A, cannot write into A's vehicle =====
do $$ begin perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true); end $$;
do $$ begin
  assert (select count(*) from public.vehicles) = 0, 'B cannot see A vehicles';
  assert (select count(*) from public.trips) = 0, 'B cannot see A trips';
  assert (select count(*) from public.trip_points) = 0, 'B cannot see A trip points';
  assert (select count(*) from public.vehicle_locations) = 0, 'B cannot see A locations';
  assert (select count(*) from public.maintenance_items) = 0, 'B cannot see A maintenance';
  assert (select count(*) from public.maintenance_events) = 0, 'B cannot see A maintenance events';
  assert (select count(*) from public.fuel_entries) = 0, 'B cannot see A fuel';
  assert (select count(*) from public.saved_places) = 0, 'B cannot see A places';
  assert (select count(*) from public.odometer_entries) = 0, 'B cannot see A odometer entries';
  assert (select count(*) from public.profiles) = 1, 'B sees only own profile';
  assert (select count(*) from public.maintenance_item_status) = 0, 'status view respects RLS';
end $$;

do $$ begin
  begin
    insert into public.trips (id, vehicle_id, started_at, ended_at, distance_km)
    values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', now(), now(), 1000);
    raise exception 'B inserted a trip into A vehicle';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.vehicles (user_id, make, model) values ('11111111-1111-1111-1111-111111111111', 'X', 'Y');
    raise exception 'B created a vehicle for A';
  exception when insufficient_privilege then null;
  end;
end $$;

update public.vehicles set make = 'hacked';
delete from public.trips;

-- ===== anon: nothing at all =====
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.vehicles;
    raise exception 'anon can read vehicles';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select make from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'Nissan', 'B could not update A';
  assert (select count(*) from public.trips) = 3, 'B could not delete A trips';
end $$;

-- cascade: deleting the vehicle removes everything that belongs to it
delete from public.vehicles;
do $$ begin
  assert (select count(*) from public.trips) = 0 and (select count(*) from public.trip_points) = 0
     and (select count(*) from public.maintenance_events) = 0 and (select count(*) from public.fuel_entries) = 0,
     'vehicle delete cascades';
end $$;

rollback;
\echo 'ALL DATABASE TESTS PASSED'
