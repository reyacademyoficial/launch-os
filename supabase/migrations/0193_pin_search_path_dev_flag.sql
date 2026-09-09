-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Pentest Etapa 1 — pin search_path en is_dev()/is_superadmin()/promote_to_dev│
-- │                                                                          │
-- │ 0127 redefinió estas 3 funciones SECURITY DEFINER sin `set search_path`. │
-- │ El pentest B1 (scripts/pentest/sql/pentest_b1_shadow.sql) no logró        │
-- │ explotarlas porque el body ya calificaba `public.profiles` a mano — pero │
-- │ eso es frágil: alcanza con que un futuro edit quite el prefijo `public.`  │
-- │ para reabrir un shadow attack vía pg_temp. Pineamos el search_path acá    │
-- │ como defensa en profundidad, mismo patrón que 0002/0051/0132/etc.        │
-- │                                                                          │
-- │ Sin cambio de comportamiento — mismos bodies que 0127.                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.is_dev()
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select is_dev_privileged from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select role = 'superadmin' or is_dev_privileged
       from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.promote_to_dev(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'promote_to_dev requires service_role';
  end if;
  update public.profiles
     set role = 'dev', is_dev_privileged = true
   where id = p_user_id;
end;
$$;
