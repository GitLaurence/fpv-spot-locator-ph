-- ============================================================
-- FPV Spot Locator PH — Supabase setup
-- Run this in your Supabase SQL Editor (once)
-- ============================================================

-- 1. Spots table
create table if not exists public.spots (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text default '',
  safety      text default '',
  best_time   text default 'any',
  tags        text[] default '{}',
  photos      text[] default '{}',   -- public URLs from Storage
  lat         float8 not null,
  lng         float8 not null,
  date_added  timestamptz default now(),
  user_id     uuid references auth.users(id) on delete set null,

  constraint spots_name_length      check (char_length(name) between 1 and 80),
  constraint spots_description_len  check (char_length(description) <= 1000),
  constraint spots_safety_len       check (char_length(safety) <= 1000),
  constraint spots_best_time_valid  check (best_time in ('any', 'morning', 'afternoon', 'golden-hour')),
  constraint spots_tags_valid       check (tags <@ array['freestyle','racing','long-range','photography']),
  constraint spots_photos_max       check (array_length(photos, 1) is null or array_length(photos, 1) <= 5),
  constraint spots_lat_range        check (lat between -90 and 90),
  constraint spots_lng_range        check (lng between -180 and 180)
);

-- 2. Row Level Security
alter table public.spots enable row level security;

-- Community-maintained map: any authenticated (incl. anonymous) user can
-- read, create, or edit any spot. Only admins can delete spots directly —
-- regular users submit a deletion request instead (see section 5).
create policy "public_read"    on public.spots for select using (true);
create policy "any_user_insert" on public.spots for insert with check (auth.uid() is not null);
create policy "any_user_update" on public.spots for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "admin_delete"   on public.spots for delete using (
  exists (select 1 from public.admins a where a.user_id = auth.uid())
);

-- 3. Enable Realtime
alter publication supabase_realtime add table public.spots;

-- Spam protection: cap how many spots a single user can create per hour.
-- Runs only on insert, so editing existing spots is never throttled.
create or replace function public.enforce_spot_insert_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*) from public.spots
    where user_id = new.user_id
      and date_added > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'Rate limit exceeded: max 20 spots per hour per user.';
  end if;
  return new;
end;
$$;

drop trigger if exists spots_rate_limit on public.spots;
create trigger spots_rate_limit
  before insert on public.spots
  for each row execute function public.enforce_spot_insert_rate_limit();

-- 4. Storage bucket (run if you prefer SQL over the dashboard)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('spot-photos', 'spot-photos', true, 20971520, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "photos_public_read" on storage.objects
  for select using (bucket_id = 'spot-photos');

-- Any authenticated (incl. anonymous) user can upload photos, but only into
-- their own "<user_id>/…" folder (the app always uploads to this path).
create policy "photos_own_upload" on storage.objects
  for insert with check (
    bucket_id = 'spot-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Photo deletion: admins (for spot deletion cleanup) or any user (for
-- replacing/removing photos on edit) — kept open since photos are
-- non-sensitive and paths are randomly generated.
create policy "photos_any_delete" on storage.objects
  for delete using (
    bucket_id = 'spot-photos'
    and auth.uid() is not null
  );

-- ============================================================
-- 5. Admin & deletion-request system
-- ============================================================

-- Admins table: rows here mark a Supabase Auth user as an admin.
-- To create an admin:
--   1. In Supabase dashboard → Authentication → Users → Add user
--      (create with email + password, "Auto Confirm User" checked).
--   2. Copy that user's UUID and run:
--      insert into public.admins (user_id) values ('<uuid-here>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.admins enable row level security;

-- A logged-in user can check whether *they themselves* are an admin
-- (used by the admin dashboard to verify access after login).
create policy "admin_self_check" on public.admins
  for select using (auth.uid() = user_id);

-- Deletion requests: any user can request a spot be removed; only
-- admins can view/manage the request queue.
create table if not exists public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  spot_id      uuid references public.spots(id) on delete cascade,
  spot_name    text not null,
  reason       text default '',
  requested_by uuid references auth.users(id) on delete set null,
  status       text default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  created_at   timestamptz default now(),

  constraint deletion_reason_len check (char_length(reason) <= 500)
);

alter table public.deletion_requests enable row level security;

create policy "request_insert" on public.deletion_requests
  for insert with check (auth.uid() is not null);

create policy "admin_select_requests" on public.deletion_requests
  for select using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy "admin_update_requests" on public.deletion_requests
  for update using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy "admin_delete_requests" on public.deletion_requests
  for delete using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
