-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 2b — calendario de etapas del lanzamiento                          │
-- │                                                                          │
-- │ Una sola fecha-ancla (`launch_date` = fecha de Clase 1) + 4 duraciones   │
-- │ (captación, calentamiento, compra, cierre) determinan toda la ventana   │
-- │ del launch. `date_start` y `date_end` (que en Fase 1 eran inputs        │
-- │ manuales) pasan a ser columnas GENERATED — se calculan en la DB y son   │
-- │ inalterables manualmente. El sync engine de Fase 3 las lee directo.    │
-- │                                                                          │
-- │ Reglas (L = launch_date):                                                │
-- │   date_start = L − dur_captacion          (inicio de captación)         │
-- │   date_end   = L + 2 + dur_compra + dur_cierre  (fin de cierre)         │
-- │                                                                          │
-- │ Las etapas intermedias (calentamiento, consumo, compra) NO se persisten │
-- │ — se derivan en TS al render como los KPIs.                              │
-- │                                                                          │
-- │ Postgres no permite convertir una columna manual a GENERATED in-place,   │
-- │ así que DROP + ADD. Los launches existentes pierden los date_start/end   │
-- │ manuales; backfilleamos launch_date desde el viejo date_start como       │
-- │ placeholder para no perder la fecha por completo.                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Agregar columnas nuevas con defaults sensatos
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  add column if not exists launch_date date,
  add column if not exists dur_captacion     integer not null default 21,
  add column if not exists dur_calentamiento integer not null default 14,
  add column if not exists dur_compra        integer not null default 5,
  add column if not exists dur_cierre        integer not null default 3;

-- Las duraciones tienen que ser >= 0 para que la aritmética de fechas
-- mantenga la invariante date_end >= date_start.
alter table public.launches
  drop constraint if exists launches_dur_captacion_chk;
alter table public.launches
  add constraint launches_dur_captacion_chk check (dur_captacion >= 0);

alter table public.launches
  drop constraint if exists launches_dur_calentamiento_chk;
alter table public.launches
  add constraint launches_dur_calentamiento_chk check (dur_calentamiento >= 0);

alter table public.launches
  drop constraint if exists launches_dur_compra_chk;
alter table public.launches
  add constraint launches_dur_compra_chk check (dur_compra >= 0);

alter table public.launches
  drop constraint if exists launches_dur_cierre_chk;
alter table public.launches
  add constraint launches_dur_cierre_chk check (dur_cierre >= 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Backfill launch_date desde el viejo date_start como placeholder.
--    No es matemáticamente correcto (date_start es ahora date_anchor − 21);
--    pero preserva alguna fecha en lugar de perderla. El usuario re-ingresa
--    el launch_date correcto desde la UI cuando lo necesite.
-- ═══════════════════════════════════════════════════════════════════════════
update public.launches
   set launch_date = date_start
 where launch_date is null
   and date_start is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Drop estructuras viejas asociadas a date_start/date_end manuales
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  drop constraint if exists launches_date_window_chk;

drop index if exists public.launches_date_start_idx;

alter table public.launches drop column if exists date_start;
alter table public.launches drop column if exists date_end;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Re-agregar como GENERATED ALWAYS AS ... STORED
--
-- Si launch_date es NULL → ambas columnas son NULL (el calendario aún no
-- está definido). Cuando el usuario tipea launch_date, las dos fechas
-- aparecen automáticamente.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  add column date_start date
  generated always as (launch_date - dur_captacion) stored;

alter table public.launches
  add column date_end date
  generated always as (launch_date + 2 + dur_compra + dur_cierre) stored;

-- Recreamos el índice (mismo nombre y forma que tenía en 0006).
create index if not exists launches_date_start_idx
  on public.launches(date_start desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) La columna legacy `date` (single-date pre-Fase 1) ya no se usa.
--    Se mantiene por ahora para no romper migraciones aplicadas; un cleanup
--    posterior puede dropearla cuando confirmemos que ningún backfill la
--    necesita.
-- ═══════════════════════════════════════════════════════════════════════════
