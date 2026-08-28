-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Nuevo rol `closer` — carga ventas y cobros, nada más                     │
-- │                                                                          │
-- │ Perfil comercial acotado: el closer entra directo al módulo Ventas de   │
-- │ un proyecto (Ventas + Cobros), no ve KG, no ve otros módulos LaunchOS,  │
-- │ no ve notificaciones. Su único trabajo es cargar ventas cerradas y sus │
-- │ cobros.                                                                  │
-- │                                                                          │
-- │ CAMBIOS EN DB                                                            │
-- │   1) profiles_role_check → agregar 'closer' a la whitelist.             │
-- │   2) handle_new_user → aceptar 'closer' desde raw_user_meta_data.       │
-- │   3) can_edit_launches_in → incluir 'closer' junto con admin/operador.  │
-- │      Esto habilita a los closers a hacer INSERT/UPDATE/DELETE sobre     │
-- │      sales, payments, leads, installments, invoices, sale_products,    │
-- │      launch_settlements, etc. — todas las tablas que gatean escritura  │
-- │      por este helper.                                                   │
-- │                                                                          │
-- │ QUÉ NO CAMBIA                                                            │
-- │   · can_edit_project sigue admin-only → closer NO puede crear/borrar    │
-- │     launches ni editar el proyecto.                                     │
-- │   · has_project_access sigue basado en project_members → closer necesita│
-- │     estar asignado a los proyectos donde debe cargar ventas (mismo      │
-- │     patrón que operador/coordinador).                                   │
-- │   · Ningún módulo KG (Financiero, Comercial, Clientes, Academia, etc.)  │
-- │     cambia su RLS: closer sigue sin ver esas tablas porque el módulo   │
-- │     no le abre las páginas — y aun si consultara vía RLS, closer solo   │
-- │     tiene grants sobre las tablas project-scope, no las org-scope.     │
-- │   · cliente_role frontier intacta: closer es rol PostgREST             │
-- │     `authenticated`, distinto de cliente_role. No se toca 0023.        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Whitelist de roles: agregar 'closer'
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('dev', 'superadmin', 'admin', 'operador', 'coordinador', 'closer', 'cliente'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) handle_new_user — aceptar 'closer' en raw_user_meta_data
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
  if v_role not in ('superadmin', 'admin', 'operador', 'coordinador', 'closer', 'cliente') then
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) can_edit_launches_in — sumar 'closer' al set de roles que pueden
--    escribir sales/payments/leads/etc. Mismo criterio de pertenencia
--    (miembro de project_members del proyecto).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_edit_launches_in(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_superadmin()
      or exists (
        select 1
        from public.project_members m
        join public.profiles p on p.id = m.user_id
        where m.project_id = p_project_id
          and m.user_id    = auth.uid()
          and p.role in ('admin', 'operador', 'closer')
      );
$$;
