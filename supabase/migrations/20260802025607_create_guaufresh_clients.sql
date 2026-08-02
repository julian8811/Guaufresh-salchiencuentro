create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  local_id text not null,
  full_name text not null,
  phone text not null unique,
  email text,
  city text,
  neighborhood text,
  pet_name text,
  pet_species text,
  pet_breed text,
  pet_size text,
  presentation text,
  interest text,
  club text,
  commercial_status text not null default 'nuevo',
  coupon text,
  consent_marketing boolean not null default false,
  consent_privacy boolean not null default false,
  consent_version text,
  consent_accepted_at timestamptz,
  attribution jsonb not null default '{}'::jsonb,
  raw_record jsonb not null default '{}'::jsonb,
  visits integer not null default 1 check (visits > 0),
  first_seen_at timestamptz not null default now(),
  last_interaction_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_email_idx
  on public.clients (lower(email))
  where email is not null and email <> '';

create index if not exists clients_created_at_idx on public.clients (created_at desc);
create index if not exists clients_local_id_idx on public.clients (local_id);
create index if not exists clients_interest_idx on public.clients (interest);
create index if not exists clients_city_idx on public.clients (city);

alter table public.clients enable row level security;

revoke all on table public.clients from anon, authenticated;

create table if not exists public.client_submission_windows (
  fingerprint text not null,
  window_start timestamptz not null,
  attempts integer not null default 1,
  primary key (fingerprint, window_start)
);

alter table public.client_submission_windows enable row level security;
revoke all on table public.client_submission_windows from anon, authenticated;

create or replace function public.allow_client_submission(
  p_fingerprint text,
  p_limit integer default 12
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_window timestamptz := date_trunc('hour', now());
  current_attempts integer;
begin
  insert into public.client_submission_windows (fingerprint, window_start, attempts)
  values (p_fingerprint, current_window, 1)
  on conflict (fingerprint, window_start)
  do update set attempts = public.client_submission_windows.attempts + 1
  returning attempts into current_attempts;

  return current_attempts <= greatest(p_limit, 1);
end;
$$;

revoke all on function public.allow_client_submission(text, integer) from public, anon, authenticated;
grant execute on function public.allow_client_submission(text, integer) to service_role;

create or replace function public.upsert_guaufresh_client(p_record jsonb)
returns uuid
language sql
security invoker
set search_path = public
as $$
  insert into public.clients (
    local_id,
    full_name,
    phone,
    email,
    city,
    neighborhood,
    pet_name,
    pet_species,
    pet_breed,
    pet_size,
    presentation,
    interest,
    club,
    commercial_status,
    coupon,
    consent_marketing,
    consent_privacy,
    consent_version,
    consent_accepted_at,
    attribution,
    raw_record,
    visits,
    first_seen_at,
    last_interaction_at,
    updated_at
  ) values (
    p_record->>'local_id',
    p_record->>'full_name',
    p_record->>'phone',
    nullif(p_record->>'email', ''),
    nullif(p_record->>'city', ''),
    nullif(p_record->>'neighborhood', ''),
    nullif(p_record->>'pet_name', ''),
    nullif(p_record->>'pet_species', ''),
    nullif(p_record->>'pet_breed', ''),
    nullif(p_record->>'pet_size', ''),
    nullif(p_record->>'presentation', ''),
    nullif(p_record->>'interest', ''),
    nullif(p_record->>'club', ''),
    coalesce(nullif(p_record->>'commercial_status', ''), 'nuevo'),
    nullif(p_record->>'coupon', ''),
    coalesce((p_record->>'consent_marketing')::boolean, false),
    coalesce((p_record->>'consent_privacy')::boolean, false),
    nullif(p_record->>'consent_version', ''),
    coalesce((p_record->>'consent_accepted_at')::timestamptz, now()),
    coalesce(p_record->'attribution', '{}'::jsonb),
    coalesce(p_record->'raw_record', '{}'::jsonb),
    1,
    coalesce((p_record->>'first_seen_at')::timestamptz, now()),
    coalesce((p_record->>'last_interaction_at')::timestamptz, now()),
    now()
  )
  on conflict (phone) do update set
    local_id = excluded.local_id,
    full_name = excluded.full_name,
    email = coalesce(excluded.email, public.clients.email),
    city = coalesce(excluded.city, public.clients.city),
    neighborhood = coalesce(excluded.neighborhood, public.clients.neighborhood),
    pet_name = coalesce(excluded.pet_name, public.clients.pet_name),
    pet_species = coalesce(excluded.pet_species, public.clients.pet_species),
    pet_breed = coalesce(excluded.pet_breed, public.clients.pet_breed),
    pet_size = coalesce(excluded.pet_size, public.clients.pet_size),
    presentation = coalesce(excluded.presentation, public.clients.presentation),
    interest = coalesce(excluded.interest, public.clients.interest),
    club = coalesce(excluded.club, public.clients.club),
    commercial_status = excluded.commercial_status,
    coupon = coalesce(excluded.coupon, public.clients.coupon),
    consent_marketing = excluded.consent_marketing,
    consent_privacy = excluded.consent_privacy,
    consent_version = excluded.consent_version,
    consent_accepted_at = excluded.consent_accepted_at,
    attribution = excluded.attribution,
    raw_record = excluded.raw_record,
    visits = public.clients.visits + 1,
    last_interaction_at = excluded.last_interaction_at,
    updated_at = now()
  returning id;
$$;

revoke all on function public.upsert_guaufresh_client(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_guaufresh_client(jsonb) to service_role;
grant select, insert, update on table public.clients to service_role;
grant select, insert, update on table public.client_submission_windows to service_role;

comment on table public.clients is 'Clientes y prospectos registrados desde la landing de GuauFresh.';
comment on column public.clients.raw_record is 'Carga original conservada para trazabilidad del esquema del formulario.';
