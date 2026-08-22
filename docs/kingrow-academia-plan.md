# Plan de acción — Módulo Academia (Kingrow)

Fecha de creación: 2026-08-22
Próxima migración libre: `0142`

## Contexto y estado actual

El módulo Academia ya tiene base sólida (migraciones 0070-0078 + 0112). Ver auditoría abajo. Este plan agrega los requerimientos nuevos y ordena de bases → atómico.

### Ya existe
- `students`, `courses` (capa sobre `products`), `cohorts`, `classes`, `attendance`, `enrollments`, `exams`, `certificates`
- Guard `is_propia_project()` / `guard_propia_project()` sobre todas las tablas academia
- UI: `/(app)/(kg)/academia/{cohortes,estudiantes,cursos,certificados}/`
- KPIs base en `src/lib/academia/kpis.ts`
- Nav en sidebar (capa Operativa) para `admin`, `coordinador`, `superadmin`, `dev`
- GHL integrado hoy **solo para leads** (`sync-ghl.ts`, `ghl_user_mappings`) — no toca academia

### Gaps vs requerimientos
| Requerimiento | Gap |
|---|---|
| Progreso vía tags GHL (Máquina del Éxito) | Falta `course_modules`, mapping módulo↔tag, **sync pull-based por email**, `student_module_progress` |
| Asistencia por clase | Existe ✓ (mejoras UX menores) |
| Parámetros configurables por curso (diagnóstico, coaching, etc.) | Falta `course_parameters` + `student_parameter_values` |
| Sistemas Nitro (Producto/Talento/Ventas/Admin&Finanzas) | Falta `academia_systems` con **course_id como raíz**, asociar cohort→system, asignar experto |
| App externa Nitro con SSO | Falta `external_apps` config + estrategia auth |
| Fecha compra + vigencia + baja automática (a nivel **curso**) | Falta `enrollments.access_expires_at`, cron detector, webhook outbound a GHL **por curso**, log de bajas |
| Métricas de curso (más visto, abandono, %) | Depende de módulos + progreso |

### Decisiones tomadas (2026-08-22)
1. **Sync GHL = pull por email** (no webhook inbound). Cron llama `POST /contacts/search` con las tags mapeadas del curso; matchea contactos devueltos por email contra `students.email`. Idempotente, sin endpoint público expuesto.
2. **Baja automática a nivel curso** — `courses.ghl_expiration_webhook_url`, no a nivel proyecto.
3. **1 solo cron diario** (`0 3 * * *`) que hace las 2 tareas (expiraciones + tag sync). Cuidado con el límite de Vercel.
4. **Sistemas cuelgan del curso** (`academia_systems.course_id`), no del proyecto. Flag `courses.has_systems` activa la UI.
5. **No linkeamos `students` ↔ `leads`** por FK — coincidencia opcional por email para reportes, sin tabla puente.

---

## Ordenamiento por dependencias

```
FASE A (bases) ──┬─> FASE B (parámetros)   ─┐
                 ├─> FASE C (GHL tag sync)  ─┼─> FASE F (métricas)
                 ├─> FASE D (vigencia/bajas)─┤
                 └─> FASE E (sistemas Nitro)─┘
                                              └─> FASE G (SSO app externa) [bloqueado por credenciales externas]
                                              └─> FASE H (refinos UX)
```

FASES B / C / D / E son **paralelizables** entre sí después de A. Cada una la agarra un agente distinto.

---

## FASE A — Bases del schema (bloqueante)

**Responsable:** 1 agente `general-purpose` (Bases-DB).
**Bloquea:** todo lo demás.

### Migraciones nuevas
- **0142_courses_extended.sql** — agrega a `courses`:
  - `progress_source text not null default 'attendance'` CHECK in `('attendance','ghl_tags','manual')`
  - `default_access_days integer null` (para calcular vencimiento por defecto en nuevos enrollments)
  - `has_systems boolean not null default false` (activa UI de sistemas — flag Nitro)
  - `ghl_expiration_webhook_url text null` (URL de automatización GHL para dar de baja)
  - `external_app_id uuid null` (FK a `external_apps`, creado en fase G, nullable por ahora)
- **0143_course_modules.sql** — nueva tabla:
  - `id, course_id (FK), project_id (denorm, guard_propia), name, order_index int, description text, created_at, updated_at`
  - unique (course_id, order_index)
- **0144_enrollments_access.sql**:
  - `enrollments.purchased_at date null` (fallback si no hay `sale_id`)
  - `enrollments.access_expires_at date null`
  - Ampliar CHECK de `status` a incluir `'expired'`
  - Trigger opcional: al crear enrollment, si `course.default_access_days` no null y `access_expires_at` es null, autocalcular = `enrolled_at + default_access_days`

### Helpers TS
- `src/lib/academia/modules.ts` — `listModulesByCourse`, `createModule`, `reorderModules`
- Actualizar `src/lib/academia/kpis.ts` sin romper API pública

### Definition of done
- Migraciones aplicadas por el user en Studio (según split de duties)
- `pnpm typecheck` verde
- Sin cambios de UI en esta fase (solo schema + helpers)

---

## FASE B — Parámetros configurables por curso

**Responsable:** agente `general-purpose` (Params).
**Depende de:** A.

### Migraciones
- **0145_course_parameters.sql**:
  - `course_parameters (id, course_id, project_id denorm, key text, label text, type text CHECK in ('boolean','integer','text'), required bool default false, order_index int, created_at, updated_at)`
  - unique (course_id, key)
- **0146_student_parameter_values.sql**:
  - `student_parameter_values (id, enrollment_id, parameter_id, project_id denorm, value_bool bool null, value_int int null, value_text text null, updated_at, updated_by)`
  - unique (enrollment_id, parameter_id)
  - Guard: al insertar, validar por trigger que el `type` del param matchee el campo `value_*` seteado

### UI
- `cursos/course-form-drawer.tsx` — sección "Parámetros del curso" (tabla editable inline con add/remove/reorder)
- `estudiantes/[studentId]/parameters-panel.tsx` — panel nuevo para setear valores por parámetro del curso donde está inscripto

### Server actions
- `cursos/parameters-actions.ts` — `upsertParameter`, `deleteParameter`, `reorderParameters`
- `estudiantes/parameter-values-actions.ts` — `setParameterValue`

### Definition of done
- Se puede crear param "diagnóstico" (boolean) en Nitro y verlo/tildarlo en ficha de alumno
- Se puede crear param "coaching_sessions" (integer) en MdE y ajustar cantidad
- RLS: solo `admin`/`coordinador` con `can_edit_project` puede modificar

---

## FASE C — GHL Tag Sync PULL (Máquina del Éxito)

**Responsable:** agente `general-purpose` (GHL-Sync). Contexto: familiarizarse con `src/lib/integrations/ghl.ts` y `sync-ghl.ts` antes de arrancar.
**Depende de:** A.
**Approach:** pull periódico (no webhook inbound). El match es por **email**.

### Migraciones
- **0147_module_ghl_tag_mappings.sql**:
  - `module_ghl_tag_mappings (id, course_module_id, project_id denorm, ghl_tag text, created_at)`
  - unique (project_id, ghl_tag) — un tag mapea a un solo módulo por proyecto
- **0148_student_module_progress.sql**:
  - `student_module_progress (id, enrollment_id, course_module_id, project_id denorm, completed_at timestamptz null, source text CHECK in ('ghl_tag','manual'), source_ref text null (ej: tag name), created_at, updated_at)`
  - unique (enrollment_id, course_module_id)

### Sync pull-based
- `src/lib/integrations/ghl-tag-sync.ts`:
  - Función `syncTagProgressForCourse(courseId)`:
    1. Trae todos los `module_ghl_tag_mappings` del curso
    2. Trae `project.ghl_location_id` (se agrega si no existe)
    3. Llama `POST https://services.leadconnectorhq.com/contacts/search` con:
       ```json
       { "locationId": "...", "filters": [{ "field": "tags", "operator": "contains", "value": "<tag>" }], "pageLimit": 100 }
       ```
       (una llamada por tag, o batch con `OR` si el endpoint lo soporta — ver docs GHL)
    4. Pagina hasta agotar
    5. Por cada contacto devuelto: matchea `contact.email` contra `students.email` del proyecto
    6. Si hay match y existe enrollment activo al curso → upsert `student_module_progress` con `completed_at = now()`, `source = 'ghl_tag'`, `source_ref = tag`
    7. Retorna resumen `{ tagsChecked, contactsMatched, progressUpserted }`
  - Función `syncAllGhlTrackedCourses()` — itera todos los cursos con `progress_source='ghl_tags'` y llama la anterior
- El cron diario (Fase D) invoca `syncAllGhlTrackedCourses()` después de las expiraciones

### UI
- `cursos/[courseId]/modules-tab.tsx` — nueva pestaña dentro del detalle del curso:
  - Lista de módulos con orden drag&drop
  - Input inline para el `ghl_tag` asociado a cada módulo
  - Botón "Sincronizar ahora" (solo `admin`/`coordinador`) que dispara la sync manual del curso
  - Visible solo si `course.progress_source = 'ghl_tags'`
- `estudiantes/[studentId]` — panel de progreso con módulos completados/pendientes

### Config
- Env var: reutiliza credenciales existentes de GHL en `src/lib/integrations/ghl.ts`
- Agregar a `projects` (si no existe ya): `ghl_location_id text` — necesario para el endpoint search
- Documentar en `docs/INTEGRATIONS_GHL.md` el flujo de sync

### Definition of done
- Crear mapping tag "mod-fundamentos-completo" → módulo "Fundamentos" de MdE
- Correr sync manual desde UI
- Alumno con esa tag en GHL aparece con módulo completado
- Tests unitarios en `ghl-tag-sync.test.ts` (match / no match / student no encontrado / paginación)

---

## FASE D — Vigencia, bajas automáticas + Cron unificado

**Responsable:** agente `general-purpose` (Lifecycle).
**Depende de:** A. **Coordinar con Fase C** — comparten el mismo cron.

### Migraciones
- **0149_enrollment_expiration_events.sql**:
  - `enrollment_expiration_events (id, enrollment_id, course_id denorm, project_id denorm, triggered_at, webhook_url text, webhook_status text CHECK in ('pending','sent','failed'), webhook_response text null, retries int default 0)`
  - Nota: `ghl_expiration_webhook_url` vive en `courses` (0142), no en `projects`

### Cron / job unificado
- **1 solo Vercel Cron** `/api/cron/academia-daily` (schedule `0 3 * * *`):
  1. **Expiraciones**:
     - Query enrollments con `access_expires_at < today AND status = 'active'`
     - Marca `status = 'expired'`
     - Para cada uno, resuelve `course.ghl_expiration_webhook_url` (si null → skip webhook, solo actualiza estado)
     - Inserta `enrollment_expiration_events` con `pending`
     - Llama al webhook (payload: `{ studentEmail, courseId, courseName, enrollmentId, expiredAt }`)
     - Actualiza estado a `sent` o `failed`
     - Reintenta failed hasta 3 veces
  2. **Tag sync GHL** (llama `syncAllGhlTrackedCourses()` de Fase C)
  - Endpoint devuelve resumen JSON con contadores de ambos steps

### Registro en `vercel.ts`
- Agregar cron en `crons: [{ path: '/api/cron/academia-daily', schedule: '0 3 * * *' }]`
- **Cuidado con el límite de Vercel** — este es el único cron nuevo de academia

### UI
- `estudiantes/[studentId]` — mostrar `access_expires_at` de cada enrollment con badge (vigente / por vencer 7d / vencido)
- Filtro "por vencer" en el listado de estudiantes
- En `cursos/[courseId]` — campo para configurar `ghl_expiration_webhook_url` (solo `admin`)
- Endpoint manual `/api/academia/expire-enrollment/:id` para forzar baja desde UI (botón "Dar de baja ahora")

### Definition of done
- Enrollment con vigencia = ayer, corriendo el cron manualmente, dispara webhook y queda `expired`
- Log en `enrollment_expiration_events` con response del webhook
- UI destaca alumnos próximos a vencer (7 días)
- Botón manual funciona

---

## FASE E — Sistemas del CURSO (Nitro y otros)

**Responsable:** agente `general-purpose` (Nitro-Systems).
**Depende de:** A.
**Diseño:** los sistemas cuelgan del **curso**, no del proyecto. Se activa con `courses.has_systems = true` (flag agregado en 0142).

### Migraciones
- **0150_academia_systems.sql**:
  - `academia_systems (id, course_id, project_id denorm, name, expert_team_member_id (FK team_members nullable), color, active, created_at, updated_at)`
  - unique (course_id, name)
- **0151_cohorts_system_link.sql**:
  - `cohorts.system_id uuid null` (FK a `academia_systems`)
  - Trigger valida que `system.course_id = cohort.course_id` (deben pertenecer al mismo curso)

### UI
- `cursos/[courseId]/sistemas-tab.tsx` — pestaña dentro del detalle del curso (visible si `has_systems = true`): CRUD de sistemas + asignación de experto
- Selector de sistema en `cohortes/[cohortId]` (nullable, opciones filtradas por curso del cohort)
- Filtro por sistema en listado de cohorts y en asistencia
- Reporte mensual `cursos/[courseId]/sistemas/[systemId]/reporte-mensual/page.tsx`:
  - Mes seleccionable
  - Asistencias del mes en clases de cohortes de ese sistema (por alumno)
  - Placeholder para "sesiones individuales" (llegan en Fase G — traídas de app externa)
  - Sin cálculo de sueldo — solo el conteo base para que el user calcule aparte

### Definition of done
- En curso Nitro: activar `has_systems`, crear 4 sistemas (Producto, Talento, Ventas, Admin&Finanzas), asignar 1 experto a cada uno
- Cada cohorte de Nitro se puede asignar a un sistema
- Reporte muestra: en agosto, sistema Producto tuvo X clases y Y asistencias

---

## FASE F — Métricas de curso (Máquina del Éxito)

**Responsable:** agente `general-purpose` (Metrics).
**Depende de:** C (necesita `student_module_progress`).

### Migraciones (RPCs)
- **0152_academia_metrics_rpcs.sql**:
  - `rpc_course_completion_stats(course_id)` — devuelve por módulo: total students, completed count, completion_rate
  - `rpc_course_dropoff(course_id)` — módulo donde más se abandona (último módulo completado / student)
  - `rpc_course_overall_progress(course_id)` — promedio de % completado

### UI
- `cursos/[courseId]/metricas-tab.tsx`:
  - Gráfico embudo por módulo (completions descendentes)
  - KPI "módulo con más abandono"
  - KPI "% visualización promedio"
- Actualizar dashboard academia con KPI global de MdE

### Definition of done
- Con datos reales de GHL sync, dashboard muestra métricas correctas
- Tests unitarios de las funciones agregadoras en `src/lib/academia/course-metrics.ts`

---

## FASE G — App externa Nitro (SSO)

**Responsable:** agente `vercel:ai-architect` o `general-purpose` (SSO).
**Depende de:** A. **Parcialmente bloqueado** hasta que el user pase credenciales/endpoints del backend Nitro.

### Migraciones
- **0153_external_apps.sql**:
  - `external_apps (id, project_id, name, base_url, auth_strategy text CHECK in ('jwt','oauth2','shared_secret'), config jsonb, active, created_at, updated_at)`
- FK ya declarada en `courses.external_app_id` (fase A).

### UI
- `academia/apps-externas/page.tsx` — CRUD de external apps del proyecto
- Botón "Abrir app Nitro" en detalle de curso si `course.external_app_id is not null`
  - Llama endpoint interno `/api/academia/external-app/sso?courseId=...` que devuelve URL con token
  - Abre en nueva pestaña

### Server side
- `src/lib/academia/external-app-sso.ts` — genera token según `auth_strategy`
  - JWT: firma con secret shared del backend externo
  - OAuth2: intercambio con endpoint del backend
- Env vars por app (guardadas en `external_apps.config` cifradas o referenciadas)

### Reportería (segunda iteración, ya con backend)
- Pull mensual de "sesiones individuales" por sistema desde app Nitro
- Alimenta reporte de Fase E

### Definition of done
- Botón abre app externa con sesión iniciada
- (Segunda iteración) reporte mensual muestra sesiones + asistencias

**⚠ Requiere del user:** endpoint + método auth del backend Nitro antes de completar.

---

## FASE H — Refinamientos UX

**Responsable:** agente `general-purpose` (UX).
**Depende de:** B, C, D, E, F cerradas.

- Ficha unificada del alumno: progreso módulos + parámetros + vigencia + certificados en una vista
- Bulk actions: inscribir varios alumnos, marcar asistencia masiva
- Búsqueda global de alumno por nombre/email/phone
- Export CSV de asistencia por cohort × mes
- Filtros persistentes (localStorage) en listados

---

## Asignación de agentes (paralelización)

| Fase | Agente | Puede arrancar cuando | Estimado |
|---|---|---|---|
| A | Bases-DB | ahora | ~½ día |
| B | Params | A cerrada | ~½ día |
| C | GHL-Sync | A cerrada | 1 día |
| D | Lifecycle | A cerrada | 1 día |
| E | Nitro-Systems | A cerrada | 1 día |
| F | Metrics | C cerrada + datos | ½ día |
| G | SSO | A + credenciales del user | 1 día (bloqueado) |
| H | UX | B/C/D/E/F | ½-1 día |

Después de la fase A, **B / C / D / E corren en paralelo** con 4 agentes distintos.

---

## Riesgos y decisiones abiertas

1. **`progress_source = 'attendance'` para cursos en vivo, ¿cómo se calcula % progreso?** — asumir % = clases asistidas / total clases del cohort. Documentar en helper `computeEnrollmentProgress()`.
2. **Multi-tenant a nivel org (Kingrow):** todo lo nuevo debe respetar `guard_propia_project` — validar en cada migración.
3. **GHL search endpoint pagination:** verificar límite de resultados por página y si soporta filtro `OR` de tags. Si no, iterar 1 llamada por tag.
4. **`ghl_location_id` en `projects`:** verificar si ya existe; si no, agregar en 0142 o 0147.
5. **Vercel Cron límites:** en plan Hobby son 2 crons/día. Este es 1 solo — confirmar con user qué plan tiene.

---

## Convenciones

- Todas las tablas nuevas: `organization_id` NO (el guard vive vía `project_id` → `is_propia_project`), pero conservan `project_id` denormalizado + RLS `has_project_access` / `can_edit_project`.
- Server actions en archivos `actions.ts` colocados junto a la ruta.
- Tests unitarios de helpers puros en `*.test.ts` (vitest).
- Sin nuevos componentes globales — colocación cerca del uso.
