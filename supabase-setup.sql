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

create policy "public_read"   on public.spots for select using (true);
create policy "owner_insert"  on public.spots for insert with check (auth.uid() = user_id);
create policy "owner_update"  on public.spots for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_delete"  on public.spots for delete using (auth.uid() = user_id);

-- 3. Enable Realtime
alter publication supabase_realtime add table public.spots;

-- 4. Storage bucket (run if you prefer SQL over the dashboard)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('spot-photos', 'spot-photos', true, 20971520, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "photos_public_read" on storage.objects
  for select using (bucket_id = 'spot-photos');

-- Users may only upload into a folder named after their own auth uid (storage.objects.name = '<uid>/...')
create policy "photos_owner_upload" on storage.objects
  for insert with check (
    bucket_id = 'spot-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users may delete only their own uploaded photos (so spot/photo deletion can clean up storage)
create policy "photos_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'spot-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );
