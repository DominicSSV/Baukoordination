-- =============================================================================
-- Baukoordination – Bauherrenvertreter nachtragen
--
-- Repariert Konten, die in Supabase Auth angelegt wurden, ohne als
-- Bauherrenvertreter freigeschaltet zu werden. Das passiert, wenn ein Konto
-- entstand, bevor die Liste admin_seed existierte.
--
-- Im Supabase SQL-Editor ausführen. Funktioniert unabhängig davon, ob
-- Migration 0002 schon gelaufen ist, und darf mehrfach ausgeführt werden.
-- =============================================================================

do $$
declare
  hat_profilspalten boolean;
begin
  -- 1. Grundeintrag für alle drei Adressen, sofern das Auth-Konto existiert.
  insert into public.admins (user_id, name, email)
  select
    u.id,
    case lower(u.email)
      when 'dominic.maag@swiss-sv.ch' then 'Dominic Maag'
      when 'm.maerki@swiss-sv.ch'     then 'Maurice Märki'
      when 'v.gantner@swiss-sv.ch'    then 'Valentin Gantner'
      else split_part(u.email, '@', 1)
    end,
    u.email
  from auth.users u
  where lower(u.email) in (
    'dominic.maag@swiss-sv.ch',
    'm.maerki@swiss-sv.ch',
    'v.gantner@swiss-sv.ch'
  )
  on conflict (user_id) do nothing;

  -- 2. Namen und Profil nachziehen – die Spalten gibt es erst ab Migration 0002.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admins'
      and column_name = 'funktion'
  ) into hat_profilspalten;

  if hat_profilspalten then
    update public.admins a
    set firma = 'Swiss Solar Ventures AG',
        name = case lower(a.email)
                 when 'dominic.maag@swiss-sv.ch' then 'Dominic Maag'
                 when 'm.maerki@swiss-sv.ch'     then 'Maurice Märki'
                 when 'v.gantner@swiss-sv.ch'    then 'Valentin Gantner'
                 else a.name
               end,
        funktion = case lower(a.email)
                     when 'dominic.maag@swiss-sv.ch' then 'Projektmanagement'
                     when 'm.maerki@swiss-sv.ch'     then 'CEO'
                     when 'v.gantner@swiss-sv.ch'    then 'Administration'
                     else a.funktion
                   end
    where lower(a.email) in (
      'dominic.maag@swiss-sv.ch',
      'm.maerki@swiss-sv.ch',
      'v.gantner@swiss-sv.ch'
    );
  else
    update public.admins a
    set name = case lower(a.email)
                 when 'dominic.maag@swiss-sv.ch' then 'Dominic Maag'
                 when 'm.maerki@swiss-sv.ch'     then 'Maurice Märki'
                 when 'v.gantner@swiss-sv.ch'    then 'Valentin Gantner'
                 else a.name
               end
    where lower(a.email) in (
      'dominic.maag@swiss-sv.ch',
      'm.maerki@swiss-sv.ch',
      'v.gantner@swiss-sv.ch'
    );
  end if;
end $$;

-- Ergebnis zur Kontrolle: Wer hat ein Konto, und wer ist freigeschaltet?
select
  u.email                                        as konto,
  case when a.user_id is null then 'NEIN' else 'ja' end as freigeschaltet,
  a.name                                         as angezeigter_name
from auth.users u
left join public.admins a on a.user_id = u.id
order by u.created_at;
