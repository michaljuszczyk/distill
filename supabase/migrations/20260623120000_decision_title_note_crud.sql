-- 20260623120000_decision_title_note_crud.sql
-- Completes CRUD on decisions. The original migration deliberately left the
-- decision *artifact* immutable (it is a frozen record of a reasoning session)
-- and deferred UPDATE/DELETE. This adds two user-owned, mutable metadata
-- columns and the matching policies:
--   - title: a user-editable label for scanning the list
--   - note:  a follow-up the user records later (what they decided / outcome)
-- The AI artifact stays immutable — the PATCH handler whitelists only
-- title/note, so UPDATE never touches artifact/summary/description/technique.

-- Length bounds mirror the API's zod limits, as defense-in-depth: even a writer
-- that bypassed the PATCH handler cannot store oversize values.
alter table public.decisions
  add column title text not null default '' check (char_length(title) <= 200),
  add column note text not null default '' check (char_length(note) <= 2000);

create policy decisions_update_own
  on public.decisions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy decisions_delete_own
  on public.decisions
  for delete
  to authenticated
  using (auth.uid() = user_id);
