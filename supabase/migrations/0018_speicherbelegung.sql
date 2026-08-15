-- =============================================================================
-- Baukoordination – Migration 18: Speicherbelegung aus erster Hand
--
-- Die App zeigt der Swiss Solar Ventures AG, wie voll der Speicher ist. Bisher
-- zählte sie die Dateien selbst zusammen. Supabase führt darüber aber schon
-- Buch – dieselbe Quelle, aus der auch das Dashboard seine Zahl nimmt. Diese
-- Migration macht sie für die App lesbar.
--
-- Zusätzlich die Grösse der Datenbank: Sie hat bei Supabase ein eigenes
-- Kontingent neben dem Dateispeicher und läuft sonst unbemerkt voll.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Hängt an keiner früheren Migration.
-- =============================================================================

-- 1) Belegung je Speicherbereich ----------------------------------------------
--
-- storage.get_size_by_bucket() gehört zu Supabase selbst. Der Umweg über eine
-- eigene Funktion ist nötig, weil das storage-Schema von aussen nicht
-- abgefragt werden kann.
create or replace function public.speicher_pro_bucket()
returns table (bucket text, bytes bigint)
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  return query
    select b.bucket_id::text, b.size::bigint
    from storage.get_size_by_bucket() as b;
exception
  -- Sollte Supabase die Funktion einmal umbenennen, bleibt die Ansicht
  -- bedienbar: Die App fällt dann auf ihre eigene Zählung zurück.
  when undefined_function or undefined_table then
    return;
end;
$$;

-- 2) Grösse der Datenbank -----------------------------------------------------
create or replace function public.datenbank_groesse()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

-- 3) Rechte -------------------------------------------------------------------
--
-- Beide Funktionen laufen mit den Rechten ihres Besitzers und dürfen deshalb
-- nur vom Server aufgerufen werden. Angemeldete Personen und Lieferanten
-- kommen nicht heran – die Prüfung auf die Swiss Solar Ventures AG macht die
-- API-Route, aufgerufen wird hier ausschliesslich mit dem Dienstschlüssel.
revoke all on function public.speicher_pro_bucket() from public, anon, authenticated;
revoke all on function public.datenbank_groesse() from public, anon, authenticated;
grant execute on function public.speicher_pro_bucket() to service_role;
grant execute on function public.datenbank_groesse() to service_role;

comment on function public.speicher_pro_bucket() is
  'Belegung je Speicherbereich, wie Supabase sie selbst führt. Nur für den Server.';
comment on function public.datenbank_groesse() is
  'Grösse der Datenbank in Bytes – eigenes Kontingent neben dem Dateispeicher.';
