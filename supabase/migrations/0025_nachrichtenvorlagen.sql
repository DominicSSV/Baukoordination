-- =============================================================================
-- Baukoordination – Migration 25: Nachrichtentexte in der App anpassen
--
-- Die Texte der verschickten Mails standen bisher im Programmcode. Wer eine
-- Formulierung ändern wollte, brauchte einen Entwickler. Neu liegen sie in der
-- Datenbank und lassen sich in der App bearbeiten.
--
-- Gespeichert wird nur, was tatsächlich abgeändert wurde. Fehlt eine Zeile,
-- gilt der Text aus dem Code – so bleibt die App auch dann verständlich, wenn
-- diese Tabelle leer ist oder jemand eine Vorlage löscht.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

create table if not exists public.mail_templates (
  schluessel  text primary key,
  betreff     text not null,
  text        text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.mail_templates enable row level security;

-- Nur wir: Hier steht, was im Namen der Swiss Solar Ventures AG hinausgeht.
drop policy if exists mail_templates_select on public.mail_templates;
create policy mail_templates_select on public.mail_templates
  for select using (public.is_admin());

drop policy if exists mail_templates_insert on public.mail_templates;
create policy mail_templates_insert on public.mail_templates
  for insert with check (public.is_admin());

drop policy if exists mail_templates_update on public.mail_templates;
create policy mail_templates_update on public.mail_templates
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists mail_templates_delete on public.mail_templates;
create policy mail_templates_delete on public.mail_templates
  for delete using (public.is_admin());

comment on table public.mail_templates is
  'Abgeänderte Texte der verschickten Mails. Fehlt ein Eintrag, gilt der Standard aus dem Code.';

-- Kontrolle:
--   select schluessel, betreff, updated_at, updated_by from public.mail_templates;
