-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 6b-rev (Kingrow) — invoices.launch_id + guard de consistencia    │
-- │                                                                          │
-- │ POR QUÉ                                                                  │
-- │   La regla contable acordada dice que hay tres tipos de factura, y solo │
-- │   una de las tres cuenta como ingreso de Kingrow:                       │
-- │     · Ligada a un lanzamiento          → volumen del grupo (NO ingreso) │
-- │     · Sin lanzamiento, proyecto propio → ingreso directo de Kingrow    │
-- │     · Sin lanzamiento, proyecto externo → venta de terceros (NO ingreso)│
-- │   Sin `launch_id` no podemos distinguir la 1ra de las otras dos: la    │
-- │   clasificación se cae y el selector no tiene cómo decidir. Esta        │
-- │   migración agrega la columna que hace posible la regla.                │
-- │                                                                          │
-- │ ON DELETE RESTRICT (no set null)                                        │
-- │   Con `set null`, borrar un lanzamiento convertiría sus facturas en    │
-- │   "sueltas" y, si el proyecto es propio, esas facturas empezarían a    │
-- │   contar como ingreso de Kingrow en silencio. Borrar un lanzamiento no │
-- │   puede reclasificar plata. Es preferible que el DELETE reviente y     │
-- │   obligue a un operador a mover las facturas explícitamente antes.     │
-- │                                                                          │
-- │   NOTA — deuda técnica no resuelta acá:                                 │
-- │   `invoices.project_id` (0064) usa `on delete set null`, y sufre la    │
-- │   simetría inversa: borrar un proyecto propio deja facturas huérfanas  │
-- │   que se degradan a "sin proyecto" y salen del ingreso. No se cambia   │
-- │   ahora (fuera de scope del bloque), pero queda anotado.                │
-- │                                                                          │
-- │ CONSISTENCIA launch ↔ project                                          │
-- │   Regla: si `launch_id` no es NULL, `project_id` tampoco puede serlo,  │
-- │   y tiene que coincidir con `launches.project_id`. Sin la primera      │
-- │   parte quedaría permitida una factura ligada a un lanzamiento pero    │
-- │   sin proyecto — inclasificable, defeat del propósito de la columna.   │
-- │                                                                          │
-- │   NO se puede expresar como CHECK: Postgres no permite subqueries en   │
-- │   CHECK. Se implementa como trigger BEFORE INSERT OR UPDATE, mismo     │
-- │   patrón que `guard_propia_project` (0070). Trigger propio (no         │
-- │   reusable) porque la regla es específica de esta tabla.                │
-- │                                                                          │
-- │ BACKFILL                                                                │
-- │   La tabla está vacía (sandbox pre-corte). Backfill trivial: la nueva │
-- │   columna queda NULL en las filas futuras hasta que la UI la pida.     │
-- │   El trigger no rebota nada con launch_id NULL, así que las cargas    │
-- │   existentes/legacy siguen funcionando sin ajuste.                     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Columna y FK
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.invoices
  add column if not exists launch_id uuid
    references public.launches(id) on delete restrict;

create index if not exists invoices_launch_idx
  on public.invoices(launch_id) where launch_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de consistencia
--    Códigos de error (mismo criterio que 0070):
--      23502 — NOT NULL violated (falta project_id cuando hay launch_id)
--      23503 — FK/existencia (launch inexistente, edge por race)
--      23514 — check_violation (project_id no coincide con el del launch)
--    Los mensajes son en rioplatense para que un operador/dev entienda el
--    rebote sin abrir código, mismo criterio que el resto de guards.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.invoices_assert_launch_project_consistency()
returns trigger
language plpgsql
as $$
declare
  v_launch_project uuid;
begin
  -- Sin launch_id no hay nada que validar (regla no aplica a facturas sueltas).
  if new.launch_id is null then
    return new;
  end if;

  -- Regla 1: si hay launch_id, tiene que haber project_id. Una factura ligada
  -- a un lanzamiento pero sin proyecto sería inclasificable — bloqueamos.
  if new.project_id is null then
    raise exception
      'invoices: si launch_id está seteado (%) también tiene que estar project_id',
      new.launch_id
      using errcode = '23502';
  end if;

  -- Regla 2: el launch tiene que existir y pertenecer al mismo project.
  select project_id into v_launch_project
    from public.launches
   where id = new.launch_id;

  if v_launch_project is null then
    -- Defensa: el FK ya lo cubre pero el trigger BEFORE corre antes que el
    -- FK check en algunos edge cases. Reportamos claro si aún así llegara.
    raise exception 'invoices: launch % no existe', new.launch_id
      using errcode = '23503';
  end if;

  if v_launch_project <> new.project_id then
    raise exception
      'invoices: launch % pertenece al project %, pero la factura declara project_id % — no coinciden',
      new.launch_id, v_launch_project, new.project_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_launch_project_consistency on public.invoices;
create trigger invoices_launch_project_consistency
  before insert or update of launch_id, project_id on public.invoices
  for each row execute function public.invoices_assert_launch_project_consistency();
