# Integración Notion — Sync a `internal_projects`

> Vivo. Se actualiza a medida que se cierran sub-fases.

---

## Estado (2026-08-19)

**Cerrado en chats previos:**
- ✅ **4a Foundation** — commit `d51c3e0`. Migración 0132 + client TS +
  config UI de workspaces.
- ✅ **4b Sync users + mapping** — commit `5e8fac8`. Actions + UI en
  `/configuracion/notion/[wsId]/usuarios`.
- ✅ **4c Sync projects** — commit `04f19fe`. Property parser + map-page
  + sync engine + UI de databases con mapping form + badges en Ops.
- ✅ **4d Comentarios read** — commit `58d969e`. Migración 0133
  (`internal_project_notion_comments`) + `listPageComments` en el
  client + fase de sync de comentarios dentro de `syncNotionDatabase`
  + sección "Comentarios de Notion" readonly en la ficha del
  `internal_project` (solo cuando `notion_page_id NOT NULL`).
- ✅ **4e Comentarios write + @mentions** — commit `3dedec2`.
  `postPageComment` en el client + action `postNotionComment(projectId,
  contentPlain, mentionedNotionUserIds[])` + composer client component
  en la ficha con autocomplete solo de notion_users mapeados a
  `organization_people`. Server prefija el content con `{KG fullName}
  escribió: ` para preservar autoría visible (los comments de
  integration aparecen firmados por el bot). Mentions se validan
  server-side (solo mapeados) para bloquear intentos de spoof.

**Cerrado en este chat:**
- ✅ **4f Cron** — endpoint `GET /api/cron/notion-sync` con guard de
  `CRON_SECRET` (mismo secret que `sync-integrations`, ver `.env.example`).
  Refactor: el core del sync se extrajo a `src/lib/notion/sync-runner.ts`
  (`runNotionDatabaseSync` + `runAllEnabledNotionDatabases` + helper
  `computeIncrementalAnchor`). Las server actions `syncNotionDatabase`
  y `syncAllEnabledNotionDatabases` ahora son wrappers finos
  (requireRole + createClient + delegate + revalidate). El cron
  usa `createServiceClient()` para bypassear RLS y pide
  `{ incremental: true }`, que calcula por DB el
  `MAX(started_at)` del último log ok/partial y aplica el filter
  `last_edited_time on_or_after {anchor}` al query a Notion.
  Registrado en `vercel.json` con schedule `*/15 * * * *`.

**Decisiones tomadas en 4f (respondiendo a las abiertas del chat previo):**

1. `vercel.json` — el repo ya lo tenía para `sync-integrations`; se
   agregó una segunda entrada al array `crons`. Migrar a `vercel.ts`
   quedó como scope creep no justificado.
2. `CRON_SECRET` reutilizado — ya está declarado en `.env.example` y
   configurado en el proyecto Vercel; no es necesario un secret
   separado por cron.
3. Alcance = `syncAllEnabledNotionDatabases` con `incremental: true`.
4. Anchor = `MAX(started_at)` del último log ok/partial de esa DB —
   preferido sobre `notion_synced_at` de projects porque sobrevive a
   futuros rewrites del schema y funciona en primer run (no depende
   de que ya hayan entrado projects).

**Limitación conocida del incremental** (documentada en `sync-runner.ts`):
el filter de Notion por `last_edited_time` no detecta pages que sólo
recibieron **comentarios nuevos** — los comentarios no bumpean el
`last_edited_time` de la page. El cron pierde esos comments hasta que
la page reciba un edit de propiedad. Fallback: el botón manual
"Sincronizar Notion" en Ops corre full-sync y recupera todo.

**Pendiente para próximos chats:**
- Nada del bloque Notion. El siguiente ítem del backlog es lo que ya
  arrastra el plan: soft-delete de pages borradas en Notion + lock
  contra syncs concurrentes sobre la misma DB (ver "Riesgos" al final).

**Pendiente de PROBAR end-to-end** (bloqueado en que el usuario
consiga admin del workspace de Notion — al 2026-08-18 estaba
pidiéndolo; escenario alternativo: OAuth público, ver "Pivot a OAuth"
más abajo):

1. `/configuracion/notion` → "+ Agregar workspace" → pegar internal
   integration token → "Probar conexión" (debería devolver el
   workspace_name) → "Guardar".
2. En la card del workspace nuevo → click "Descubrir DBs" — debería
   listar las databases que la integration tiene compartidas.
3. Click "Usuarios" en la card → "Sincronizar ahora" — deberían aparecer
   los users type='person' del workspace + auto-match por email para los
   que ya tienen email en `organization_people`. Los sin match usan el
   dropdown para asignar manualmente.
4. Click "Databases" en la card → elegir una DB → "Configurar mapeo":
   - Elegir `title_prop` (obligatorio — Notion siempre tiene una col
     type='title').
   - Configurar `status_prop`/`priority_prop` (opcional) + mapear los
     option values de Notion a los valores KG.
   - Elegir `assignee_prop`, `due_prop`, `start_prop`,
     `description_prop` según necesites.
   - Guardar.
5. Volver a la lista de DBs → "Habilitar" la que configuraste → click
   "Sincronizar" en esa DB → verificar el mensaje de resultado (N
   fetched, N upserted, N skippedNoTitle).
6. Ir a `/operaciones/proyectos` — deberían aparecer los pages como
   internal_projects con badge "Notion" al lado del nombre. Click en el
   badge abre el page en Notion. Click en "Editar" muestra warning
   amarillo "los cambios acá se sobreescriben".
7. Botón "Sincronizar Notion" arriba a la derecha — corre TODAS las DBs
   enabled de TODOS los workspaces enabled. Devuelve el resumen.
8. Abrir un project en `/operaciones/proyectos/[id]` con `notion_page_id
   NOT NULL` → panel "Comentarios de Notion" al pie:
   - Si en Notion ya hay comentarios en esa page, deberían aparecer
     listados (avatar + nombre resuelto por preferencia KG-person →
     notion-name → fallback + badge "Kingrow" cuando está mapeado).
   - Escribir en el composer + agregar 1-2 chips de mentions →
     "Publicar en Notion". En Notion, el comment aparece firmado por el
     bot con el prefijo `{tu nombre KG} escribió: ` y las @menciones al
     final. Los mencionados reciben notif nativa de Notion.
   - Verificar que el comment aparece inmediato en el panel local sin
     esperar al próximo sync (cache local que la action escribe).
9. **Cron `/api/cron/notion-sync`** — testeo con `curl` (asegurate de
   tener `CRON_SECRET` en `.env.local`):
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/notion-sync
   ```
   - Sin header → `401 unauthorized`.
   - Con header correcto → JSON con `startedAt/finishedAt/workspacesRun/
     databasesRun/totalUpserted/totalCommentsUpserted/errors`.
   - Primera corrida = full sync (no hay log previo). Segunda corrida
     inmediata = 0 pages fetched (todos los `last_edited_time` son
     anteriores al anchor del run anterior).
   - Editar una page en Notion → volver a hitear → ese page debería
     aparecer en el sync (upserted=1) y sus comments re-sincronizarse.
   - En Vercel prod se dispara solo cada 15 min por el schedule del
     `vercel.json`.

**Pivot a OAuth (si no se consigue admin en Notion):**
- Escenario: el usuario NO es owner/admin de ninguno de los workspaces
  que quiere sincronizar → no puede crear una internal integration →
  necesita OAuth público donde alguien más registra la integration y
  el usuario la instala en su workspace.
- Trabajo extra estimado: 4-6h aditivo al final de este bloque:
  - Registrar Public integration en Notion (owner de UN workspace la
    crea; puede ser un workspace personal gratis).
  - Endpoints `/api/notion/oauth/start` + `/api/notion/oauth/callback`.
  - Env vars `NOTION_OAUTH_CLIENT_ID` + `NOTION_OAUTH_CLIENT_SECRET` +
    redirect URI whitelist en Notion.
  - Botón "Conectar con Notion" al lado del form manual — mismo
    downstream (guarda `access_token` en `notion_workspaces.secret_token`).
- Toda la infra actual (4a-4c) sirve intacta — solo cambia el modo de
  obtener el token.

---

## Decisión de arquitectura (2026-08-18)

**Notion → `internal_projects` (Ops).** Cada page de una Notion database
sincronizada aterriza como un `internal_projects` de Kingrow. Las tareas
concretas se cargan nativas en KG (`tasks.internal_project_id`), con
bloqueadores (`blockers`) y tiempo (`time_entries`) reales del schema.
Nada de duplicar hierarchy con parent_task_id.

**Por qué Opción A y no macro/micro como tasks:**
- El schema ya modela "proyecto → tarea → bloqueador/tiempo" — el flujo
  del usuario se computa con selectores puros sobre lo que existe.
- Tiempo total del proyecto = `SUM(time_entries.minutes) WHERE
  internal_project_id = X`.
- Productividad = `closed_at vs due_on` + tiempo neto vs tiempo con
  bloqueadores. Cálculo sin schema nuevo.
- Opción B (parent_task_id + dependencies) rompía load/throughput por
  tener que decidir si una macro con 5 micros cuenta 1 o 6, y complicaba
  la propagación de bloqueadores entre niveles.

**Decisiones cerradas** (respuestas del usuario):

1. Todo desde Notion → `internal_projects` uniforme. Micros standalone
   caen igual como projects sin subtasks.
2. **Multi-workspace desde day 1** — todos los workspaces que el usuario
   agregue por config.
3. **Internal integration token** (no OAuth). Un token por workspace,
   guardado en `notion_workspaces.secret_token`.
4. **Comentarios en texto plano** en v1. Rich text queda para v2.
5. Config UI en **`/configuracion/notion`** para superadmin + dev.

---

## Sub-fases

### 4a — Foundation (este chat)

Migración + config UI mínima + client TS.

- [x] Migración `0132_notion_integration.sql`:
  - Cols en `internal_projects`: `notion_page_id text`,
    `notion_database_id text`, `notion_workspace_id uuid`,
    `notion_synced_at timestamptz`. UNIQUE parcial en `notion_page_id`.
  - Tabla `notion_workspaces` org-scope con `secret_token`,
    `last_verified_at/ok`.
  - Tabla `notion_databases` con `property_map jsonb` (mapping deferred
    a 4c).
  - Tabla `notion_users` con `kg_person_id` (mapping deferred a 4b).
  - Tabla `notion_sync_log` con `kind ∈ {users, database, workspace}`
    + status ∈ {running, ok, error, partial}.
  - Helper `org_of_notion_workspace()` para RLS heredada.
  - RLS `can_edit_organization` en las 4 tablas (superadmin/dev via
    `is_kingrow_admin` = `is_superadmin` — matchea 0051).
- [x] Client TS `src/lib/notion/client.ts` con:
  - `whoAmI(token)` — GET /v1/users/me (para test connection).
  - `listDatabases(token)` — POST /v1/search filter=database, paginado.
  - `queryDatabase(token, dbId, opts?)` — POST /v1/databases/:id/query,
    paginado con filter/sorts pass-through (usado en 4c).
  - `listUsers(token)` — GET /v1/users, paginado (usado en 4b).
  - `NotionApiError` con status + code + message.
- [x] Config UI en `/configuracion/notion`:
  - Nueva pestaña en el layout (superadmin + dev).
  - Lista de workspaces con verificación (last_verified_at) + toggle
    enabled + eliminar + contador de DBs activas.
  - Form "+ Agregar workspace" con "Probar conexión" (whoAmI) antes
    de guardar.
  - Botón "Descubrir DBs" por workspace que upserta `notion_databases`
    preservando `enabled` y `property_map` de las ya conocidas.
- [x] Server actions con `requireRole("superadmin")`:
  `testNotionConnection`, `createNotionWorkspace`,
  `setNotionWorkspaceEnabled`, `deleteNotionWorkspace`,
  `discoverNotionDatabases`.

### 4b — Sync de usuarios + mapping UI (este chat)

Antes de importar proyectos hay que tener el mapa de usuarios para
resolver assignees/owners.

- [x] Action `syncNotionUsers(workspaceId)`:
  - Llama a `listUsers` de la API Notion (paginado).
  - Filtra `type='person'` (bots no aportan al mapeo).
  - Upsert por (workspace_id, notion_user_id) — INSERT si es nuevo,
    UPDATE de email/name/avatar si ya existe.
  - Auto-matchea por email lowercased contra `organization_people`
    activas de la org SOLO cuando el kg_person_id está null. Preserva
    mappings manuales del humano.
  - Loguea la corrida en `notion_sync_log` con `kind='users'` y status
    running → ok / partial / error.
- [x] Action `setNotionUserPersonMapping(workspaceId, notionUserId,
  kgPersonId | null)` — mapping manual desde el dropdown.
- [x] Action `autoMatchNotionUsers(workspaceId)` — corre solo el
  matching por email sin refetch a Notion. Útil cuando cambian emails
  en Personas después del último sync.
- [x] UI en `/configuracion/notion/[workspaceId]/usuarios`:
  - Header con stats: total, mapeados, sin mapear (con tone warning
    si > 0).
  - Botones "Sincronizar ahora" y "Auto-matchear por email".
  - Tabla: avatar + name + email + dropdown de personas activas.
    Border amarillo en el dropdown cuando la fila está sin mapear.
  - Optimistic UI: cambio del dropdown persiste inmediato con rollback
    si el server falla. Badge "✓ guardado" en las filas modificadas.
  - Link "Usuarios" en cada `WorkspaceRow` que navega acá.

### 4c — Sync de projects (este chat)

Con users mapeados, ya se puede importar pages como projects.

- [x] Client Notion: `retrieveDatabase(token, dbId)` para traer el schema
  con properties + options (para poblar los dropdowns del form de
  mapping).
- [x] `src/lib/notion/property-parser.ts` — pures: `parseTitle`,
  `parseRichText`, `parseSelect` (soporta type='select' y 'status'),
  `parsePeople`, `parseDateStart`, `applyValueMap`. 22 tests.
- [x] `src/lib/notion/property-map.ts` — shape del `property_map` jsonb
  + parser defensivo (`parsePropertyMap`) + serializer. Descarta valores
  KG inválidos silenciosa (previene romper CHECKs del schema).
- [x] `src/lib/notion/map-page-to-project.ts` — función pura
  `mapNotionPageToInternalProject(page, map, ctx)`. Rebota con
  reason='missing-title' si no hay título (name es NOT NULL). Fallbacks
  a 'backlog'/'med' cuando el map no incluye el valor. Toma el primer
  assignee mapeado. 8 tests.
- [x] UI `/configuracion/notion/[workspaceId]/databases`:
  - Lista de DBs descubiertas con toggle enabled + link "Configurar mapeo".
  - No permite habilitar sin mapping guardado.
  - Botón "Sincronizar" por DB (sync manual solo de esa DB, útil para
    testing).
- [x] UI `/configuracion/notion/[workspaceId]/databases/[databaseId]`:
  - Form dinámico con dropdowns filtrados por type esperado (title/
    select/status/people/date/rich_text).
  - Cuando el usuario elige status/priority_prop aparecen los options
    reales de esa columna con dropdown para elegir el valor KG.
  - Guarda vía `saveNotionDatabaseMapping`.
- [x] Actions nuevas (superadmin/dev): `setNotionDatabaseEnabled`,
  `retrieveNotionDatabaseSchema`, `saveNotionDatabaseMapping`,
  `syncNotionDatabase` (una DB), `syncAllEnabledNotionDatabases`
  (orquestador para el botón de Ops).
- [x] Sync engine:
  - Log inicial 'running' → 'ok/error/partial' al finalizar.
  - Precomputa map notion_user_id → kg_person_id (evita N queries).
  - Upsert en `internal_projects` con `onConflict: notion_page_id`
    (usa el UNIQUE parcial de 0132). Los projects nativos KG
    (notion_page_id NULL) NO se tocan.
- [x] UI de `/operaciones/proyectos`:
  - Badge "Notion" al lado del nombre con link al page de Notion
    (target=_blank).
  - Botón "Sincronizar Notion" arriba a la derecha con mensaje de
    resultado (workspaces sincronizados, DBs, upserts, errores).
  - Warning amarillo en el drawer de edit cuando el project tiene
    notion_page_id: "Los cambios acá se sobreescriben en el próximo sync".
- [x] Link "Databases" en la card de cada workspace en la lista de
  workspaces (paralelo al de Usuarios).

### 4d — Comentarios read (este chat)

- [x] Migración 0133 con tabla `internal_project_notion_comments`
  (`id, organization_id, internal_project_id fk cascade, notion_comment_id
  text unique, notion_user_id, content_plain, created_time, updated_time,
  synced_at`) + RLS `can_edit_organization`.
- [x] Cliente `listPageComments(token, pageId)` que hace
  `GET /v1/comments?block_id={pageId}` paginado y aplana `rich_text` a
  `content_plain`.
- [x] `syncNotionDatabase` extendido con una fase de comentarios post-upsert
  de projects: mapea page_id → internal_project_id (select por
  `.in('notion_page_id', ...)`) e upserta comentarios por
  `notion_comment_id`. Errores por page son tolerados (`commentsFailed`
  contador, log queda `partial`).
- [x] Retornos `SyncDatabaseResult` y `SyncAllResult` extendidos con
  `commentsUpserted` / `commentsFailed` / `totalCommentsUpserted`.
  Mensajes de UI (databases-view + internal-projects-view) actualizados.
- [x] UI ficha `/operaciones/proyectos/[projectId]`: nuevo panel
  "Comentarios de Notion" (solo visible con `notion_page_id NOT NULL`)
  con avatar, nombre resuelto por preferencia
  KG-person→notion-name→fallback, badge "Kingrow" cuando el autor está
  mapeado a una `organization_person`, fecha de creación y content plano
  (`whitespace: pre-wrap`). Empty-state explicativo cuando no hay
  comentarios todavía.

### 4e — Comentarios write + @mentions (este chat)

- [x] Cliente `postPageComment(token, pageId, richText)` +
  tipos `NotionRichTextBlock` (text|mention) y `NotionCommentCreated`.
- [x] Action `postNotionComment(projectId, contentPlain,
  mentionedNotionUserIds[])`:
  - `requireRole("superadmin", "admin", "coordinador", "operador")` (dev
    entra por bypass) — mismos roles que ven Ops.
  - Rebota si el project no tiene `notion_page_id`/`notion_workspace_id`
    o si el workspace está deshabilitado.
  - Filtra los `mentionedNotionUserIds` server-side: sólo los que
    (a) existen en `notion_users` del workspace y (b) tienen
    `kg_person_id NOT NULL`. Los demás se descartan silenciosamente
    (defensa contra abuso — la UI no debería mandar otros).
  - Rich text final = `[text "{KG name} escribió: ", text content, text
    " · cc: ", mention_1, " ", mention_2, ...]`. El prefijo con el
    `fullName` del `SessionProfile` preserva la firma humana visible
    en Notion (la API no permite spoofear autoría con internal integs).
  - Post-Notion: insert local en `internal_project_notion_comments`
    (`notion_user_id: null` porque quien firma es el bot) para display
    inmediato en la ficha sin esperar al próximo sync. Errores del
    insert local no rompen la operación — el próximo sync trae la fila.
  - `revalidatePath` de la ficha del project.
- [x] UI `notion-comment-composer.tsx` (client component):
  textarea + chips de menciones con "×" + dropdown para agregar +
  botón "Publicar en Notion". El dropdown se puebla con el subset
  mapeado de `notion_users` que se calcula server-side en la ficha
  (`kg_person_id IS NOT NULL`, `displayName` = nombre KG si hay,
  sino nombre Notion). Mensaje ok/error inline debajo del composer.
- [x] Renderizado en la ficha: composer arriba de la lista de
  comentarios readonly, ambos dentro del panel "Comentarios de Notion".

### 4f — Cron (este chat)

- [x] Endpoint `GET /api/cron/notion-sync` con guard `Authorization:
  Bearer $CRON_SECRET` (mismo secret que `sync-integrations`).
- [x] Refactor: sync core movido a `src/lib/notion/sync-runner.ts`
  (`runNotionDatabaseSync` + `runAllEnabledNotionDatabases` + helper
  `computeIncrementalAnchor`). Actions server (`syncNotionDatabase` +
  `syncAllEnabledNotionDatabases`) reducidas a wrappers finos que
  hacen `requireRole → createClient → runner → revalidatePath`.
- [x] Cron corre con `createServiceClient()` (bypassea RLS — no hay
  sesión de usuario) + `{ incremental: true }` que calcula el anchor
  por DB (`MAX(started_at)` del último `notion_sync_log` ok/partial)
  y aplica un Notion timestamp filter
  `last_edited_time on_or_after {anchor}` al query.
- [x] Registrado en `vercel.json`: `"*/15 * * * *"` para
  `/api/cron/notion-sync`. `CRON_SECRET` ya estaba en `.env.example`.
- [x] Botón manual "Sincronizar Notion" en Ops sigue haciendo full
  sync (comportamiento intacto — el runner pasa `sinceIso: undefined`
  cuando no se pide incremental).

---

## Paso a paso — obtener el token de Notion internal integration

Cada workspace que quieras sincronizar necesita su propio integration +
token. Repetir para cada uno.

1. **Ir a la lista de integrations**
   👉 <https://www.notion.so/my-integrations>

2. **Click en "+ New integration"** (arriba a la derecha).

3. **Configurar la integration:**
   - **Name**: algo descriptivo, ej. "Kingrow Sync" o
     "Kingrow - Workspace Personal".
   - **Associated workspace**: seleccionar el workspace del que querés
     traer datos.
   - **Type**: "Internal" (default). NO "Public" — ese es OAuth.

4. **Click "Save".**

5. **Copiar el token.** En la pantalla que aparece, sección
   "Internal Integration Secret":
   - Click en "Show" para revelar el token (`secret_xxx...`).
   - Copiar y guardarlo — se muestra solo esta vez fácil, después queda
     bajo "Show" pero se accede desde la misma pantalla.

6. **Configurar capabilities** (pestaña "Capabilities" arriba):
   - ✅ Read content
   - ✅ Insert comments
   - ✅ Read comments
   - ✅ Read user information (**including email**) — necesario para
     matchear con `organization_people`.
   - Los otros (update/delete content) NO hacen falta para v1 (sync
     one-way + solo comentarios).
   - "Save changes" al pie.

7. **Compartir cada database con la integration** (Notion requiere
   compartir explícitamente cada page/DB a la que la integration accede):
   - Abrir la DB de tareas/roadmap en Notion.
   - Click "..." arriba a la derecha → **"Connections"** o
     **"Add connections"**.
   - Buscar el nombre de la integration ("Kingrow Sync") y agregarla.
   - Repetir por cada DB que quieras sincronizar.
   - Alternativamente: compartir una page contenedora — todas las DBs
     hijas heredan el acceso.

8. **Guardar el token en Kingrow:**
   - Login como superadmin o dev.
   - Ir a **`/configuracion/notion`**.
   - Click "+ Agregar workspace".
   - **Nombre**: cómo lo vas a identificar en Kingrow, ej. "Personal" o
     "Equipo Rey Academy".
   - **Token**: pegar el `secret_xxx...` copiado.
   - Click "Probar conexión" — debería listar los DBs a los que tiene
     acceso.
   - Click "Guardar".

9. **Sincronizar usuarios** (una vez conectado el workspace):
   - En el detalle del workspace, click "Sincronizar usuarios".
   - Va a listar todos los users del workspace y auto-matchearlos con
     personas de la org por email.
   - Los que no matcheen quedan con dropdown para asignar manualmente.

10. **Elegir DBs a importar y configurar mapping:**
    - En el detalle del workspace, sección "Databases", aparecen las
      DBs a las que la integration tiene acceso.
    - Toggle "Enabled" en la DB que querés importar.
    - Click "Configurar mapeo" — form para elegir qué prop es status,
      priority, assignee, due, start, y cómo se traducen los valores
      (Notion "Not started" → KG "backlog", etc.).

11. **Correr el primer sync manual** desde `/operaciones/proyectos`
    → botón "Sincronizar Notion".

12. **Verificar** — los pages van a aparecer como internal_projects con
    badge "Notion" y link al page original.

---

## Riesgos y cosas a tener presentes

- **Rate limits de Notion API**: 3 req/s por integration. Para
  workspaces grandes con muchas DBs, el sync tiene que respetar el
  rate limit (throttling en el client TS).
- **Users sin email en Notion**: pasa si el user es guest o si no
  confirmó email. El auto-match falla y quedan sin mapear.
- **Cambios de propiedades en Notion**: si el operador renombra la
  columna "Status" en Notion, el próximo sync falla en esa DB.
  El mapping se hace por NOMBRE de propiedad, no por ID (Notion API
  soporta ambos, elegimos nombre por simplicidad de config).
- **Delete de pages en Notion**: por ahora NO se sincroniza a KG.
  El internal_project queda huérfano (notion_page_id apuntando a page
  que no existe). En 4f-cron se puede agregar detección + soft-delete
  (setear status='archived').
- **Concurrencia**: dos syncs simultáneos sobre la misma DB pueden
  crear duplicados. Guard con `notion_sync_log.status='running'` +
  lock a nivel DB antes de arrancar.
- **Tokens rotados**: si el usuario regenera el token de Notion, el
  guardado en KG queda inválido. La UI muestra "Última sincronización
  falló - revisar token" cuando la API rebota con 401.
