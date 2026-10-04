-- Пробіг — core schema.
-- Conventions: every row belongs (directly or through a vehicle) to auth.users;
-- ids of offline-created rows are generated on the client (UUID) so that re-sync is idempotent.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Vehicles (one per user for now; schema allows many)
-- ---------------------------------------------------------------------------
create table public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- VIN identifies the car. It does NOT provide a location.
  -- Relaxed format: 17-char VIN or a JDM frame number like "NT31-123456".
  vin              text check (vin ~ '^[A-Z0-9-]{5,20}$'),
  license_plate    text check (char_length(license_plate) between 1 and 16),
  make             text not null check (char_length(make) between 1 and 60),
  model            text not null check (char_length(model) between 1 and 60),
  year             integer check (year between 1900 and 2100),
  engine           text check (char_length(engine) <= 60),
  transmission     text check (transmission in ('manual', 'automatic', 'cvt', 'robot')),
  fuel_type        text not null default 'petrol'
                     check (fuel_type in ('petrol', 'diesel', 'lpg', 'cng', 'hybrid', 'electric')),
  initial_odometer numeric(10, 1) not null default 0 check (initial_odometer >= 0 and initial_odometer < 10000000),
  -- Derived cache. Always overwritten by trigger; see calculate_vehicle_odometer().
  current_odometer numeric(10, 1) not null default 0,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index vehicles_user_id_idx on public.vehicles (user_id);
create unique index vehicles_user_vin_key on public.vehicles (user_id, vin) where vin is not null;

-- ---------------------------------------------------------------------------
-- Odometer audit trail (corrections and manually added distance)
-- ---------------------------------------------------------------------------
create table public.odometer_entries (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles (id) on delete cascade,
  kind        text not null check (kind in ('reading', 'manual_distance')),
  value_km    numeric(10, 1) not null check (value_km >= 0 and value_km < 10000000),
  recorded_at timestamptz not null default now(),
  note        text check (char_length(note) <= 500),
  created_at  timestamptz not null default now()
);
create index odometer_entries_vehicle_recorded_idx on public.odometer_entries (vehicle_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Saved places
-- ---------------------------------------------------------------------------
create table public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  icon       text not null default '📍' check (char_length(icon) <= 16),
  latitude   double precision not null check (latitude between -90 and 90),
  longitude  double precision not null check (longitude between -180 and 180),
  address    text check (char_length(address) <= 300),
  radius_m   integer not null default 150 check (radius_m between 20 and 2000),
  is_demo    boolean not null default false,
  created_at timestamptz not null default now()
);
create index saved_places_user_id_idx on public.saved_places (user_id);

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------
create table public.trips (
  -- No default: the id is generated on the device before the trip is queued for sync.
  id               uuid primary key,
  vehicle_id       uuid not null references public.vehicles (id) on delete cascade,
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  start_lat        double precision check (start_lat between -90 and 90),
  start_lng        double precision check (start_lng between -180 and 180),
  end_lat          double precision check (end_lat between -90 and 90),
  end_lng          double precision check (end_lng between -180 and 180),
  distance_km      numeric(9, 3) not null default 0 check (distance_km >= 0 and distance_km < 5000),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  average_speed    numeric(6, 1) check (average_speed >= 0),
  max_speed        numeric(6, 1) check (max_speed >= 0),
  route_geometry   jsonb check (route_geometry is null or route_geometry ->> 'type' = 'LineString'),
  start_place_id   uuid references public.saved_places (id) on delete set null,
  end_place_id     uuid references public.saved_places (id) on delete set null,
  notes            text check (char_length(notes) <= 1000),
  is_valid         boolean not null default true,
  invalid_reason   text check (char_length(invalid_reason) <= 200),
  source           text not null default 'phone' check (source in ('phone', 'obd', 'gps_tracker', 'manual')),
  created_at       timestamptz not null default now(),
  constraint trips_time_order check (ended_at >= started_at),
  -- Second line of defence against the same trip uploaded under two ids.
  constraint trips_vehicle_started_key unique (vehicle_id, started_at)
);
create index trips_vehicle_started_idx on public.trips (vehicle_id, started_at desc);
create index trips_vehicle_ended_valid_idx on public.trips (vehicle_id, ended_at) where is_valid;
create index trips_start_place_idx on public.trips (start_place_id) where start_place_id is not null;
create index trips_end_place_idx on public.trips (end_place_id) where end_place_id is not null;

-- Raw GPS samples of a trip (audit / re-processing). The UI draws route_geometry.
create table public.trip_points (
  trip_id     uuid not null references public.trips (id) on delete cascade,
  seq         integer not null check (seq >= 0),
  recorded_at timestamptz not null,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  speed       real check (speed >= 0),
  heading     real,
  accuracy    real check (accuracy >= 0),
  primary key (trip_id, seq)
);
create index trip_points_recorded_idx on public.trip_points (trip_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Live / last known location, from any source (phone now; OBD / tracker later)
-- ---------------------------------------------------------------------------
create table public.vehicle_locations (
  id         bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  latitude   double precision not null check (latitude between -90 and 90),
  longitude  double precision not null check (longitude between -180 and 180),
  speed      real check (speed >= 0),
  heading    real,
  accuracy   real check (accuracy >= 0),
  source     text not null default 'phone' check (source in ('phone', 'obd', 'gps_tracker', 'manual'))
);
create index vehicle_locations_vehicle_ts_idx on public.vehicle_locations (vehicle_id, "timestamp" desc);

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------
create table public.maintenance_items (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid not null references public.vehicles (id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 80),
  icon                  text not null default '🔧' check (char_length(icon) <= 16),
  category              text not null default 'other'
                          check (category in ('engine', 'filters', 'fluids', 'brakes', 'ignition', 'electrical', 'tires', 'other')),
  interval_km           integer check (interval_km > 0 and interval_km <= 1000000),
  interval_days         integer check (interval_days > 0 and interval_days <= 7300),
  -- Derived from maintenance_events by trigger; client writes are ignored.
  last_service_odometer numeric(10, 1),
  last_service_date     date,
  notes                 text check (char_length(notes) <= 1000),
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint maintenance_items_has_interval check (interval_km is not null or interval_days is not null),
  constraint maintenance_items_id_vehicle_key unique (id, vehicle_id)
);
create index maintenance_items_vehicle_idx on public.maintenance_items (vehicle_id);

create table public.maintenance_events (
  id                  uuid primary key default gen_random_uuid(),
  vehicle_id          uuid not null references public.vehicles (id) on delete cascade,
  maintenance_item_id uuid not null,
  date                date not null,
  odometer            numeric(10, 1) not null check (odometer >= 0 and odometer < 10000000),
  cost                numeric(12, 2) check (cost >= 0),
  provider            text check (char_length(provider) <= 120),
  notes               text check (char_length(notes) <= 1000),
  created_at          timestamptz not null default now(),
  -- The item must belong to the same vehicle as the event.
  constraint maintenance_events_item_fk foreign key (maintenance_item_id, vehicle_id)
    references public.maintenance_items (id, vehicle_id) on delete cascade
);
create index maintenance_events_vehicle_date_idx on public.maintenance_events (vehicle_id, date desc);
create index maintenance_events_item_date_idx on public.maintenance_events (maintenance_item_id, date desc, odometer desc);
create index maintenance_events_vehicle_odometer_idx on public.maintenance_events (vehicle_id, odometer);

-- ---------------------------------------------------------------------------
-- Fuel
-- ---------------------------------------------------------------------------
create table public.fuel_entries (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles (id) on delete cascade,
  date            date not null,
  odometer        numeric(10, 1) not null check (odometer >= 0 and odometer < 10000000),
  liters          numeric(7, 2) not null check (liters > 0 and liters < 1000),
  price_per_liter numeric(8, 2) check (price_per_liter >= 0),
  total_cost      numeric(12, 2) check (total_cost >= 0),
  fuel_type       text not null default 'petrol'
                    check (fuel_type in ('petrol', 'diesel', 'lpg', 'cng', 'hybrid', 'electric')),
  station         text check (char_length(station) <= 120),
  full_tank       boolean not null default true,
  notes           text check (char_length(notes) <= 1000),
  created_at      timestamptz not null default now()
);
create index fuel_entries_vehicle_date_idx on public.fuel_entries (vehicle_id, date desc);
create index fuel_entries_vehicle_odometer_idx on public.fuel_entries (vehicle_id, odometer);
