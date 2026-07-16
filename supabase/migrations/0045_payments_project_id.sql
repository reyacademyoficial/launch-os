-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 12 — Denormalizar project_id en payments                            │
-- │                                                                          │
-- │ Problema: la RLS actual de payments corre                                 │
-- │   has_project_access(project_of_sale(sale_id))                            │
-- │ que dispara UNA subquery a sales POR FILA seleccionada. Con 20k+ cobros  │
-- │ el leaderboard tardaba minutos (listPaymentsForProject chunkea por       │
-- │ sale_id y cada page paga el costo de N subqueries RLS).                  │
-- │                                                                          │
-- │ Solución: guardar project_id directamente en payments. La RLS pasa a     │
-- │ ser has_project_access(project_id) sobre una columna indexada — el       │
-- │ planner puede resolverlo con un index-only scan. Además                  │
-- │ listPaymentsForProject deja de necesitar el prefetch de sales +          │
-- │ chunking: una sola query .eq("project_id", …).                           │
-- │                                                                          │
-- │ Consistencia: un trigger BEFORE INSERT/UPDATE popula project_id desde    │
-- │ sale_id, así los inserts existentes de la app siguen funcionando sin     │
-- │ pasar project_id explícitamente. El WITH CHECK de la RLS evalúa el       │
-- │ valor ya poblado por el trigger (BEFORE runs first en Postgres).         │
-- ╰──────────────────────────────────────────────────────────────────────────╯

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Columna denormalizada. Arranca nullable para poder backfillear.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payments
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Backfill desde sales para las filas existentes.
-- ═══════════════════════════════════════════════════════════════════════════
update public.payments p
   set project_id = s.project_id
  from public.sales s
 where p.sale_id = s.id
   and p.project_id is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) NOT NULL una vez que todo tiene valor.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payments alter column project_id set not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Índice para la query dominante: leaderboard / vista de cobros del proyecto.
--    Ordena por paid_at desc porque las consultas siempre traen últimos primero.
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists payments_project_idx
  on public.payments(project_id, paid_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Trigger que sincroniza project_id con sale_id.
--    - INSERT sin project_id → lo resuelve desde sales.
--    - UPDATE que cambia sale_id → lo re-resuelve (edge case, no lo usamos
--      pero deja la invariante en la DB).
--    SECURITY DEFINER: el trigger tiene que poder leer sales aunque la RLS
--    del caller lo restrinja — mismo criterio que project_of_sale.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.payments_sync_project_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.project_id is null then
      new.project_id := (select project_id from public.sales where id = new.sale_id);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.sale_id is distinct from old.sale_id then
      new.project_id := (select project_id from public.sales where id = new.sale_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_id on public.payments;
create trigger sync_project_id
  before insert or update on public.payments
  for each row execute function public.payments_sync_project_id();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) RLS: reescribir las políticas para usar la columna directa.
--    Comparado con la versión previa (0014) evitamos la subquery
--    project_of_sale(sale_id) por fila. `project_of_sale()` se conserva
--    porque otras partes del código lo pueden estar usando; no lo dropeamos
--    para no romper dependencias silenciosas.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));

commit;
