# Kingrow — Módulo Marketing (plan vivo)

> Fuente de verdad viva del módulo Marketing (contenido orgánico + pipeline creativo).
> Reemplaza el diseño previsto en el Anexo B de `kingrow-plan.md`, que proponía "Opción
> A: agregado de LaunchOS" (ads spend/CPL). Ese ejercicio quedó fuera de scope; ahora
> Marketing es el **pipeline creativo end-to-end**: planificación → grabación → edición
> → publicación, con stock de contenido y alertas de cobertura.
>
> Claude marca los checkboxes a medida que cierra cada ítem. **No se borran ítems: se
> marcan.** Reglas heredadas de `kingrow-plan.md` (§ "Reglas heredadas") aplican
> íntegramente: server components para leer, server actions para escribir, sin `zod`,
> sin borrado duro, RLS org-scope, migraciones aditivas, FKs a nombres legibles,
> estados vacíos que enseñan, color sólo en StateDot/StatusPill/Delta.

---

## Estado al inicio

- Última migración aplicada: `0156_external_apps_simplify.sql`. Próximo ordinal
  disponible: **0157**.
- Módulo `/marketing` existe como placeholder (`src/app/(app)/(kg)/marketing/page.tsx`
  usa `ModulePlaceholder`). Nada de backend propio todavía.
- Sidebar ya declara el módulo (`layers.ts` → capa "Comercial" → `IconMkt`). El módulo
  se rendereará "solo" cuando el layout gate el rol y las páginas existan.
- Cero filas — el módulo arranca por **CRUD, no por dashboard** (regla vigente del
  Gate 0 para tablas nuevas en cero).

## Estado al 2026-08-24 (sesión Claude — Bloque 4 · Subidas + triggers finales)

**Cerrado por Claude en esta sesión (Bloque 4):**

- Migraciones **0163 y 0165 escritas** — pendientes de correr en Studio.
  - `0163_marketing_content_uploads.sql`: tabla `content_uploads` + triggers
    org-match cross-org (upload.org = asset.org) + `uploaded_at` auto-fill en
    INSERT y UPDATE de status (respeta timestamps explícitos del operador).
  - `0165_marketing_upload_stage_and_daily.sql`: dos triggers finales del
    pipeline. `content_piece_stage_from_upload` (INSERT y UPDATE) resuelve
    upload → asset → piece y avanza `listo_para_subir` → `publicado`.
    `content_piece_daily_regenerate` clona hermano al día siguiente cuando
    un piece con `is_daily_recurring=true` pasa a `publicado` (fallback
    `current_date + 1` si el piece no tenía scheduled_publish_at).
- Ampliado `src/lib/marketing/types.ts` con `UPLOAD_STATUSES`,
  `UPLOAD_STATUS_LABEL`, `UPLOAD_STATUS_TONE`, `isUploadStatus`,
  `ContentUploadRow`.
- `/marketing/subidas` (page + subidas-view + upload-form-drawer + actions):
  - Fetch en paralelo de owners/assets/uploads/cadencias.
  - Filtros server-side: view (`tabla|calendario`), estado
    (`open|all|individual`), plataforma, dueño.
  - Vista dual reutilizando `KgCalendar` de Bloque 2 (same-day drawer +
    trailingAction "+ Nueva subida").
  - Drawer con picker de asset filtrado por owner + platform + regla
    `allow_repeat_asset`. Assets ya subidos a esa platform (con cadencia
    sin repetir) se ocultan — excepto el propio en modo edit.
  - Botón inline "Marcar subida" → drawer separado con opcional
    `public_url`; dispara `markUploaded` que activa la cadena de triggers.
- `tsc --noEmit` = 0. `eslint` sobre `src/lib/marketing` y
  `src/app/(app)/(kg)/marketing` = 0. Suite: 719/720 (fallo pre-existente
  en `sync-ghl`, deuda ya documentada).

**Pendiente cuando se retome:**

1. **Correr en Studio (orden):** `0163_marketing_content_uploads.sql`,
   `0165_marketing_upload_stage_and_daily.sql`. Después regenerar
   `src/lib/types/database.ts` para eliminar `as never` en uploads.
2. **Verificación de humo Bloque 4:**
   - Crear 1 upload en 'planificada' → marcar como subida → verificar que
     el piece origen (si tiene `source_content_piece_id`) pasa a `publicado`.
   - Crear un piece con `is_daily_recurring=true` y flujo completo hasta
     `publicado` → verificar que aparece un hermano con
     `scheduled_publish_at = original + 1 día` y `stage='planificado'`.
   - Intentar crear upload duplicado en mismo asset+platform con cadencia
     `allow_repeat_asset=false` → el picker no muestra el asset.
   - Cambiar cadencia a `allow_repeat_asset=true` → el picker lo muestra
     de vuelta.
3. **Bloques restantes (2 de 8):**
   - Stock y alertas — `/marketing/stock` + selectores puros
     `src/lib/marketing/stock.ts` + `alerts.ts`.
   - Dashboard `/marketing` — reemplaza el ModulePlaceholder actual con
     `HeroKpi` + 4 paneles.

**Cuenta:** hechos 6 sub-bloques (Config + Disponibilidad + Planificación +
Grabación + Edición + Subidas) de 8 total. Quedan **2 sub-bloques**: Stock
y Dashboard. Todas las **9 migraciones** están escritas (0157-0161 aplicadas
en Studio; 0162, 0163, 0164, 0165 escritas y pendientes).

---

## Estado histórico — 2026-08-24 (sesión previa · Bloque 3)

**Cerrado por Claude en sesiones previas (Config + Bloques 1 y 2):**

- Sub-gate del módulo, Configuración (Dueños + Cadencias), Bloque 1 · Planificación
  y Bloque 2 · Grabación con calendario dual tabla/calendario.
- Migraciones 0157-0161 escritas **y aplicadas** en la DB remota (el usuario las
  corrió en Studio antes de arrancar esta sesión).
- `src/components/kg/calendar.tsx` (grid mensual custom reutilizable para Bloque 4).
- `src/lib/marketing/types.ts` con todos los enums, labels, tones y type guards.

**Cerrado por Claude en esta sesión (Bloque 3 + config Disponibilidad):**

- Migraciones **0162 y 0164 escritas** — pendientes de correr en Studio.
  - `0162_marketing_content_assets.sql`: tabla `content_assets` + trigger
    `content_piece_stage_from_asset` (INSERT y UPDATE de `edited_at`) que mueve
    la piece origen a `listo_para_subir` cuando queda en Edición y el asset se
    marca editado. Guard org-match cross-org (owner + sesión + piece).
  - `0164_marketing_editor_availability.sql`: tabla `editor_availability`
    (rangos por persona + flag available). Guard org-match person.
- Ampliado `src/lib/marketing/types.ts` con `ContentAssetRow` y
  `EditorAvailabilityRow` (no rompen los shapes existentes).
- Nuevo selector puro **`src/lib/marketing/editor-load.ts`** con
  `computeEditorLoadByWeek(assets, availability, since, until, personIds)`
  + helpers (`mondayOf`, `enumerateWeekStarts`, `isoWeekLabel`,
  `countAvailableDaysInRange`, `addDaysYmd`, `takeDatePart`). **21 tests en verde**
  cubriendo overrides de licencia, cambios de mes y buckets de assets.
- `/marketing/edicion` (page + edicion-view + asset-form-drawer + actions):
  - Fetch en paralelo de owners/persons/sessions/pieces/assets/availability.
  - Filtros server-side vía `KgParamPills`: estado (`queued|edited|all`), editor,
    dueño, formato.
  - Vista dual local (tab) tabla ⇄ planning semanal.
  - Planning pivot person × week (4 semanas rolling desde el lunes actual) con
    warning visual `overloaded` (assets asignados y 0 días disponibles).
  - Drawer 620px con owner → filtra sesión/piece; toggle "Marcar como editado"
    con datetime-local + default `now()`.
- `/marketing/disponibilidad` (page + disponibilidad-view + availability-form-drawer
  + actions): tabla plana con filtro `?person=`, drawer create/edit/delete.
- `tsc --noEmit` = 0. `eslint` sobre `src/lib/marketing` y
  `src/app/(app)/(kg)/marketing` = 0. Suite: 719/720 (fallo pre-existente en
  `sync-ghl`, deuda ya documentada).

**Pendiente cuando se retome:**

1. **Correr en Studio (orden):** `0162_marketing_content_assets.sql`,
   `0164_marketing_editor_availability.sql`. Después regenerar
   `src/lib/types/database.ts` para eliminar los `as never` en assets/availability.
2. **Verificación de humo Bloque 3:**
   - Crear 1 asset con `source_content_piece_id = X` en piece con
     `stage = 'en_edicion'` y `mark_edited=on` → trigger avanza el piece a
     `listo_para_subir`.
   - Crear 1 asset sin `edited_at`, después editarlo con checkbox activado →
     trigger dispara igual sobre UPDATE.
   - Cargar 1 bloque `available=true` y 1 bloque `available=false` que se solapen
     → el planning pivot muestra la resta correcta (regla rango-más-específico).
3. **Bloques restantes (3 de 8):**
   - Bloque 4 · Subidas — migración 0163 (`content_uploads`) + `/marketing/subidas`
     con vista dual tabla/calendario (reusa `KgCalendar`).
   - Stock y alertas — `/marketing/stock` + selectores
     `src/lib/marketing/stock.ts` + `alerts.ts`.
   - Dashboard `/marketing` — reemplaza el ModulePlaceholder actual con KPIs
     (`HeroKpi` con tone según umbral) + 4 paneles.
   - Migración 0165 (`content_piece_stage_from_upload` +
     `content_piece_daily_regenerate`) pendiente — se corre con Bloque 4.

**Cuenta:** hechos 5 sub-bloques (Config + Planificación + Grabación + Edición +
Disponibilidad) de 8 total. Quedan **3 sub-bloques**: Subidas, Stock/Alertas y
Dashboard (Tareas recurrentes cae dentro de la verificación del trigger 0165
que llega con Bloque 4).

---

## Roles (matriz de acceso)

| Rol           | `/marketing` | Detalle |
|---------------|:---:|---|
| dev/superadmin | ✅ | full |
| admin          | ✅ | full |
| coordinador    | ✅ | full salvo eliminar dueños/canales (config) |
| operador       | ⚠️ | **solo lo suyo** — filmaker/editor/experto ven solo tareas donde son assignees (patrón "mis tareas" de `/operaciones/tareas`) |
| cliente        | ❌ | fuera de scope |

Gate: `requireRole("superadmin", "admin", "coordinador", "operador")` en
`marketing/layout.tsx`. Operador con filtro server-side `assignee_id = currentPersonId`
default (toggle "Todas" NO aparece para operador — mismo patrón que Operaciones).

---

## Vocabulario del módulo (glosario cerrado)

- **Dueño de contenido** (`content_owner`): la "cuenta" a la que se sube el
  contenido. Ej.: "Rey Academy", "Kevin Machado", "Growins". Multi-tenant dentro
  de la org — cada dueño tiene su propio pipeline y su propio stock.
- **Contenido planificado** (`content_piece`): unidad atómica del plan editorial.
  Tiene fecha de grabación, fecha de publicación, tipo, guión, plataformas destino,
  dueño. Atraviesa las 4 etapas: `planificado → grabado → editado → publicado`.
- **Categoría**: `viral`, `nugget`, `otro` (CHECK constraint). Define la intención
  del contenido, no el formato.
- **Formato**: `reel`, `short`, `long`, `carousel`, `story`, `post`. Define cómo se
  edita/sube (no siempre 1:1 con plataforma).
- **Plataforma**: `instagram`, `facebook`, `tiktok`, `youtube` (CHECK). Un content
  piece puede tener N plataformas destino.
- **Recording session** (`recording_session`): un evento de grabación. Agrupa 1+
  content pieces (una grabación puede producir varios reels). Tiene fecha, filmaker
  asignado, experto asignado, ubicación, materiales, notas.
- **Asset producido** (`content_asset`): pieza editada finalizada, lista para subir.
  De una `recording_session` (o de un `content_piece` "master") pueden salir N
  assets. Cada asset se sube 0..N veces (típicamente 1). Tiene link a Drive/archivo,
  nombre, usado (bool).
- **Upload**: cada acto de subida a una plataforma específica en una fecha. Es la
  fila que dice "reel_042 se subió a IG el 2026-09-01".
- **Cadencia** (`publishing_cadence`): configuración por dueño — "3 publicaciones
  por día en IG", "1 short por día en YouTube". Alimenta el cálculo de "días de
  stock disponible".
- **Stock disponible**: assets producidos y NO usados aún, agrupados por dueño /
  plataforma / formato. Divide por cadencia diaria → "días de contenido".

---

## Orden de construcción

```
1. Sub-gate + configuración (dueños, cadencias, canales)
   └─→ 2. Bloque 1 · Planificación (CRUD content_pieces)
       └─→ 3. Bloque 2 · Grabación (recording sessions + calendario)
           └─→ 4. Bloque 3 · Edición (assets + asignación de editor)
               └─→ 5. Bloque 4 · Publicación (uploads + estado)
                   └─→ 6. Stock + Alertas de cobertura
                       └─→ 7. Dashboard `/marketing`
                           └─→ 8. Tareas recurrentes (opcional/último)
```

Las 4 etapas están **encadenadas por foreign key + trigger de transición**: cerrar
una etapa mueve automáticamente al content_piece a la siguiente. La UI muestra el
estado agregado del piece; cada etapa tiene su vista de trabajo (tabla o calendario).

---

## Migraciones (0157 → 0165, aditivas, todo en cero)

### 0157_marketing_content_owners.sql

- `content_owners` (org-scope): dueños de cuentas. `id, organization_id, name,
  handle_instagram?, handle_tiktok?, handle_youtube?, handle_facebook?, active,
  created_at, updated_at, created_by`.
- Unique parcial: `(organization_id, lower(name)) where active = true`.
- RLS org-scope con `can_edit_organization(organization_id)`.
- Trigger `set_updated_at`.

### 0158_marketing_publishing_cadence.sql

- `publishing_cadences` (org-scope): configuración por dueño × plataforma × formato.
  `content_owner_id, platform (check: instagram/facebook/tiktok/youtube), format
  (check: reel/short/long/carousel/story/post), posts_per_day integer NOT NULL check
  (posts_per_day > 0), allow_repeat_asset boolean NOT NULL default false, notes`.
- PK compuesta: `(content_owner_id, platform, format)`.
- **Motivación de `allow_repeat_asset`:** el usuario explicó que "20 reels de una
  grabación no significa poder subir 3 del mismo por día porque es el mismo
  contenido". Este flag habilita/deshabilita reciclaje del mismo asset.

### 0159_marketing_content_pieces.sql

- `content_pieces` (org-scope): plan editorial.
  - `id, organization_id, content_owner_id NOT NULL`
  - `title text NOT NULL, script_md text` (guión)
  - `category text NOT NULL check (category in ('viral','nugget','otro'))`
  - `format text NOT NULL check (format in ('reel','short','long','carousel','story','post'))`
  - `platforms text[] NOT NULL check (array_length(platforms,1) > 0 and platforms <@ array['instagram','facebook','tiktok','youtube']::text[])`
  - `scheduled_recording_at timestamptz` (fecha de grabación planificada)
  - `scheduled_publish_at date` (fecha de publicación planificada)
  - `stage text NOT NULL default 'planificado' check (stage in ('planificado','en_grabacion','en_edicion','listo_para_subir','publicado','descartado'))`
  - `recording_session_id uuid NULL references recording_sessions(id) on delete set null` (se popula al asignar a una sesión — permite N pieces por sesión)
  - `notes text`
  - `is_daily_recurring boolean NOT NULL default false` (tareas diarias: al marcar
    "publicado" se auto-regenera el próximo día — ver §Tareas recurrentes)
  - `created_at, updated_at, created_by`
- Índices: `(organization_id)`, `(content_owner_id)`, `(scheduled_publish_at)`,
  `(stage) where stage != 'publicado'`.
- Trigger `set_updated_at`.
- RLS org-scope.

### 0160_marketing_recording_sessions.sql

- `recording_sessions` (org-scope):
  - `id, organization_id, content_owner_id NOT NULL`
  - `scheduled_at timestamptz NOT NULL`
  - `duration_minutes integer` (estimado)
  - `location text` (dónde se graba)
  - `materials text` (equipo/props/etc.)
  - `notes text`
  - `status text NOT NULL default 'planificada' check (status in ('planificada','confirmada','realizada','cancelada'))`
  - `completed_at timestamptz` (poblado cuando `status='realizada'` — mismo patrón que tickets)
  - `created_at, updated_at, created_by`
- Índices: `(organization_id)`, `(scheduled_at)`, `(content_owner_id)`.
- Trigger `set_updated_at`.
- RLS org-scope.

### 0161_marketing_recording_assignees.sql

- Junction M:N para asignar personas a una `recording_session` con rol.
  - `recording_session_id uuid references recording_sessions(id) on delete cascade`
  - `person_id uuid references organization_people(id) on delete cascade`
  - `organization_id uuid NOT NULL` (para RLS directa)
  - `role text NOT NULL check (role in ('filmaker','experto','asistente'))`
  - `created_at`
  - PK: `(recording_session_id, person_id, role)`
- **Motivación:** patrón junction (mismo que `task_assignees` en 0141) porque son
  M:N con rol semántico. Un filmaker puede estar en muchas sesiones; una sesión
  puede tener varios expertos.
- Índices: `(person_id)`, `(recording_session_id)`, `(person_id, role)`.
- RLS org-scope.

### 0162_marketing_content_assets.sql

- `content_assets` (org-scope): piezas EDITADAS que salen de una sesión de grabación
  y quedan en stock listas para subir.
  - `id, organization_id, content_owner_id NOT NULL`
  - `source_recording_session_id uuid NULL references recording_sessions(id) on delete set null` (nullable — puede venir de importación externa)
  - `source_content_piece_id uuid NULL references content_pieces(id) on delete set null` (el "master" que originó — nullable si es asset huérfano)
  - `name text NOT NULL` (ej. "reel_042_apertura", legible)
  - `format text NOT NULL check (format in ('reel','short','long','carousel','story','post'))`
  - `drive_folder_url text` (link a la carpeta compartida de la sesión — se repite entre assets hermanos, ver §Stock)
  - `drive_asset_url text` (link al archivo puntual dentro de la carpeta)
  - `duration_seconds integer` (dato útil para reels vs longs)
  - `editor_person_id uuid NULL references organization_people(id) on delete set null` (editor a cargo)
  - `edited_at timestamptz` (fecha en que se marcó como editado — pobla stock)
  - `notes text`
  - `created_at, updated_at, created_by`
- Índices: `(organization_id)`, `(content_owner_id)`, `(editor_person_id)`,
  `(source_recording_session_id)`, `(edited_at)`.
- Trigger `set_updated_at`.
- RLS org-scope.

### 0163_marketing_uploads.sql

- `content_uploads` (org-scope): cada acto de subida.
  - `id, organization_id`
  - `content_asset_id uuid NOT NULL references content_assets(id) on delete restrict`
  - `platform text NOT NULL check (platform in ('instagram','facebook','tiktok','youtube'))`
  - `scheduled_for date NOT NULL` (fecha planificada)
  - `uploaded_at timestamptz NULL` (poblado cuando se marca "subido")
  - `status text NOT NULL default 'planificada' check (status in ('planificada','subida','fallida','cancelada'))`
  - `public_url text` (link al posteo real, una vez subido)
  - `notes text`
  - `created_at, updated_at, created_by`
- Unique parcial: **NO** — se permite explícitamente subir el mismo asset a la
  misma plataforma varias veces (retry, o cadencia distinta). El control de "no
  repetir" vive en la UI + en el flag `allow_repeat_asset` de `publishing_cadences`.
- Índices: `(organization_id)`, `(content_asset_id)`, `(scheduled_for)`,
  `(platform, scheduled_for) where status = 'planificada'`.
- Trigger `set_updated_at`.
- RLS org-scope.

### 0164_marketing_editor_availability.sql

- `editor_availability` (org-scope): bloques de disponibilidad de editores.
  - `id, organization_id, person_id NOT NULL references organization_people(id) on delete cascade`
  - `date_from date NOT NULL, date_to date NOT NULL check (date_to >= date_from)`
  - `available boolean NOT NULL` (true = disponible; false = licencia/ausencia)
  - `notes text`
  - `created_at, updated_at, created_by`
- Índices: `(organization_id)`, `(person_id, date_from, date_to)`.
- Trigger `set_updated_at`.
- RLS org-scope.
- **Motivación:** el usuario pidió "planificación semanal por editor de contenido
  según fechas, disponibilidad del editor". Modelo simple, no slots-por-hora — un
  editor está o no está disponible en un rango de días.

### 0165_marketing_stage_triggers.sql

Triggers en `content_pieces` y `content_uploads` que mueven el stage
automáticamente sin acoplar el frontend a lógica de negocio:

- Trigger `content_piece_stage_from_recording`:
  - Cuando `recording_session_id` se setea y la sesión pasa a `status='realizada'`,
    el piece pasa a `stage='en_edicion'`.
- Trigger `content_piece_stage_from_asset`:
  - Cuando se inserta un `content_assets` con `source_content_piece_id = X` y
    `edited_at IS NOT NULL`, el piece pasa a `stage='listo_para_subir'`.
- Trigger `content_piece_stage_from_upload`:
  - Cuando existe al menos un `content_uploads` con
    `content_asset_id.source_content_piece_id = X` en `status='subida'`, el piece
    pasa a `stage='publicado'`.
- Trigger `content_piece_daily_regenerate`:
  - **Solo** cuando `is_daily_recurring = true` y la transición es a `'publicado'`.
    Inserta un clon del piece con `scheduled_publish_at = scheduled_publish_at +
    1 day`, `scheduled_recording_at = null`, `stage = 'planificado'`,
    `recording_session_id = null`. Copia guión + plataformas + categoría + formato.
    Mismo patrón que "tareas recurrentes" de 0139 pero para content_pieces.

Todos los triggers son `AFTER UPDATE/INSERT` con guardas de idempotencia.

---

## Selectores (src/lib/marketing/)

Sin cálculos duplicados. Nuevos selectores puros:

- **`src/lib/marketing/types.ts`** — tipos de las 7 tablas + tipos derivados
  (`ContentPieceRow`, `RecordingSessionWithAssignees`, `AssetStock`, etc.).
- **`src/lib/marketing/stock.ts`**:
  - `computeStockByOwnerPlatformFormat(assets, uploads)` → Map<owner_id ×
    platform × format, count> de assets sin usar. "Sin usar" = no aparece en
    `uploads` en `status='subida'` **si** `allow_repeat_asset=false` para esa
    cadencia; si `allow_repeat_asset=true`, cuenta todos los assets editados.
  - `computeDaysOfCoverage(stock, cadences)` → Map<owner_id × platform, {days,
    stockCount, dailyRate}> — divide stock por `posts_per_day` de la cadencia.
    Devuelve `null` si no hay cadencia configurada para ese par (owner, platform).
- **`src/lib/marketing/alerts.ts`**:
  - `computeCoverageAlerts(coverage, thresholds)` → devuelve
    `{ownerId, platform, daysRemaining, severity: 'critical'|'warning'|'ok'}[]`.
  - Umbrales default: `< 3 días = critical, < 7 días = warning`. Configurables por
    owner en fase futura.
- **`src/lib/marketing/calendar.ts`**:
  - `groupByDate(items, dateKey)` → Map<yyyy-mm-dd, T[]> para pintar días del
    calendario. Utilitario puro reutilizable por grabación y publicación.
- **`src/lib/marketing/editor-load.ts`**:
  - `computeEditorLoadByWeek(assets, availability, since, until)` → Map<person_id
    × iso_week, {assigned_assets, available_days}>. Alimenta la planificación
    semanal de editores.

Reglas: selectores puros, sin efectos, sin fetch. Tests colocados junto al `.ts`
(mismo patrón que `src/lib/finance/*.test.ts`).

---

## Estructura de rutas

```
/marketing                              → Dashboard (stock + alertas + throughput)
/marketing/planificacion                → Bloque 1: tabla de content_pieces (todos los stages)
/marketing/grabacion                    → Bloque 2: tabla + calendario de recording_sessions
/marketing/grabacion?view=calendario    → toggle vía KgParamPills
/marketing/edicion                      → Bloque 3: assets (con drag/asignación editor + planning semanal)
/marketing/subidas                      → Bloque 4: uploads (tabla + calendario)
/marketing/subidas?view=calendario      → toggle vía KgParamPills
/marketing/stock                        → Stock detallado por owner/platform/format
/marketing/duenos                       → Config: content_owners CRUD + handles
/marketing/duenos/[ownerId]             → Ficha del dueño (pipeline completo scoped)
/marketing/cadencias                    → Config: publishing_cadences
/marketing/disponibilidad               → Config: editor_availability
```

**Ficha `/marketing/duenos/[ownerId]`**: mismo patrón que `/clientes/[clientId]`
(un solo page, múltiples `<Panel>` sections: planificación scoped al dueño,
grabación scoped, edición scoped, publicación scoped, stock por plataforma,
alertas). No sub-routing.

**Vista dual tabla ⇄ calendario** (bloques 2 y 4): `?view=tabla|calendario` +
`KgParamPills`, patrón confirmado — SIN parallel routes ni state client. El
calendario es un componente **nuevo** (no existe en `kg/`), grid CSS mes-a-mes,
click en día → `<Drawer>` con lista de items + botón crear. Se buildea from
scratch — mismo tamaño que armar un `KgDataTable` (~200 líneas), no vale meter
lib externa.

---

## Bloques (orden de commits)

### 0. Sub-gate del bloque

- [x] Releer las 9 migraciones nuevas antes de escribir código de UI.
- [x] Confirmar que `src/lib/marketing/` no existe todavía.
- [x] Confirmar rutas y componentes reutilizables (Drawer, KgDataTable,
      HeroKpi, KgParamPills, StatusPill, StateDot).
- [x] Registrar módulo en `layers.ts` bajo `ROLE_MODULE_ALLOWLIST` con
      `coordinador` y `operador` incluidos.

### 1. Configuración (obligatoria antes de todo lo demás)

- [x] **CRUD `content_owners`** (`/marketing/duenos`): drawer + server action
      con `useActionState` + `revalidatePath`. `active` + soft delete con
      guard duro (bloquea borrar si hay cadencias colgadas). Handles por
      plataforma nullables (IG/FB/TT/YT). Unique parcial por
      `(org, lower(name)) where active`.
- [x] **CRUD `publishing_cadences`** (`/marketing/cadencias`): tabla plana
      por dueño × plataforma × formato. `upsertCadence` con PK compuesta,
      `deleteCadence` por triada. Picker de owners activos.
      `allow_repeat_asset` como toggle por fila.
- [x] **CRUD `editor_availability`** (`/marketing/disponibilidad`): drawer
      simple (person + rango + available + notes). Vista tabla con filtro
      por persona. Cerrado junto con Bloque 3 (2026-08-24).

### 2. Bloque 1 — Planificación

- [x] **CRUD `content_pieces`** (`/marketing/planificacion`): drawer 620px
      con title, dueño, categoría, formato, plataformas (grid 2×2 checkboxes
      con borde carmesí al marcar), scheduled_recording_at + scheduled_publish_at,
      script_md (textarea 7 filas), toggle "Tarea diaria" con copy, notas.
      `deletePiece` gated por (stage='planificado' AND recording_session_id
      IS NULL); resto se descarta con `setPieceStage('descartado')`.
- [x] Vista tabla con columnas: título (+ badge "Diaria" si aplica), dueño,
      categoría, formato, plataformas (chips), grabación, publicación, stage
      (`StatusPill` con tono semántico de `STAGE_TONE`).
- [x] Filtros vía `searchParams`: `stage` (open|all|individual), `owner`,
      `category`, `format`. 4 `KgParamPills` apiladas. Default `stage=open`
      esconde publicado+descartado.
- [x] Estado vacío que explica "Cuando planificás un contenido, se lista
      acá y pasa a Grabación cuando lo asignás a una sesión".

### 3. Bloque 2 — Grabación

- [x] **CRUD `recording_sessions`** (`/marketing/grabacion`): drawer 640px
      con owner, fecha/hora, duración, ubicación, materiales, notas, y
      **filas dinámicas +/- de assignees (persona + rol)**. Junction
      `recording_assignees` con PK compuesta que incluye rol → una misma
      persona puede tener dos roles distintos. `syncAssignees` calcula
      diff (delete + insert).
- [x] **Asociación de content_pieces**: lista de checkboxes dentro del
      drawer filtrada por owner elegido y por pieces libres (o ya asociadas
      a esta sesión). Cambiar owner resetea la selección. `syncPieces`
      valida que las pieces pertenecen al owner y no están tomadas por
      otra sesión antes de asociar.
- [x] Vista **tabla** default: sesiones ordenadas por `scheduled_at desc`,
      chips de assignees con rol, count de pieces, `StatusPill` semántico,
      dropdown inline para cambiar status.
- [x] Vista **calendario** (`?view=calendario`): componente nuevo
      `src/components/kg/calendar.tsx` — grid mensual 7×6 con día actual
      resaltado, count badge + hasta 3 eventos por día con dot semántico,
      "+N más" si desborda. Click día → `<Drawer>` con lista de sesiones
      del día + editar cada una + "+ Nueva sesión este día".
- [x] Marcar sesión como `status='realizada'` dispara el trigger de stage
      (0160): todas las pieces asociadas en `planificado|en_grabacion`
      pasan a `en_edicion` en un solo statement bulk update. Idempotente.

### 4. Bloque 3 — Edición

- [x] **CRUD `content_assets`** (`/marketing/edicion`): drawer 620px para
      registrar cada corte editado (name, format, duration, drive_folder_url,
      drive_asset_url, editor_person_id, source_recording_session_id,
      source_content_piece_id, edited_at, notes). Owner filtra los pickers
      de sesión/piece; toggle "Marcar como editado" con datetime-local +
      default `now()`.
- [x] **Planning semanal por editor**: vista pivot (persona × semana, 4
      semanas rolling desde el lunes actual) con count de assets asignados
      y días disponibles. Punto rojo cuando `assignedAssets > 0 &&
      availableDays === 0`. Toggle local tabla ⇄ planning (no en searchParams).
- [x] Al setear `edited_at` sobre un asset con `source_content_piece_id`,
      el piece pasa a `listo_para_subir` (trigger `content_piece_stage_from_asset`
      de 0162, dispara en INSERT y en UPDATE de `edited_at`).
- [x] Vista principal: tabla con filtros por estado (`queued|edited|all`),
      editor, dueño, formato. 4 `KgParamPills` apiladas.
- [x] Estado vacío: "Los assets aparecen acá después de una grabación
      realizada. Un asset por cada corte final que salga de la sesión."

### 5. Bloque 4 — Subidas / Publicación

- [x] **CRUD `content_uploads`** (`/marketing/subidas`): drawer 560px con
      picker de asset filtrado por owner + platform, respetando
      `allow_repeat_asset` (assets ya subidos a esa platform con cadencia
      sin repetir → ocultos). En modo edit el asset original siempre
      aparece para no perder la selección.
- [x] Vista **tabla** default con filtros: estado (`open|all|individual`),
      plataforma, dueño. Default `status=open` esconde subida + cancelada.
- [x] Vista **calendario** (`?view=calendario`) reutilizando `KgCalendar`
      de Bloque 2. Click día → `<Drawer>` con lista de subidas + botón
      "Marcar subida" inline + "+ Nueva subida este día".
- [x] Acción "Marcar como subido" (`markUploaded`) — drawer separado pide
      `public_url` opcional, setea `status='subida'` y el trigger 0163
      pobla `uploaded_at`. El trigger 0165 dispara stage `listo_para_subir`
      → `publicado` del piece origen; si `is_daily_recurring`, regenera
      hermano al día siguiente (nueva migración 0165, con fallback
      `current_date + 1` si el piece no tenía scheduled_publish_at).

### 6. Stock y alertas

- [ ] `/marketing/stock`: tabla pivot owner × platform × format con
      `stockCount, daysOfCoverage, dailyRate`. Ordenar por `daysOfCoverage`
      asc (los que están a punto de agotarse arriba).
- [ ] Coloreado vía `StateDot` (rojo `< 3 días`, ámbar `< 7 días`, ok
      resto). El número nunca se pinta — regla heredada.
- [ ] Empty state: "Configurá cadencias en `/marketing/cadencias` para que
      Stock pueda calcular días de cobertura."
- [ ] Toggle "solo owner activo" default.

### 7. Dashboard `/marketing`

- [ ] KPIs de cabecera (`HeroKpi`):
  - Contenido en stock (assets no usados)
  - Días mínimos de cobertura (el owner/platform peor parado) —
    `tone="negative"` si `< 7`, `featured` si `< 3`.
  - Sesiones planificadas próximos 14 días
  - Assets editados últimos 7 días
- [ ] Panel "Alertas de cobertura": top 5 combinaciones owner/platform
    ordenadas por `daysOfCoverage` asc. Link a `/marketing/stock`.
- [ ] Panel "Próximas grabaciones": tabla mini con sesiones del próximo
    mes, agrupadas por día.
- [ ] Panel "Editores esta semana": load pivot chico con warnings de
    over-assignment vs disponibilidad.
- [ ] Panel "Últimas subidas": 10 más recientes con link al `public_url`.
- [ ] **Rango temporal**: mes-actual default + `RangePills` (patrón
    Ejecutivo).

### 8. Tareas recurrentes (contenido diario)

- [ ] Ya cubierto por el flag `is_daily_recurring` + trigger
      `content_piece_daily_regenerate`. Verificación al cerrar:
  - Crear un piece con `is_daily_recurring=true` y `scheduled_publish_at =
    hoy`.
  - Recorrer flujo completo hasta marcar upload como subido.
  - Verificar que aparece un piece hermano con `scheduled_publish_at =
    mañana` y `stage='planificado'`.

---

## Reglas transversales del módulo

- Todos los CRUD siguen el patrón de Clientes/Operaciones: `Drawer` +
  `useActionState` + server action con discriminated union `{ok, id} |
  {error}` + `revalidatePath`.
- **NO borrado duro**. Un piece descartado → `stage='descartado'`. Un asset
  no válido → `active=false` (agregar columna si aparece la necesidad).
- **FKs a nombres legibles**: el drawer nunca muestra un uuid. Owner name,
  person full_name, platform label.
- **Estados vacíos que enseñan**: cada vista vacía explica qué la va a
  llenar. En un módulo con pipeline encadenado, esto es crítico —
  Publicación nunca se llena si no hay Edición, Edición nunca se llena si
  no hay Grabación realizada.
- **Assignment del filmaker/experto es historial**: no borrar filas de
  `recording_assignees`; si una persona sale de una sesión antes de
  grabarse, sí se puede borrar (session no realizada). Post-realización,
  cambio se hace agregando fila nueva con nueva `role` o admin lo hace
  desde Studio si es error.
- **Drive URLs son libres**: no validamos que el link sea de Drive
  específicamente — puede ser Dropbox, Frame.io, Notion. Es una etiqueta de
  "dónde vive el archivo".

---

## Verificación al cerrar el módulo

- [ ] Al menos 2 dueños creados (Rey Academy + Kevin Machado como piloto).
- [ ] Al menos 1 cadencia por dueño × plataforma × formato relevante.
- [ ] 5+ content_pieces en distintos stages para ver el pipeline pintado.
- [ ] 1 recording_session con 2 personas (filmaker + experto) y 3
      content_pieces asociados. Marcar realizada → los 3 pieces pasan a
      `en_edicion` (trigger 0165).
- [ ] 3 assets editados desde esa sesión, con editor asignado y drive URL.
      Marcar edited_at → 1 piece pasa a `listo_para_subir` (trigger).
- [ ] 3 uploads planificados, 1 marcado como subido → piece pasa a
      `publicado` (trigger).
- [ ] Piece marcado con `is_daily_recurring=true` regenera hermano al día
      siguiente cuando se publica (trigger).
- [ ] Dashboard: los 4 KPIs coherentes, alerta roja si `daysOfCoverage <
      3` en algún par owner/platform.
- [ ] Roles: operador ve solo sesiones + assets donde es assignee/editor;
      admin ve todo; cliente rebota a `/lanzamientos`.
- [ ] `tsc --noEmit` en 0. Suite sin regresiones. Tests unitarios para
      `stock.ts`, `alerts.ts`, `editor-load.ts`.

---

## Fuera de scope de v1

- **Ads spend / CPL / ROAS**: sigue siendo parte de LaunchOS
  (`launch_daily_ads`). Si al terminar v1 aparece la necesidad de ver ads
  agregados a nivel org, se retoma la "Opción A" del Anexo B original como
  vista adicional dentro de `/marketing/ads` — es aditiva, no reemplaza.
- **Integración directa con Meta / TikTok / YouTube API**: fuera de scope.
  El status "subida" se marca a mano. Automatizar requiere OAuth por
  cuenta + refresh tokens + rate-limit + attribution — es un proyecto,
  no un módulo. Anexo D si aparece.
- **Análisis de performance del posteo** (views, engagement, saves): fuera
  de scope. Requiere lo mismo que el punto anterior + esquema de métricas
  post-publicación.
- **Colaboradores externos** (agencias, freelancers no en
  `organization_people`): fuera de scope. Un editor tiene que existir como
  `person` para poder asignársele un asset.
- **Aprobaciones / workflow multi-nivel** (jefe aprueba guión, cliente
  aprueba edit): fuera de scope. Agregable como `content_pieces.approved_by`
  + trigger si aparece necesidad — no complica arquitectura.
- **Notificaciones push / email**: fuera de scope. Las alertas se ven en
  dashboard.
- **Historial de cambios de guión** (versionado): fuera de scope. Un
  `script_md` es editable inline; no se archiva versión previa.

---

## Deuda / decisiones abiertas del módulo

- [ ] **¿Cadencia por owner × platform × format o solo owner × platform?**
      Decidido: **owner × platform × format**. Motivación: "reels IG" y
      "carousels IG" tienen ritmos distintos aunque compartan plataforma.
      Si se demuestra que nadie discrimina en la práctica, se colapsa la PK.
- [ ] **`allow_repeat_asset` en `publishing_cadences`**: ¿es por (owner,
      platform, format) o global por owner? Decidido: **granular a nivel
      cadencia**. Consistencia con lo anterior.
- [ ] **¿Hace falta índice único `(content_asset_id, platform)` en
      `content_uploads`?** No — explícitamente permitimos re-subidas. El
      "no repetir" es UX + flag de cadencia, no restricción de datos.
- [ ] **`editor_availability` vs `organization_people.active`**: si el
      editor deja el equipo (`active=false`), sus filas quedan como
      histórico. La UI filtra por `active=true` al asignar assets. Sin
      migración destructiva.
- [ ] **¿Content owner puede ser también un `client`?** No — son
      conceptos separados. `clients` son B2B externos que contratan a
      Kingrow. `content_owners` son las marcas propias que producen
      contenido (aunque en la práctica coinciden con proyectos
      `ownership='propia'`). Si aparece un caso mixto real, se agrega FK
      opcional `content_owners.project_id → projects(id)`.
- [ ] **Estimación total del módulo**: 30-45h de trabajo (9 migraciones,
      5 selectores, 8 vistas CRUD, calendario custom, dashboard, tests).
      Distribuido en los 8 sub-bloques.

---

## Notas del módulo Marketing

### 2026-08-24 — sesión Claude Opus 4.7 (sub-gate + Config + Bloques 1 y 2)

**Migraciones escritas (esperando run en Studio):**

| Archivo | Contenido | Notas |
|---|---|---|
| `0157_marketing_content_owners.sql` | dueños org-scope + handles + active | template 0090; unique parcial en `(org, lower(name)) where active` |
| `0158_marketing_publishing_cadences.sql` | cadencias (owner × platform × format) | PK compuesta; trigger org-match |
| `0159_marketing_content_pieces.sql` | plan editorial con array `platforms` | `recording_session_id` sin FK todavía (aditiva en 0160) |
| `0160_marketing_recording_sessions.sql` | sesiones + FK a pieces + 3 triggers | (a) auto-fill `completed_at`; (b) piece.stage `planificado→en_grabacion` al asignar; (c) session `realizada` → pieces bulk-update a `en_edicion` |
| `0161_marketing_recording_assignees.sql` | junction M:N con rol | PK compuesta incluye rol; trigger org-match |

**Decisiones cerradas que difieren del plan original:**

- **Trigger `content_piece_stage_from_session_status`** movido de 0165 a **0160**
  (tiene sentido que viva con la tabla que lo dispara, `recording_sessions`).
  0165 queda para triggers de assets/uploads/daily-regenerate.
- **Trigger extra `content_piece_stage_from_session_link`** (planificado →
  en_grabacion al asignar) agregado en 0160 — no estaba en el plan pero mejora
  la señal visual del pipeline (una piece con sesión asignada no debería
  seguir contándose como "por planificar").
- **`editor_availability` diferida al Bloque 3.** Sin planning semanal que la
  consuma, ese CRUD es una tabla flotante. La pestaña `/marketing/disponibilidad`
  hoy es un `ModulePlaceholder`.

**Artefactos código (todos con `tsc` + `eslint` en 0):**

```
src/lib/marketing/types.ts                         ← enums + labels + tones + type guards + RowShapes
src/components/kg/calendar.tsx                     ← KgCalendar + helpers puros (buildMonthCells, shiftMonth, toDateKey)
src/components/kg/layers.ts                        ← marketing en allowlist de coordinador y operador

src/app/(app)/(kg)/marketing/
  layout.tsx                                       ← requireRole + 9 tabs
  page.tsx                                         ← ModulePlaceholder (dashboard queda pendiente)
  duenos/{page,duenos-view,owner-form-drawer,actions}.tsx
  cadencias/{page,cadencias-view,cadence-form-drawer,actions}.tsx
  planificacion/{page,planificacion-view,piece-form-drawer,actions}.tsx
  grabacion/{page,grabacion-view,session-form-drawer,actions}.tsx
  {edicion,subidas,stock,disponibilidad}/page.tsx  ← ModulePlaceholder cada uno
```

**Roles gateados** (`layers.ts` + `layout.tsx`): superadmin, admin, coordinador,
operador. Operador todavía NO tiene filtro server-side de "mis assignees" —
se agrega junto con los siguientes bloques cuando exista `editor_person_id`
en `content_assets` y assignee filtering en `recording_sessions`.

**Deuda técnica del módulo:**

- Regenerar `src/lib/types/database.ts` cuando se corran las 5 migraciones
  (`npx supabase gen types typescript --project-id <REF>`). Mientras tanto
  todos los INSERT/UPDATE usan `as never` — mismo patrón que otros módulos
  del proyecto según memoria del usuario.
- `editor_availability` (0164) y triggers finales (0165) siguen pendientes.
- Dashboard `/marketing` sigue como `ModulePlaceholder` — se cierra al final
  cuando existan las 9 migraciones + selectores de stock y alertas.

### 2026-08-24 — sesión Claude Opus 4.7 (Bloque 3 · Edición + Disponibilidad)

**Migraciones escritas (esperando run en Studio):**

| Archivo | Contenido | Notas |
|---|---|---|
| `0162_marketing_content_assets.sql` | assets editados + editor + drive URLs | trigger `content_piece_stage_from_asset` (INSERT y UPDATE de `edited_at`) mueve piece origen a `listo_para_subir`. Guard org-match cross-org (owner + sesión + piece) |
| `0164_marketing_editor_availability.sql` | rangos de disponibilidad por persona | `check (date_to >= date_from)`. Guard org-match person. Filas superpuestas permitidas |

Próximo ordinal libre: **0163** (queda para `content_uploads` del Bloque 4).

**Decisiones cerradas que difieren del plan original:**

- **`allow_repeat_asset` en `content_uploads`**: sin cambios; se enforceará en
  la UI del picker de asset cuando se cierre Bloque 4, no como constraint DB.
- **Regla de "rango-más-específico gana"** en `countAvailableDaysInRange`:
  cuando dos filas de availability se solapan para la misma persona, el rango
  MÁS CORTO (típicamente una licencia puntual) sobrescribe la disponibilidad
  general. Es una heurística intencional para modelar "disponible todo agosto,
  excepto vacaciones 24-26". Documentada en el JSDoc del selector.
- **Vista dual tabla ⇄ planning** en `/marketing/edicion` es **state local**
  (useState), NO `?view=` en searchParams. Motivación: el planning es
  visualmente completo por sí solo y no comparte filtros de tabla — no vale
  la pena la ceremonia. En Grabación sí es searchParams porque la tabla y
  el calendario son proyecciones del mismo dataset con distintos filtros.
- **Planning window**: 4 semanas rolling desde el lunes actual. Se puede
  parametrizar por `?weeks=` si aparece demanda; por ahora hardcoded.

**Artefactos código (todos con `tsc` + `eslint` en 0):**

```
supabase/migrations/
  0162_marketing_content_assets.sql
  0164_marketing_editor_availability.sql

src/lib/marketing/
  types.ts                                           ← + ContentAssetRow + EditorAvailabilityRow
  editor-load.ts                                     ← selector puro (computeEditorLoadByWeek + helpers)
  editor-load.test.ts                                ← 21 tests en verde

src/app/(app)/(kg)/marketing/
  edicion/{page,edicion-view,asset-form-drawer,actions}.tsx     ← reemplaza ModulePlaceholder
  disponibilidad/{page,disponibilidad-view,availability-form-drawer,actions}.tsx  ← reemplaza ModulePlaceholder
```

**Deuda técnica del módulo (sin cambios respecto a sesión anterior):**

- Regenerar `src/lib/types/database.ts` cuando se corran 0162+0164
  (`npx supabase gen types typescript --project-id <REF>`). Mientras tanto los
  INSERT/UPDATE de assets y availability usan `as never`.
- Dashboard `/marketing`, `/marketing/subidas`, `/marketing/stock` siguen como
  `ModulePlaceholder` — se cierran con Bloque 4 (0163) y Stock/Dashboard.
- Migración 0165 (`content_piece_stage_from_upload` + `content_piece_daily_regenerate`)
  pendiente — llega con Bloque 4.

### 2026-08-24 — sesión Claude Opus 4.7 (Bloque 4 · Subidas)

**Migraciones escritas (esperando run en Studio):**

| Archivo | Contenido | Notas |
|---|---|---|
| `0163_marketing_content_uploads.sql` | subidas org-scope + trigger uploaded_at | 3 triggers: org-match cross-org (upload.org=asset.org), set_uploaded_at BEFORE UPDATE OF status (respeta valor explícito), set_uploaded_at_insert BEFORE INSERT |
| `0165_marketing_upload_stage_and_daily.sql` | motor stage upload+daily | `content_piece_stage_from_upload` (INSERT + UPDATE de status): resuelve upload→asset→piece, avanza listo_para_subir→publicado. `content_piece_daily_regenerate` (AFTER UPDATE OF stage): clona hermano al día siguiente con fallback current_date+1 |

Próximo ordinal libre después de esta sesión: **0166**. Todas las 9
migraciones del plan Marketing están escritas.

**Decisiones cerradas que difieren del plan original:**

- **`uploaded_at` respeta valor explícito del operador** — si el operador
  setea la fecha real de subida (ej. "ya se subió hace 3 días"), el trigger
  NO la pisa. Solo pobla `now()` cuando `status='subida'` y `uploaded_at
  IS NULL`. Retrocesos a otros statuses limpian el campo.
- **NO unique constraint sobre (asset, platform, scheduled_for)** —
  explícitamente permitido crear duplicados (retry manual, cadencia con
  `allow_repeat_asset=true`). El "no repetir" es UX + flag de cadencia,
  no restricción de datos.
- **`content_piece_daily_regenerate` con fallback `current_date + 1`** —
  el plan pedía `scheduled_publish_at + 1`, pero si el piece no tenía
  `scheduled_publish_at` (nullable en 0159), no había fecha base. Usamos
  hoy+1 como default sensato en vez de rebotar.
- **Cascada natural del `is_daily_recurring`** — el clon hereda `true`,
  así que también regenerará al publicarse. Se detiene solo si el operador
  edita un piece particular a `is_daily_recurring=false` desde el drawer
  de planificación.
- **Vista dual tabla ⇄ calendario en searchParams** (a diferencia de
  Edición que usó state local) — se comparte el mismo dataset con
  filtros distintos, mismo criterio que Grabación.
- **Botón "Marcar subida" separado del drawer edit** — evita que un
  operador tenga que abrir el drawer completo solo para cambiar el
  estado + pegar un link. Drawer chico dedicado (480px) con solo
  `public_url` opcional.
- **Filtro `?status=open` default** = planificada + fallida — las abiertas
  que necesitan acción. Subidas y canceladas se esconden por default.

**Artefactos código (todos con `tsc` + `eslint` en 0):**

```
supabase/migrations/
  0163_marketing_content_uploads.sql
  0165_marketing_upload_stage_and_daily.sql

src/lib/marketing/
  types.ts    ← + UPLOAD_STATUSES + UPLOAD_STATUS_LABEL + UPLOAD_STATUS_TONE + isUploadStatus + ContentUploadRow

src/app/(app)/(kg)/marketing/
  subidas/{page,subidas-view,upload-form-drawer,actions}.tsx  ← reemplaza ModulePlaceholder
```

**Deuda técnica del módulo (sin cambios respecto a sesión anterior):**

- Regenerar `src/lib/types/database.ts` cuando se corran 0162+0163+0164+0165
  (`npx supabase gen types typescript --project-id <REF>`). Mientras tanto
  todos los INSERT/UPDATE usan `as never`.
- `sync-ghl.test.ts` sigue con 1 test rojo — pre-existente, no relacionado.
- Dashboard `/marketing` + `/marketing/stock` siguen como `ModulePlaceholder`
  hasta que se cierren sus bloques (últimos 2).

### _(completar en la próxima sesión)_
