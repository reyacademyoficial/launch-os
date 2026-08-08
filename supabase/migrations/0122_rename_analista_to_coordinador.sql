-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Rename rol `analista` → `coordinador`                                    │
-- │                                                                          │
-- │ Cambio semántico + de matriz de acceso. Coordinador reemplaza a analista │
-- │ 1:1 en DB (mismo lugar en el enum de roles). Las restricciones nuevas de │
-- │ acceso (coordinador SIN ejecutivo/financiero/comercial, admin/coord/op   │
-- │ solo ven sus propias tareas) se enforceean en TS + UI, no acá — RLS no   │
-- │ discrimina entre admin y coordinador para módulos de negocio.            │
-- │                                                                          │
-- │ Puntos activos que tocamos:                                              │
-- │   1) UPDATE profiles set role='coordinador' where role='analista'.       │
-- │   2) Reescribir profiles_role_check (definido en 0034).                  │
-- │   3) Reescribir handle_new_user (definido en 0034).                      │
-- │                                                                          │
-- │ NO tocamos policies RLS: los helpers `can_edit_project` /                │
-- │ `can_edit_launches_in` filtran por role IN ('admin', ...) sin nombrar    │
-- │ analista. Las únicas menciones de 'analista' en migraciones previas son  │
-- │ comentarios (0009, 0010, 0013, 0023, 0025, 0048, 0049) — no cambian el   │
-- │ comportamiento en runtime y quedan como parte del historial.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Data: renombrar los profiles existentes
-- ═══════════════════════════════════════════════════════════════════════════
update public.profiles
   set role = 'coordinador'
 where role = 'analista';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Constraint: reemplazar la whitelist de roles válidos
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('dev', 'superadmin', 'admin', 'operador', 'coordinador', 'cliente'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) handle_new_user — actualizar la whitelist de roles aceptables desde
--    raw_user_meta_data. 'dev' sigue afuera (se promociona vía RPC).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'cliente');
  if v_role not in ('superadmin', 'admin', 'operador', 'coordinador', 'cliente') then
    -- 'dev' cae acá explícitamente: lo degradamos a 'cliente'.
    -- 'analista' (rol viejo) también cae acá y termina como 'cliente' — pero
    -- no debería llegar: el UI ya no lo emite y no hay users en flight.
    v_role := 'cliente';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
