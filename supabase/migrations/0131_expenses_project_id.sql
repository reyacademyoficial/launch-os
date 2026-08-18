-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0131 — expenses.project_id (atribución opcional por proyecto)           │
-- │                                                                          │
-- │ Cierra el ítem abierto de "Deuda y decisiones abiertas" (plan §post-    │
-- │ Gate 0): hoy `expenses` es org-scope y no se puede saber cuánto cuesta │
-- │ operar cada proyecto. Sumar el ingreso por proyecto (via settlements + │
-- │ invoices) contra los gastos atribuidos al mismo project_id da P&L      │
-- │ por proyecto.                                                            │
-- │                                                                          │
-- │ DISEÑO — nullable con `on delete set null`                              │
-- │                                                                          │
-- │ La columna `project_id` queda NULLABLE a propósito. La realidad         │
-- │ contable de Kingrow tiene dos naturalezas de egresos:                   │
-- │                                                                          │
-- │   · Org-level (NULL): SaaS, alquiler, servicios profesionales,          │
-- │     impuestos de la razón social. No se atribuyen a un project — son   │
-- │     costo de tener Kingrow encendido. En el P&L por proyecto se        │
-- │     prorratean o quedan como "estructura" según decida el humano.     │
-- │   · Project-level (uuid): ads de un lanzamiento, IA de un proyecto,   │
-- │     agencia contratada para un launch específico. Al setear el         │
-- │     project_id se puede computar utilidad neta por proyecto.          │
-- │                                                                          │
-- │ `on delete set null`: si un proyecto se borra, los gastos históricos   │
-- │ NO se pierden — pasan a ser org-level huérfanos. El registro contable │
-- │ vale más que el vínculo semántico.                                     │
-- │                                                                          │
-- │ ÍNDICE — parcial `where project_id is not null`                        │
-- │                                                                          │
-- │ El agregado por proyecto va a ser el uso frecuente. Índice parcial     │
-- │ evita hincharlo con la mayoría de gastos org-level (típicamente 50%+  │
-- │ de las filas sin project_id). Mismo criterio que los otros índices    │
-- │ parciales de 0063.                                                     │
-- │                                                                          │
-- │ SIN BACKFILL                                                            │
-- │                                                                          │
-- │ Todos los expenses existentes quedan con `project_id = NULL`. Si el   │
-- │ humano decide re-atribuir algunos (típicamente los ads antiguos), se   │
-- │ hace desde la UI de edición — no acá con una heurística que podría     │
-- │ atribuir mal.                                                          │
-- │                                                                          │
-- │ FRONTERA ORG — validación de coherencia                                 │
-- │                                                                          │
-- │ Un expense con `organization_id = A` NO debería poder apuntar a un    │
-- │ `project_id` de la organización B. El FK a projects solo enforza      │
-- │ existencia. Agregamos un trigger que valida coherencia — mismo       │
-- │ patrón que 0110 con tickets/clients.                                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.expenses
  add column if not exists project_id uuid
    references public.projects(id) on delete set null;

comment on column public.expenses.project_id is
  'Atribución opcional a un proyecto. NULL = gasto org-level (SaaS, alquiler, '
  'impuestos, etc.). NOT NULL = gasto atribuible al proyecto (ads/IA de un '
  'lanzamiento, agencia, etc.). Al borrar el proyecto, el gasto queda org-level.';

create index if not exists expenses_project_idx
  on public.expenses(project_id)
  where project_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger de coherencia org — el project referenciado debe pertenecer a la
-- misma organización que el expense. Sin esto, RLS enforce a nivel de SELECT
-- pero un INSERT/UPDATE con un project_id cross-org pasaría (los FKs no
-- chequean org). Defensa en profundidad — la UI ya filtra el picker por org,
-- pero un payload manipulado no debe atravesar.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.expenses_project_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_org uuid;
begin
  if new.project_id is null then
    return new;
  end if;

  select organization_id
    into v_project_org
    from public.projects
   where id = new.project_id;

  if v_project_org is null then
    -- FK ya lo cubre pero por defensa doble.
    raise exception 'El proyecto asociado no existe.'
      using errcode = 'check_violation', detail = 'expense-project-not-found';
  end if;

  if v_project_org <> new.organization_id then
    raise exception 'El proyecto no pertenece a la organización del gasto.'
      using errcode = 'check_violation', detail = 'expense-project-org-mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_project_org_match_ins on public.expenses;
create trigger expenses_project_org_match_ins
  before insert on public.expenses
  for each row execute function public.expenses_project_org_match();

drop trigger if exists expenses_project_org_match_upd on public.expenses;
create trigger expenses_project_org_match_upd
  before update of project_id on public.expenses
  for each row execute function public.expenses_project_org_match();
