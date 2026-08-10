-- Separa la *capacidad* dev del rol visible en la UI.
-- is_dev_privileged = true otorga acceso full dev independientemente de profiles.role,
-- lo que permite que el superadmin configure un rol/proyectos de display para el dev
-- sin romper sus permisos reales.

alter table public.profiles
  add column if not exists is_dev_privileged boolean not null default false;

-- Backfill: usuarios actuales con role='dev' reciben el flag
update public.profiles set is_dev_privileged = true where role = 'dev';

-- is_dev() ahora mira el flag en lugar del role
create or replace function public.is_dev()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select is_dev_privileged from public.profiles where id = auth.uid()),
    false
  );
$$;

-- is_superadmin() también honra el flag
create or replace function public.is_superadmin()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select role = 'superadmin' or is_dev_privileged
       from public.profiles where id = auth.uid()),
    false
  );
$$;

-- promote_to_dev() ahora también marca is_dev_privileged
create or replace function public.promote_to_dev(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'promote_to_dev requires service_role';
  end if;
  update public.profiles
     set role = 'dev', is_dev_privileged = true
   where id = p_user_id;
end;
$$;
