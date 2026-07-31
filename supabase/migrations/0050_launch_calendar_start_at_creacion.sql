-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 2b (ajuste) — `date_start` = inicio de creación (no de captación)  │
-- │                                                                          │
-- │ Contexto: 0011 definió `date_start = launch_date - dur_captacion` (=    │
-- │ inicio de captación). 0037 sumó las fases pre-captación (creación +      │
-- │ nutrición) pero explícitamente NO tocó `date_start` para no cambiar la  │
-- │ ventana que usa el sync engine.                                          │
-- │                                                                          │
-- │ Cambio de producto: ahora la ventana del launch (y por lo tanto la que  │
-- │ ven las integraciones + los reportes) tiene que arrancar cuando arranca │
-- │ la etapa de creación — es el "verdadero" inicio del lanzamiento desde   │
-- │ el punto de vista operativo. Nueva fórmula:                              │
-- │                                                                          │
-- │   date_start = launch_date − dur_captacion − dur_creacion                │
-- │                                                                          │
-- │ `date_end` no cambia. Postgres no permite ALTER de la expresión de una  │
-- │ columna GENERATED → DROP + ADD. Como el índice depende de la columna,   │
-- │ se dropea antes y se recrea después.                                     │
-- │                                                                          │
-- │ Efecto colateral: el sync de Meta/GHL/SendFlow ahora arranca desde      │
-- │ creación. Para launches que aún no llegaron a captación, deja de tirar  │
-- │ #100 "since cannot be in the future" (que era el bug reportado).        │
-- │ Los días previos a captación tienen 0 gasto/leads, así que la data      │
-- │ upserteada es benigna.                                                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

drop index if exists public.launches_date_start_idx;

alter table public.launches drop column if exists date_start;

alter table public.launches
  add column date_start date
  generated always as (launch_date - dur_captacion - dur_creacion) stored;

create index if not exists launches_date_start_idx
  on public.launches(date_start desc);
