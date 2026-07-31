-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: helpers + trigger reusable                │
-- │                                                                          │
-- │ Este bloque construye la Academia de Kingrow. Definición de negocio:     │
-- │ los STUDENTS son alumnos de las EMPRESAS PROPIAS (Growins, Rey Academy). │
-- │ NO son leads de un lanzamiento ni clientes del portal. Cursan programas  │
-- │ (products) que la empresa propia dicta.                                  │
-- │                                                                          │
-- │ Scope: cada fila de academia pertenece a un `project` con                │
-- │ `ownership='propia'`. La restricción NO se puede expresar como CHECK     │
-- │ (necesita subquery a projects), así que se enforza con un trigger        │
-- │ reusable que consulta `ownership` en cada INSERT/UPDATE.                 │
-- │                                                                          │
-- │ Qué crea esta migración:                                                 │
-- │   1) `public.is_propia_project(uuid)` — helper SECURITY DEFINER que     │
-- │      resuelve si un project es 'propia'. Reusable en policies, checks    │
-- │      manuales y otros triggers.                                          │
-- │   2) `public.guard_propia_project()` — trigger function reusable. Toma  │
-- │      NEW.project_id (columna denormalizada obligatoria en todas las     │
-- │      tablas academia) y aborta con SQLSTATE 23514 (check_violation) si  │
-- │      el project no es propia. Mensaje humano en rioplatense para que    │
-- │      un desarrollador/admin entienda el rebote sin abrir código.        │
-- │                                                                          │
-- │ Este helper NO se toca en migraciones futuras: si mañana cambia la      │
-- │ semántica de "propia" (p.ej. se agrega un subtipo), se refina acá y     │
-- │ todos los triggers de academia heredan el cambio sin migrar datos.      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) is_propia_project(uuid) — read-only helper
--    Mismo patrón que has_project_access / can_edit_project:
--    security definer + stable + set search_path = public. Devuelve true
--    sólo si el project existe y tiene ownership='propia'.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_propia_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.projects
     where id = p_project_id
       and ownership = 'propia'
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) guard_propia_project() — trigger reusable
--
--    Espera que la tabla que lo instala tenga una columna `project_id uuid`
--    NOT NULL. En cada INSERT/UPDATE, si el project referenciado NO es
--    ownership='propia', aborta con 23514 (check_violation). Elegimos 23514
--    en vez de 42501 porque semánticamente es "el valor viola una regla del
--    dominio", no "faltan permisos": el usuario podría tener permiso pero
--    estar apuntando a un project externo, y el mensaje debería reflejarlo.
--
--    IMPORTANTE — orden de triggers: en tablas donde project_id se DERIVA
--    de otra FK (courses ← products, classes ← cohorts, enrollments ←
--    cohorts, etc.), el trigger de denormalización debe correr ANTES que
--    éste. Postgres corre triggers alphabetically por nombre, así que se
--    usa la convención:
--
--      before_denorm_project_id_from_<parent>   (denorm)
--      guard_propia_project                     (validación)
--
--    'b' < 'g' → orden garantizado sin depender de la memoria del que lee.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.guard_propia_project()
returns trigger
language plpgsql
as $$
declare
  v_ownership text;
begin
  if new.project_id is null then
    -- Defensa extra: el schema debería garantizar NOT NULL pero por si
    -- acaso alguien lo relaja en el futuro, no dejamos pasar el guard
    -- con project_id nulo.
    raise exception 'academia: project_id no puede ser null'
      using errcode = '23502';
  end if;

  select ownership into v_ownership
    from public.projects
   where id = new.project_id;

  if v_ownership is null then
    -- FK ya cubre esto, pero por completitud (trigger BEFORE corre antes
    -- que el FK check en algunos casos edge).
    raise exception 'academia: project % no existe', new.project_id
      using errcode = '23503';
  end if;

  if v_ownership <> 'propia' then
    raise exception
      'academia: el project % es ownership=%, y academia sólo puede colgar de proyectos ''propia''',
      new.project_id, v_ownership
      using errcode = '23514';
  end if;

  return new;
end;
$$;
