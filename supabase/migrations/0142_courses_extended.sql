-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0142 — courses extendido + projects.ghl_location_id                     │
-- │                                                                          │
-- │ Fase A del plan Academia (docs/kingrow-academia-plan.md). Agrega los    │
-- │ campos que van a soportar:                                              │
-- │   - progress_source: cómo se mide el avance del alumno                  │
-- │       'attendance'  → clases asistidas / total (default, cursos vivos)  │
-- │       'ghl_tags'    → tags que llegan de HighLevel (Máquina del Éxito)  │
-- │       'manual'      → carga manual (cursos sin telemetría)              │
-- │   - default_access_days: cuántos días vale la inscripción por defecto.  │
-- │       Usado por trigger de enrollments para autocalcular expiración.    │
-- │   - has_systems: activa la UI de "sistemas del curso" (Fase E). Nitro   │
-- │       tiene 4 sistemas: Producto, Talento, Ventas, Admin&Finanzas.     │
-- │   - ghl_expiration_webhook_url: URL de la automatización GHL a llamar  │
-- │       cuando vence una inscripción. Va a nivel curso (no proyecto)     │
-- │       porque cada curso tiene su propia automatización.               │
-- │   - external_app_id: FK opcional a external_apps (Fase G). Se declara  │
-- │       la columna acá pero la tabla se crea después — nullable, sin FK │
-- │       hasta que exista external_apps.                                  │
-- │                                                                          │
-- │ Además: `projects.ghl_location_id` — necesario para llamar al endpoint │
-- │ /contacts/search de GHL en la sync de tags (Fase C). Un location = un │
-- │ sub-account de GHL. Va a nivel proyecto porque cada proyecto propia   │
-- │ puede tener su propia location.                                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) projects.ghl_location_id — nullable, no unique (varios proyectos podrían
--    compartir location en teoría, pero en la práctica es 1:1)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.projects
  add column if not exists ghl_location_id text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) courses — nuevas columnas
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.courses
  add column if not exists progress_source text not null default 'attendance'
    check (progress_source in ('attendance','ghl_tags','manual'));

alter table public.courses
  add column if not exists default_access_days integer
    check (default_access_days is null or default_access_days > 0);

alter table public.courses
  add column if not exists has_systems boolean not null default false;

alter table public.courses
  add column if not exists ghl_expiration_webhook_url text;

-- external_app_id: FK diferida — la tabla external_apps se crea en Fase G.
-- Hasta entonces la columna acepta cualquier uuid pero como es nullable y
-- no hay uso, no genera datos inconsistentes. El día que se cree la tabla,
-- una migración posterior agrega la FK con validación.
alter table public.courses
  add column if not exists external_app_id uuid;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Comentarios para documentación en la propia DB
-- ═══════════════════════════════════════════════════════════════════════════
comment on column public.courses.progress_source is
  'Cómo se mide el avance del alumno en el curso: attendance | ghl_tags | manual';
comment on column public.courses.default_access_days is
  'Días por defecto de vigencia de una inscripción. Usado para autocalcular access_expires_at.';
comment on column public.courses.has_systems is
  'Si true, el curso se subdivide en sistemas (ej: Nitro → Producto/Talento/Ventas/Admin).';
comment on column public.courses.ghl_expiration_webhook_url is
  'URL de la automatización GHL a llamar cuando vence una inscripción.';
comment on column public.courses.external_app_id is
  'FK opcional a external_apps (creada en Fase G). Nullable hasta que exista la tabla.';
comment on column public.projects.ghl_location_id is
  'ID del sub-account (location) de HighLevel asociado al proyecto. Requerido para tag sync.';
