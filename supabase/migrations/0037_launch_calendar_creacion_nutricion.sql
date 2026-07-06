-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 2b (extensión) — par pre-captación: creación + nutrición            │
-- │                                                                          │
-- │ Sumamos dos duraciones nuevas al calendario del launch:                  │
-- │   dur_creacion   → default 30                                            │
-- │   dur_nutricion  → default 15                                            │
-- │                                                                          │
-- │ Análogas a captación/calentamiento pero corridas una etapa hacia atrás:  │
-- │ creación termina el día previo al inicio de captación; nutrición se      │
-- │ solapa dentro de creación terminando el mismo día.                        │
-- │                                                                          │
-- │ Ninguna de las dos afecta `date_start` — el sync engine sigue arrancando │
-- │ en captación (que es cuando prende el tráfico pago). Son pre-producción, │
-- │ visibles solo en el calendario para planning.                            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.launches
  add column if not exists dur_creacion  integer not null default 30,
  add column if not exists dur_nutricion integer not null default 15;

alter table public.launches
  drop constraint if exists launches_dur_creacion_chk;
alter table public.launches
  add constraint launches_dur_creacion_chk check (dur_creacion >= 0);

alter table public.launches
  drop constraint if exists launches_dur_nutricion_chk;
alter table public.launches
  add constraint launches_dur_nutricion_chk check (dur_nutricion >= 0);
