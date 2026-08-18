# Integración Notion — Sync a `internal_projects`

> Vivo. Se actualiza a medida que se cierran sub-fases. Cuando 4a-4c estén
> cerradas se hace `d/e/f` en otro chat.

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

- [ ] Action `syncNotionUsers(workspaceId)` que:
  - Llama a `listUsers` de la API Notion (paginado).
  - Upserta en `notion_users` por (workspace_id, notion_user_id).
  - Auto-matchea con `organization_people` por email lowercased donde
    la persona todavía no está mapeada.
- [ ] UI en `/configuracion/notion/[workspaceId]/usuarios`:
  - Tabla con: notion user (nombre + email + avatar), matcheada con
    (dropdown de `organization_people` filtradas por org).
  - Botón "Auto-matchear por email" corre el matching automático.
  - Botón "Sincronizar usuarios ahora" refetch de Notion.

### 4c — Sync de projects (este chat)

Con users mapeados, ya se puede importar pages como projects.

- [ ] UI en `/configuracion/notion/[workspaceId]/databases`:
  - Lista de DBs descubiertas del workspace con toggle enabled + botón
    "Configurar mapeo" por DB.
  - Form de mapping por DB (guardado en `notion_databases.property_map`
    como jsonb):
    ```
    {
      "title_prop": "Name",         // (por default el título de Notion)
      "status_prop": "Status",       // nombre de la col en Notion
      "status_map": {                // valores Notion → valores KG
        "Not started": "backlog",
        "In progress": "active",
        "Paused": "paused",
        "Done": "done",
        "Archived": "archived"
      },
      "priority_prop": "Priority",   // opcional
      "priority_map": {
        "Low": "low", "Medium": "med", "High": "high", "Urgent": "urgent"
      },
      "assignee_prop": "Assignee",   // People property
      "due_prop": "Due",             // Date property
      "start_prop": "Start",         // Date property (opcional)
      "description_source": "body"   // "body" | "property:Description"
    }
    ```
- [ ] Action `syncNotionDatabase(databaseId)` que:
  - Paginado sobre `queryDatabase`.
  - Por cada page mapea a shape `internal_project`:
    - `name` = title extraído del title_prop
    - `status` = status_map[valor de status_prop] con fallback a 'backlog'
    - `priority` = priority_map[valor] con fallback a 'med'
    - `owner_id` = `notion_users.kg_person_id` matcheado por assignee
    - `due_on`, `starts_on` del date props
    - `description` = body si description_source='body', sino el prop
    - `notion_page_id` = page.id (upsert key)
    - `notion_database_id`, `notion_workspace_id` metadata
    - `notion_synced_at` = now()
    - `organization_id` = derivado del workspace
  - Upsert en `internal_projects` por `notion_page_id`.
  - Log en `notion_sync_log`.
- [ ] UI de proyectos:
  - Badge "Notion" en la card del proyecto sincronizado.
  - Link al page de Notion desde la card.
  - Warning en el drawer de edit: "Este proyecto se sincroniza desde
    Notion. Los cambios que hagas acá se van a sobreescribir en el
    próximo sync."
- [ ] Botón "Sincronizar Notion" en `/operaciones/proyectos` que corre
  todas las DBs enabled de todos los workspaces enabled.

### 4d — Comentarios read (siguiente chat)

- [ ] Tabla `internal_project_notion_comments` (cache): `id, project_id
  fk, notion_comment_id text unique, notion_user_id, content_plain,
  created_time, updated_time`.
- [ ] Extender `syncNotionDatabase` para traer comentarios por page.
- [ ] UI en la ficha del `internal_project`: sección "Comentarios de
  Notion" con quién comentó (resolviendo notion_user → organization_person
  si está mapeado).

### 4e — Comentarios write + @mentions (siguiente chat)

- [ ] Action `postNotionComment(projectId, contentPlain, mentionedUserIds[])`.
- [ ] Al escribir el comentario en KG:
  - Formar la request Notion con `rich_text` construyendo mentions.
  - Traducir menciones `@[email]` a `notion_user_id`s usando `notion_users`.
- [ ] UI de composer con autocomplete de @mentions filtrado por
  `notion_users` del workspace del proyecto.

### 4f — Cron (siguiente chat)

- [ ] Endpoint `/api/cron/notion-sync` con `CRON_SECRET` guard.
- [ ] Vercel Cron config: cada 15 min corre todos los workspaces enabled.
- [ ] Sync incremental: query con filtro `last_edited_time > last_sync`
  para no traer todo cada vez.

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
