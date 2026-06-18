-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 4c — Pagos al equipo (payouts)                                     │
-- │                                                                          │
-- │ El otro lado de la comisión. Hasta ahora el leaderboard derivaba         │
-- │ `commissionAccrued` = lo que el miembro generó. Pero no había forma de   │
-- │ registrar lo que efectivamente se le PAGÓ, ni de ver el saldo pendiente. │
-- │                                                                          │
-- │ Decisión de modelo:                                                      │
-- │   - `launch_id` es NOT NULL: cada pago se atribuye a un lanzamiento.     │
-- │     Eso permite leer "pagado / pendiente" por launch en el leaderboard   │
-- │     filtrado, que es la pregunta natural del admin después de un cierre. │
-- │   - El total pendiente sin filtro = sum(commission) - sum(payout) en     │
-- │     memoria (lo arma el agregador).                                      │
-- │                                                                          │
-- │ Permisos: mismo nivel que `sales` y `payments` (4b) — `can_edit_         │
-- │ launches_in`. Admin + operador pueden cargar/borrar payouts.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.team_member_payouts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  team_member_id  uuid not null references public.team_members(id) on delete cascade,
  launch_id       uuid not null references public.launches(id) on delete cascade,

  amount          numeric not null check (amount > 0),
  paid_at         date not null default current_date,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists team_member_payouts_project_member_idx
  on public.team_member_payouts(project_id, team_member_id, paid_at desc);
create index if not exists team_member_payouts_launch_idx
  on public.team_member_payouts(launch_id);

alter table public.team_member_payouts enable row level security;
grant select, insert, update, delete on public.team_member_payouts to authenticated;

drop trigger if exists set_updated_at on public.team_member_payouts;
create trigger set_updated_at before update on public.team_member_payouts
  for each row execute function public.set_updated_at();

drop policy if exists team_member_payouts_select on public.team_member_payouts;
create policy team_member_payouts_select on public.team_member_payouts
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists team_member_payouts_insert on public.team_member_payouts;
create policy team_member_payouts_insert on public.team_member_payouts
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists team_member_payouts_update on public.team_member_payouts;
create policy team_member_payouts_update on public.team_member_payouts
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

drop policy if exists team_member_payouts_delete on public.team_member_payouts;
create policy team_member_payouts_delete on public.team_member_payouts
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));
