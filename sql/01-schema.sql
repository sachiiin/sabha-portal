-- 01-schema.sql
-- Run this first in the Supabase SQL editor.

create table mandirs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ghar_name text not null,
  city text,
  created_at timestamptz default now()
);

create table settings (
  mandir_id uuid primary key references mandirs(id) on delete cascade,
  thursday_anchor date not null,
  sunday_enabled boolean default true,
  followup_threshold int default 65
);

-- Named app_users, not users — `users` collides with Supabase's own
-- auth.users and produces confusing errors.
create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  mandir_id uuid references mandirs(id) on delete cascade,
  full_name text not null,
  role text not null default 'sevak' check (role in ('sevak','admin')),
  created_at timestamptz default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  mandir_id uuid references mandirs(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  mandal text default 'yuvak' check (mandal in ('bal','kishore','yuvak','adult','senior')),
  is_sevak boolean default false,
  is_active boolean default true,
  joined_date date default current_date,
  created_at timestamptz default now()
);

create table sabhas (
  id uuid primary key default gen_random_uuid(),
  mandir_id uuid references mandirs(id) on delete cascade,
  sabha_date date not null,
  sabha_type text not null check (sabha_type in ('sunday','thursday')),
  topic text,
  conducted_by uuid references members(id) on delete set null,
  notes text,
  is_cancelled boolean default false,
  created_at timestamptz default now(),
  unique (mandir_id, sabha_date)
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  sabha_id uuid references sabhas(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  status text not null check (status in ('present','absent','late','excused')),
  reason text,
  marked_by uuid references app_users(id) on delete set null,
  marked_at timestamptz default now(),
  unique (sabha_id, member_id)
);

create index idx_members_mandir on members (mandir_id) where is_active;
create index idx_sabhas_mandir_date on sabhas (mandir_id, sabha_date desc);
create index idx_attendance_sabha on attendance (sabha_id);
create index idx_attendance_member on attendance (member_id);
