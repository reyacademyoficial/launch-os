-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 12 — Consumo por clase                                              │
-- │                                                                          │
-- │ Cada lanzamiento tiene una grilla horaria de "consumo": filas = franjas  │
-- │ horarias (ej: 09:00, 09:10, ...), columnas = clases (Clase 1, 2, ...).   │
-- │ En cada celda el operador carga la cantidad de personas presentes en esa │
-- │ clase en esa hora. La UI arma un chart comparativo (una serie por clase).│
-- │                                                                          │
-- │ Modelo: UNA fila por lanzamiento — el config (start/end/interval) más    │
-- │ los nombres de clases y la matriz de celdas viven juntos. Se persiste    │
-- │ como matriz JSONB porque nunca queremos consultar celdas individuales:   │
-- │ siempre se lee entera para renderizar el chart. Formato:                 │
-- │   cells = { "09:00": { "Clase 1": 12, "Clase 2": 4 }, "09:10": {...} }  │
-- │                                                                          │
-- │ RLS: espejo de launch_daily (project-scope). SELECT = has_project_access,│
-- │ IUD = can_edit_launches_in (admin + operador; analista/cliente read-only).│
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.launch_consumption (
  launch_id        uuid  primary key
                         references public.launches(id) on delete cascade,

  -- Config de generación de filas. La UI arma los slots como
  -- [start_time, start_time+interval, ..., <=end_time]. end_time > start_time
  -- para que siempre haya al menos un slot.
  start_time       time  not null default '09:00',
  end_time         time  not null default '12:00',
  interval_minutes integer not null default 10
                            check (interval_minutes between 1 and 240),

  -- Nombres de clases (columnas). Orden preservado. Al menos una.
  classes          text[] not null
                          default array['Clase 1', 'Clase 2', 'Clase 3']::text[],

  -- Matriz de asistentes: { hora "HH:MM" -> { nombre_clase -> int } }.
  -- Se sobreescribe entera en cada save (upsert). Las celdas ausentes o
  -- inválidas se interpretan como 0 en la UI.
  cells            jsonb not null default '{}'::jsonb,

  updated_at       timestamptz not null default now(),

  constraint launch_consumption_window_chk check (end_time > start_time),
  constraint launch_consumption_classes_chk check (array_length(classes, 1) >= 1)
);

-- Trigger para mantener updated_at fresco en cada UPDATE.
create or replace function public.launch_consumption_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists launch_consumption_touch on public.launch_consumption;
create trigger launch_consumption_touch
  before update on public.launch_consumption
  for each row execute function public.launch_consumption_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — mismo patrón que launch_daily (resolución del project vía
-- project_of_launch, split SELECT/IUD entre miembros y admin+operador).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launch_consumption enable row level security;
grant select, insert, update, delete on public.launch_consumption to authenticated;

drop policy if exists launch_consumption_select on public.launch_consumption;
create policy launch_consumption_select on public.launch_consumption
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));

drop policy if exists launch_consumption_insert on public.launch_consumption;
create policy launch_consumption_insert on public.launch_consumption
  for insert to authenticated
  with check (public.can_edit_launches_in(public.project_of_launch(launch_id)));

drop policy if exists launch_consumption_update on public.launch_consumption;
create policy launch_consumption_update on public.launch_consumption
  for update to authenticated
  using      (public.can_edit_launches_in(public.project_of_launch(launch_id)))
  with check (public.can_edit_launches_in(public.project_of_launch(launch_id)));

drop policy if exists launch_consumption_delete on public.launch_consumption;
create policy launch_consumption_delete on public.launch_consumption
  for delete to authenticated
  using (public.can_edit_launches_in(public.project_of_launch(launch_id)));

-- Realtime — mismo patrón que launch_daily / launch_community_metrics para que
-- si dos operadores editan la grilla en simultáneo el chart refresh.
do $$
begin
  alter publication supabase_realtime add table public.launch_consumption;
exception when duplicate_object then
  null;
end$$;
