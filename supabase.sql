-- Plak dit in Supabase > SQL Editor en klik op Run.
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  station_id text not null check (length(station_id) between 1 and 100),
  name text check (length(name) <= 120),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  country text check (length(country) <= 2),
  currency text check (length(currency) <= 3),
  fuel text not null default 'diesel' check (fuel = 'diesel'),
  price numeric(8,3) not null check (price between 0.1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists reports_location_idx on public.reports (lat, lon, created_at desc);

alter table public.reports enable row level security;

-- Iedereen mag meldingen lezen en toevoegen, niemand mag ze wijzigen of verwijderen.
drop policy if exists "meldingen lezen" on public.reports;
create policy "meldingen lezen" on public.reports for select to anon, authenticated using (true);
drop policy if exists "meldingen toevoegen" on public.reports;
create policy "meldingen toevoegen" on public.reports for insert to anon, authenticated
  with check (created_at between now() - interval '1 minute' and now() + interval '1 minute');
