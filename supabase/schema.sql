-- Mackenzie & Brandon wedding app: database, security and storage setup.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again: it uses "if not exists" and replaces functions and policies.


-- ---------------------------------------------------------------------------
-- Settings (wedding-day unlock time, quiz reveal time)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value text not null
);

insert into public.settings (key, value) values
  ('unlock_at', '2099-01-01T08:00:00-06:00'), -- change to the morning of the wedding
  ('quiz_reveal_at', '2099-01-01T19:00:00-06:00') -- when the quiz leaderboard shows
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Admins (the couple and Codember). Add emails at the bottom of this file.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.is_unlocked() returns boolean
language sql stable security definer set search_path = public as $$
  select now() >= coalesce((select value::timestamptz from public.settings where key = 'unlock_at'), 'infinity'::timestamptz);
$$;

-- ---------------------------------------------------------------------------
-- Guest list: one party per invitation, one row per invited person
-- ---------------------------------------------------------------------------
create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  name text not null,
  role text not null default '',
  is_plus_one boolean not null default false,
  sort int not null default 0
);
create index if not exists guests_party_idx on public.guests(party_id);

create table if not exists public.rsvps (
  party_id uuid primary key references public.parties(id) on delete cascade,
  submitted_by text not null default '',
  song text not null default '',
  note text not null default '',
  submitted_at timestamptz not null default now()
);

create table if not exists public.rsvp_answers (
  guest_id uuid primary key references public.guests(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  attending boolean not null,
  plus_one_name text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Guest content
-- ---------------------------------------------------------------------------
create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  thumb_path text,
  kind text not null check (kind in ('photo', 'video')),
  guest_name text not null default '',
  device_id text not null default '',
  moment text not null default '',
  mission int,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists uploads_created_idx on public.uploads(created_at desc);

create table if not exists public.hearts (
  upload_id uuid not null references public.uploads(id) on delete cascade,
  device_id text not null,
  primary key (upload_id, device_id)
);

create table if not exists public.quiz_answers (
  device_id text not null,
  guest_name text not null default '',
  q_index int not null,
  answer int not null,
  created_at timestamptz not null default now(),
  primary key (device_id, q_index)
);

create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  guest_name text not null default '',
  prompt text not null default '',
  capsule boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null default '',
  amount numeric(10, 2) not null check (amount > 0 and amount < 100000),
  method text not null default '',
  what text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_key (
  q_index int primary key,
  correct int not null
);

-- ---------------------------------------------------------------------------
-- Row level security: guests never read tables directly except the gallery
-- ---------------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.admins enable row level security;
alter table public.parties enable row level security;
alter table public.guests enable row level security;
alter table public.rsvps enable row level security;
alter table public.rsvp_answers enable row level security;
alter table public.uploads enable row level security;
alter table public.hearts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.wishes enable row level security;
alter table public.gifts enable row level security;
alter table public.quiz_key enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','admins','parties','guests','rsvps','rsvp_answers','uploads','hearts','quiz_answers','wishes','gifts','quiz_key'] loop
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Gallery: anyone with the link can see visible photos once the day starts
drop policy if exists uploads_read on public.uploads;
create policy uploads_read on public.uploads for select to anon, authenticated
  using (hidden = false and public.is_unlocked());

drop policy if exists uploads_insert on public.uploads;
create policy uploads_insert on public.uploads for insert to anon, authenticated
  with check (public.is_unlocked() and hidden = false and length(path) < 300);

drop policy if exists hearts_read on public.hearts;
create policy hearts_read on public.hearts for select to anon, authenticated using (true);
drop policy if exists hearts_insert on public.hearts;
create policy hearts_insert on public.hearts for insert to anon, authenticated with check (length(device_id) between 8 and 64);

drop policy if exists wishes_insert on public.wishes;
create policy wishes_insert on public.wishes for insert to anon, authenticated with check (length(path) < 300);

drop policy if exists gifts_insert on public.gifts;
create policy gifts_insert on public.gifts for insert to anon, authenticated with check (true);

drop policy if exists quiz_insert on public.quiz_answers;
create policy quiz_insert on public.quiz_answers for insert to anon, authenticated with check (length(device_id) between 8 and 64);

-- ---------------------------------------------------------------------------
-- Functions guests call
-- ---------------------------------------------------------------------------
create or replace function public.public_settings() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'unlock_at', (select value from settings where key = 'unlock_at'),
    'quiz_reveal_at', (select value from settings where key = 'quiz_reveal_at'),
    'now', now()
  );
$$;

-- Find an invitation by name. Needs 3+ letters; returns at most 5 invitations.
create or replace function public.find_invitation(q text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  term text := lower(trim(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g')));
  result json;
begin
  if length(term) < 3 then return '[]'::json; end if;
  select coalesce(json_agg(p order by p.match_name), '[]'::json) into result
  from (
    select distinct on (pa.id)
      pa.id as party_id,
      g.name as match_name,
      (select json_agg(json_build_object(
          'id', m.id, 'name', m.name, 'role', m.role, 'plus', m.is_plus_one,
          'attending', ra.attending, 'plus_one_name', coalesce(ra.plus_one_name, '')
        ) order by m.sort, m.is_plus_one, m.name)
       from guests m left join rsvp_answers ra on ra.guest_id = m.id
       where m.party_id = pa.id) as members,
      exists (select 1 from rsvps r where r.party_id = pa.id) as responded
    from parties pa
    join guests g on g.party_id = pa.id and not g.is_plus_one
    where lower(g.name) like term || '%'
       or lower(g.name) like '% ' || term || '%'
    order by pa.id, g.name
    limit 5
  ) p;
  return result;
end;
$$;

-- Save an RSVP. Only people on that invitation can be answered for.
create or replace function public.submit_rsvp(p_party uuid, p_answers json, p_by text, p_song text, p_note text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  a json;
  gid uuid;
  going int := 0;
  total int;
begin
  if not exists (select 1 from parties where id = p_party) then
    raise exception 'invitation not found';
  end if;
  select count(*) into total from guests where party_id = p_party;
  for a in select * from json_array_elements(p_answers) loop
    gid := (a ->> 'guest_id')::uuid;
    if not exists (select 1 from guests where id = gid and party_id = p_party) then
      raise exception 'guest is not on this invitation';
    end if;
    insert into rsvp_answers (guest_id, party_id, attending, plus_one_name, updated_at)
    values (gid, p_party, (a ->> 'attending')::boolean, left(coalesce(a ->> 'plus_one_name', ''), 120), now())
    on conflict (guest_id) do update set attending = excluded.attending, plus_one_name = excluded.plus_one_name, updated_at = now();
    if (a ->> 'attending')::boolean then going := going + 1; end if;
  end loop;
  insert into rsvps (party_id, submitted_by, song, note, submitted_at)
  values (p_party, left(coalesce(p_by, ''), 120), left(coalesce(p_song, ''), 200), left(coalesce(p_note, ''), 2000), now())
  on conflict (party_id) do update set submitted_by = excluded.submitted_by, song = excluded.song, note = excluded.note, submitted_at = now();
  return json_build_object('going', going, 'total', total);
end;
$$;

-- Save a quiz answer (one answer per question per phone)
create or replace function public.answer_quiz(p_device text, p_name text, p_q int, p_answer int) returns void
language sql security definer set search_path = public as $$
  insert into quiz_answers (device_id, guest_name, q_index, answer)
  values (left(p_device, 64), left(coalesce(p_name, ''), 80), p_q, p_answer)
  on conflict (device_id, q_index) do update set answer = excluded.answer, guest_name = excluded.guest_name;
$$;

-- Leaderboard, only after the reveal time (admins can always see it)
create or replace function public.quiz_leaderboard() returns json
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() or now() >= coalesce((select value::timestamptz from settings where key = 'quiz_reveal_at'), 'infinity'::timestamptz)
  then coalesce((
    select json_agg(x order by x.score desc, x.name) from (
      select qa.device_id, max(qa.guest_name) as name,
             count(*) filter (where qa.answer = k.correct) as score,
             count(*) as answered
      from quiz_answers qa join quiz_key k on k.q_index = qa.q_index
      group by qa.device_id
      order by score desc
      limit 20
    ) x), '[]'::json)
  else null end;
$$;

-- Heart counts for the gallery
create or replace function public.heart_counts() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(upload_id, n), '{}'::json)
  from (select upload_id, count(*) as n from hearts group by upload_id) h;
$$;

grant execute on function public.public_settings() to anon, authenticated;
grant execute on function public.find_invitation(text) to anon, authenticated;
grant execute on function public.submit_rsvp(uuid, json, text, text, text) to anon, authenticated;
grant execute on function public.answer_quiz(text, text, int, int) to anon, authenticated;
grant execute on function public.quiz_leaderboard() to anon, authenticated;
grant execute on function public.heart_counts() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_unlocked() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: "media" for the gallery (public links), "wishes" private to the couple
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 209715200, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = true, file_size_limit = 209715200, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wishes', 'wishes', false, 209715200, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 209715200, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'media' and public.is_unlocked());

drop policy if exists wishes_insert on storage.objects;
create policy wishes_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'wishes');

drop policy if exists storage_admin_all on storage.objects;
create policy storage_admin_all on storage.objects for all to authenticated
  using (bucket_id in ('media', 'wishes') and public.is_admin())
  with check (bucket_id in ('media', 'wishes') and public.is_admin());

-- ---------------------------------------------------------------------------
-- Add the couple and Codember as admins (replace with real emails, then run)
-- ---------------------------------------------------------------------------
-- insert into public.admins (email) values ('mackenzie@example.com'), ('brandon@example.com'), ('info@codember.co') on conflict do nothing;
