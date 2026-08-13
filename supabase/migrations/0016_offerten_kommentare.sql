-- =============================================================================
-- Baukoordination – Migration 16: Kommentare zu Offerten
--
-- Zu jeder eingereichten Unterlage kann geschrieben werden – von uns und von der
-- Firma, die sie hochgeladen hat. Wer die Datei nicht sehen darf, sieht auch die
-- Kommentare nicht und kann keine schreiben.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt die Migrationen 0012 bis 0015 voraus.
-- =============================================================================

create table if not exists public.file_comments (
  id                 uuid primary key default gen_random_uuid(),
  file_id            uuid not null references public.files(id) on delete cascade,
  text               text not null,
  author             text not null,
  author_supplier_id uuid references public.suppliers(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists file_comments_file_idx
  on public.file_comments (file_id, created_at);

alter table public.file_comments enable row level security;

-- Sichtbar ist ein Kommentar, wenn die Datei sichtbar ist. Die Regel dafür steht
-- an der Datei selbst (Migrationen 0012 bis 0014) und gilt hier automatisch mit.
drop policy if exists file_comments_select on public.file_comments;
create policy file_comments_select on public.file_comments
  for select using (
    exists (select 1 from public.files f where f.id = file_id)
  );

-- Schreiben darf, wer die Datei sieht – im eigenen Namen.
drop policy if exists file_comments_insert on public.file_comments;
create policy file_comments_insert on public.file_comments
  for insert with check (
    exists (select 1 from public.files f where f.id = file_id)
    and (
      public.is_admin()
      or author_supplier_id = public.current_supplier_id()
    )
  );

-- Eigene Kommentare sind löschbar, fremde nur für uns.
drop policy if exists file_comments_delete on public.file_comments;
create policy file_comments_delete on public.file_comments
  for delete using (
    public.is_admin()
    or (author_supplier_id is not null
        and author_supplier_id = public.current_supplier_id())
  );

-- Kontrolle:
--   select f.name, c.author, c.text
--     from public.file_comments c
--     join public.files f on f.id = c.file_id
--    order by c.created_at desc limit 20;
