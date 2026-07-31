-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 0 (Kingrow) — Nivel organización + puente hacia projects          │
-- │                                                                          │
-- │ LaunchOS es hoy un módulo dentro de una plataforma más grande, Kingrow.  │
-- │ Kingrow es la empresa madre: gestiona empresas propias (Growins, Rey     │
-- │ Academy) y externas (Maestro Charcutero). Cada empresa gestionada = un   │
-- │ `project` de LaunchOS.                                                   │
-- │                                                                          │
-- │ Dos niveles de datos coexisten:                                          │
-- │   - NIVEL PROYECTO (LaunchOS): scope por `project_id`. Ya funciona; NO   │
-- │     se toca. Acá viven leads, sales, payments, comisiones.               │
-- │   - NIVEL ORGANIZACIÓN (Kingrow): scope por `organization_id`. Se está   │
-- │     creando en este bloque. Acá van a vivir finanzas de Kingrow, nómina, │
-- │     liquidaciones. Hoy hay UNA sola organización: Kingrow.               │
-- │                                                                          │
-- │ Qué hace esta migración:                                                 │
-- │   1. Crea tabla `organization` + RLS habilitada SIN policies (locked-    │
-- │      down hasta 0052; sólo bypass roles acceden en el interín).          │
-- │   2. Inserta la fila semilla Kingrow con UUID fijo determinista          │
-- │      `00000000-0000-0000-0000-000000000001` para poder referenciarla     │
-- │      desde código, tests y migraciones futuras sin lookups.              │
-- │   3. Agrega dos columnas a `projects` (aditivas):                        │
-- │        - organization_id uuid  → FK a organization(id)                   │
-- │        - ownership       text  → CHECK ('propia','externa')              │
-- │      Ambas primero nullable, luego backfilleadas, luego SET NOT NULL en  │
-- │      la misma migración (sandbox pre-cutoff, sin usuarios reales todavía)│
-- │   4. Setea defaults sensatos para próximos inserts:                      │
-- │        - organization_id default = Kingrow (hoy hay una sola org; se     │
-- │          removerá el default cuando exista soporte multi-org).           │
-- │        - ownership default = 'externa' (el caso seguro: si algo queda    │
-- │          sin marcar, se comporta como externo — se le calcula split y    │
-- │          cuenta corriente — en vez de asumir por error 100% de Kingrow). │
-- │                                                                          │
-- │ Guardarraíles respetados:                                                │
-- │   - No se toca ninguna otra columna de `projects`.                       │
-- │   - No se modifica ningún helper existente.                              │
-- │   - Sin app-code changes.                                                │
-- │   - Sin grant a cliente_role (queda para 0052 el revoke explícito de     │
-- │     defensa-en-profundidad + la doc de la convención).                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Tabla `organization`
--    Sin `updated_at` por ahora — es una tabla casi inmutable (una fila hoy).
--    RLS se habilita en esta migración; policies se agregan en 0052.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.organization (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  created_at timestamptz not null default now()
);

alter table public.organization enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Semilla: Kingrow con UUID determinista
--    `00000000-0000-0000-0000-000000000001` = "org #1". Documentado y estable
--    para referenciar desde defaults, tests y código del app sin lookups.
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.organization (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Kingrow')
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Columnas nuevas en `projects` (aditivas, primero nullable)
--    CHECK en `ownership` acepta NULL (SQL: NULL nunca es FALSE) — sirve
--    durante el ciclo add→backfill→NOT NULL sin bloquear filas existentes.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.projects
  add column if not exists organization_id uuid
    references public.organization(id),
  add column if not exists ownership text
    check (ownership in ('propia','externa'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Backfill: todos los projects existentes → Kingrow, ownership 'externa'
--    Filtro `where <col> is null` para idempotencia (segunda corrida = 0 filas)
-- ═══════════════════════════════════════════════════════════════════════════
update public.projects
   set organization_id = '00000000-0000-0000-0000-000000000001'
 where organization_id is null;

update public.projects
   set ownership = 'externa'
 where ownership is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Defaults + NOT NULL — el esquema queda consistente
--    - organization_id default = Kingrow (elimínese cuando llegue multi-org)
--    - ownership default = 'externa' (caso seguro)
--    - Ambas NOT NULL: todo project vive dentro de una org, con ownership
--      declarado.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.projects
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null,
  alter column ownership        set default 'externa',
  alter column ownership        set not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Índice para queries org-scoped (sigue convención projects_id_idx style)
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists projects_organization_id_idx
  on public.projects(organization_id);
