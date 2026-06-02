-- Run this in the Supabase SQL Editor (https://app.supabase.com)

-- 1. Create scores table
create table if not exists scores (
  id text primary key,
  title text not null,
  composer text,
  music_xml_url text not null,
  created_at timestamptz default now()
);

-- 2. YouTube sync columns
alter table scores add column if not exists youtube_url text;
alter table scores add column if not exists sync_points jsonb default '[]'::jsonb;

-- 3. Enable RLS (idempotent)
alter table scores enable row level security;

-- 4. Drop existing policies to avoid conflicts, then recreate
drop policy if exists "Public read" on scores;
drop policy if exists "Public insert" on scores;
drop policy if exists "Public update" on scores;
drop policy if exists "Public delete" on scores;

create policy "Public read"   on scores for select using (true);
create policy "Public insert" on scores for insert with check (true);
create policy "Public update" on scores for update using (true) with check (true);
create policy "Public delete" on scores for delete using (true);

-- 5. Storage bucket policies for music-xml
-- First create the bucket via Dashboard > Storage > New bucket > "music-xml" > Public bucket
-- Then run these storage policies:

insert into storage.buckets (id, name, public)
values ('music-xml', 'music-xml', true)
on conflict (id) do update set public = true;

drop policy if exists "Public upload" on storage.objects;
drop policy if exists "Public read storage" on storage.objects;
drop policy if exists "Public update storage" on storage.objects;
drop policy if exists "Public delete storage" on storage.objects;

create policy "Public read storage"
  on storage.objects for select
  using (bucket_id = 'music-xml');

create policy "Public upload"
  on storage.objects for insert
  with check (bucket_id = 'music-xml');

create policy "Public update storage"
  on storage.objects for update
  using (bucket_id = 'music-xml');

create policy "Public delete storage"
  on storage.objects for delete
  using (bucket_id = 'music-xml');
