-- 20260528082724_create_decisions.sql
-- First migration. Creates decisions table for Distill MVP.
-- Single JSONB artifact column (5 sections). RLS-isolated per owner.
-- UPDATE/DELETE intentionally have no policy (MVP immutability).

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  summary text not null default '',
  artifact jsonb not null,
  anti_bias_technique text not null
    check (anti_bias_technique in ('devils_advocate','pre_mortem','unknown_unknowns')),
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index decisions_user_id_created_at_idx
  on public.decisions (user_id, created_at desc);

alter table public.decisions enable row level security;

revoke all on public.decisions from anon;

create policy decisions_select_own
  on public.decisions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy decisions_insert_own
  on public.decisions
  for insert
  to authenticated
  with check (auth.uid() = user_id);
