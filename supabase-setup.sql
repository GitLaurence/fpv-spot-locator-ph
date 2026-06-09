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
  user_id     uuid references auth.users(id) on delete set null
);

-- 2. Row Level Security
alter table public.spots enable row level security;

create policy "public_read"   on public.spots for select using (true);
create policy "owner_insert"  on public.spots for insert with check (auth.uid() = user_id);
create policy "owner_update"  on public.spots for update using (auth.uid() = user_id);
create policy "owner_delete"  on public.spots for delete using (auth.uid() = user_id);

-- 3. Enable Realtime
alter publication supabase_realtime add table public.spots;

-- 4. Storage bucket (run if you prefer SQL over the dashboard)
insert into storage.buckets (id, name, public)
  values ('spot-photos', 'spot-photos', true)
  on conflict (id) do nothing;

create policy "photos_public_read" on storage.objects
  for select using (bucket_id = 'spot-photos');

create policy "photos_auth_upload" on storage.objects
  for insert with check (bucket_id = 'spot-photos' and auth.role() in ('anon', 'authenticated'));
