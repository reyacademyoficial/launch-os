# Kingrow — Plan de módulos restantes (post Gate 0)

> Fuente de verdad viva. Reemplaza cualquier versión previa del plan pasada por chat.
> Claude marca los checkboxes a medida que cierra cada ítem. **No se borran ítems:
> se marcan.** El histórico de lo hecho vale tanto como el pendiente.

---

## Estado al inicio de esta fase

Producción activa. Migraciones hasta `0109`. 550 tests en verde. Módulos ya
construidos: Financiero, Comercial, Organización, motor de liquidaciones, shell KG con
design system carmesí.

**Sin construir:** Clientes, Operaciones, Academia, Ejecutivo. Marketing y "Mi Jornada"
postergados con memo (Anexos A y B).

---

## Hallazgos del Gate 0

### Row counts confirmados (Studio, 2026-08-04)

Las **22 tablas** de los tres bloques con backend están en **cero filas**. Cada módulo
arranca sin datos.

Bloques:

- **Clientes (bloque 3):** `project_health`, `nps_responses`, `tickets`, `renewals`,
  `upsells` — 5 tablas, todas vacías.
- **Academia (bloque 4):** `students`, `courses`, `cohorts`, `classes`, `enrollments`,
  `attendance`, `exams`, `certificates` — 8 tablas, todas vacías.
- **Operaciones (bloque 5):** `internal_projects`, `teams`, `team_membership`, `tasks`,
  `checklists`, `checklist_items`, `processes`, `blockers`, `time_entries` — 9 tablas,
  todas vacías.

### Consecuencia sobre la regla "lectura antes que escritura"

**No aplica.** No tiene sentido construir dashboards sobre cero. Cada módulo invierte el
orden: **CRUD primero (alta mínima de todas las tablas), listados y dashboard después.**

Los dashboards siguen siendo primera clase — no es que "escritura primero" gane para
siempre. Cuando las tablas se llenen, la regla original vuelve. Es una decisión
específica de esta fase inicial.

### Preguntas del Gate 0 resueltas

- **Clients ↔ projects:** "Cliente" en Kingrow = empresa B2B externa que contrata a
  Kingrow. **Refactor 2026-08-04 (migración 0110):** se creó tabla `clients` explícita
  + `projects.client_id nullable → clients(id)`. Las 5 tablas del bloque 3 pivotearon
  de `project_id` a `client_id` (destructivo seguro, tablas estaban en cero). Ahora un
  cliente da de alta N projects, no al revés — matchea el flujo natural. Tickets es la
  excepción: `client_id NOT NULL + project_id NULLABLE` (permite ticket cross-project o
  específico de un launch, con trigger que valida coherencia).
- **Guard Academia:** el trigger de `0079_projects_ownership_guard.sql` bloquea downgrade
  de `ownership='propia'` cuando hay students/courses/cohorts colgados. Cada tabla del
  bloque 4 tiene además su `guard_propia_project()` per-row. Rey Academy y Growins
  entrán (ambos con `ownership='propia'` desde 0050).
- **Puente estudiante-venta:** cadena existente en LaunchOS es
  `sales.product_id NOT NULL → products` y `courses.product_id UNIQUE → products`. Falta
  agregar `enrollments.sale_id nullable → sales(id)`. Se hace **dentro del bloque
  Academia** en migración `0110`. Aditiva, sin backfill (todo en cero).
- **Backend Marketing:** no existe bloque backend propio. Datos disponibles vía LaunchOS
  (`launch_daily_ads`, `launch_community_metrics`). Marketing va a la nevera con Anexo
  B.
- **Solapamiento con LaunchOS:** **cero** en los cinco módulos. Kingrow es org-level,
  LaunchOS es project-level. La única coordenada compartida (Meta Ads) se muestra en dos
  vistas distintas (táctica por launch en LaunchOS, estratégica por org en Marketing
  cuando se haga) — sin conflicto.
- **Componentes reutilizables:** 34 en `src/components/kg/` cubriendo Data, KPI,
  Color/Estado, Visualización, Escritura, Filtros, Layout, Navegación. Kit completo — no
  crear duplicados.

---

## Reglas heredadas (siguen aplicando)

Salieron de lo que funcionó en los bloques 0-2. No son sugerencias.

- **Gate de auditoría antes de escribir código** para cada módulo. Sub-gate específico,
  no reemplaza el Gate 0 global.
- **No inventes lo que el backend no modeló.** Si una pantalla necesita un campo que no
  existe, reportalo y proponé la migración — no la escribas ni improvises un
  equivalente.
- **Sin CRUD genérico ni registros declarativos.** Tabla compartida para presentación
  (`KgDataTable`), páginas explícitas para datos.
- **Server components para leer, server actions para escribir.** Cliente SSR con RLS,
  nunca service role.
- **Filtros y paginación por `searchParams`**, sin estado de cliente.
- **Sin `zod`.** Validación manual, patrón del repo.
- **Sin borrado duro.** Desactivar o anular.
- **Dos escrituras que deben ser atómicas van por RPC** (`security invoker`,
  `search_path` fijo). Precedentes: `rotate_settlement_rule`, `close_launch_settlement`,
  `transfer_to_client`.
- **Migraciones aditivas.** Si hace falta una destructiva, se reporta y se decide.
- **FKs resueltas a nombres legibles.** Un uuid en pantalla no le sirve a nadie.
- **Estados vacíos que enseñan:** qué alimenta esa tabla y qué queda en cero sin ella.
  En esta fase con todo cero, los estados vacíos son la pantalla principal — que sean
  útiles.
- **El número nunca se pinta.** El color vive en `StateDot`, `StatusPill` y `Delta`.
- **Acceso por defecto:** `superadmin` y `dev` como lista blanca, igual que Financiero y
  Comercial, salvo que un bloque justifique otra cosa.

---

## Orden

```
GATE 0 (auditoría global) ✓ CERRADO
   └─→ 1. Clientes
       2. Operaciones     (paralelos entre sí, mismo orden razonable)
       3. Academia
                └─→ 4. Ejecutivo

   [Postergados con memo: Anexo A "Mi Jornada", Anexo B "Marketing"]
```

Clientes primero por dos razones: cruza más con lo ya construido (LTV depende de
liquidaciones y facturas) y alimenta la mitad de lo que Ejecutivo va a mostrar.

Ejecutivo va último sin excepción — construirlo antes de que existan los módulos que
resume significa reescribirlo después.

---

## 1. Clientes

Backend: bloque 3 (0080-0084) + **refactor 0110 a modelo cliente-céntrico**. Cero filas
en las 5 tablas del bloque 3 al momento del refactor.

### 1.0 Refactor 0110 (2026-08-04) — pivot a cliente-céntrico

Antes: `project → cliente implícito (business_name texto libre)`. Ahora: `client →
tiene N projects`. Migración destructiva segura porque las 5 tablas estaban vacías.

- [x] Nueva tabla `clients` (org-scope, unique por lower(name) mientras esté active).
- [x] `projects.client_id nullable → clients(id) on delete set null` (project sin
      cliente asignado es válido — proyecto interno o heredado de LaunchOS).
- [x] Pivot de `project_id → client_id NOT NULL` en `project_health`, `nps_responses`,
      `renewals`, `upsells`.
- [x] `tickets`: híbrido — `client_id NOT NULL + project_id NULLABLE`, con trigger
      que valida coherencia (si project_id está seteado, el project pertenece al
      mismo cliente).
- [x] Adaptación `src/lib/clients/{types,churn}.ts` + tests (project_id→client_id en
      shapes, `projectId→clientId` en `ChurnCohortEntry`, `totalProjects→totalClients`
      en `ChurnRateBreakdown`).
- [x] Andamio pivoteado: `[projectId]` → `[clientId]`, fetch de `clients`.

### 1.1 Sub-gate del bloque

- [x] Leer las 5 migraciones + revisar RLS org-scope + triggers de consistencia.
- [x] Adaptar `src/lib/clients/*.ts` al modelo post-0110.
- [x] Estructura de rutas: `/clientes` (dashboard con listado de clientes) +
      `/clientes/{tickets,renovaciones,upsells,nps}` (tablas globales) +
      `/clientes/[clientId]` (ficha del cliente con sub-tabs internos + projects
      atados).

### 1.2 CRUD (primero — todo en cero)

Cada uno con: form en `Drawer`, server action, validación manual, RLS org-scope.

- [ ] **clients** (nuevo — bloque 3.5): crear/editar cliente (name, business_name,
      industry, notes, active). **Primero del módulo** — sin al menos un cliente no
      hay dónde colgar el resto.
- [ ] **project_health**: setear health inicial del cliente (relationship_status,
      health_score override manual opcional, last_contact_at, notes). 1 fila por
      cliente (unique client_id).
- [ ] **projects.client_id (edición)**: desde la ficha del cliente, atar/desatar
      projects existentes. Es un update de projects, no un CRUD de projects.
- [ ] **nps_responses**: cargar respuesta del cliente (respondent, score 0-10,
      comment, channel).
- [ ] **tickets**: crear ticket del cliente (title, description, priority, category,
      due_date, assignee_person_id opcional, project_id OPCIONAL — solo si el
      ticket es específico de un launch del cliente).
- [ ] **renewals**: registrar renovación del contrato de gestión (period_start/end,
      amount, currency, status).
- [ ] **upsells**: registrar upsell al cliente (title, description, amount,
      currency, status).

Reglas transversales:
- [ ] Sin borrado. Se cambia status a `perdida` o se marca `active=false`.
- [ ] Los enums de status siguen el modelo del backend — no inventar valores.
- [ ] Reusar `Drawer`, `EmptyState`, `StatusPill`, `Delta`, `KgDataTable`, `Paginator`.

### 1.3 Lectura (después del CRUD)

- [ ] Listado de clientes en `/clientes` con estado, responsable y health score
      calculado. `active=false` van al final o se ocultan por filtro.
- [ ] Ficha `/clientes/[clientId]` con sub-tabs internos: overview, tickets,
      renovaciones, upsells, NPS, projects atados.
- [ ] **LTV por cliente.** Sumar `launch_settlements.kingrow_retained` de los projects
      atados al cliente + invoices cobradas de esos projects + renewals cobradas del
      cliente + upsells cobrados del cliente. Reusar `src/lib/clients/ltv.ts` (el
      selector no cambia; el caller filtra por client_id vía projects).
- [ ] Dashboard del módulo: clientes activos, en riesgo, NPS promedio, LTV promedio.

### 1.4 Fórmula de health_score (decisión cerrada, opción A)

`health_score` se calcula on-the-fly por selector. La columna
`project_health.health_score` sirve como **override manual**: si no es null, gana; si es
null, el selector devuelve el score computado.

**Ingredientes:**

- `nps_recent` = último `nps_responses.score` (0–10) del cliente en los últimos 90 días.
  Null si no hay respuesta reciente.
- `days_since_contact` = días desde `project_health.last_contact_at`. Null si nunca.
- `urgent_open` = cantidad de `tickets` con `priority='urgente'` y `status not in
  ('resuelto','cerrado')`.

**Sub-scores (0–100 cada uno):**

- `nps_component` = `nps_recent * 10`. Null si no hay NPS reciente.
- `contact_component`:
  - `days = 0` → 100
  - `days = 30` → 67
  - `days = 60` → 33
  - `days = 90` → 0
  - Fórmula: `max(0, 100 - days * 100 / 90)`. Null si nunca.
- `tickets_component`:
  - 0 urgentes → 100
  - 1 urgente → 75
  - 2 urgentes → 50
  - 3 urgentes → 25
  - 4+ urgentes → 0
  - Fórmula: `max(0, 100 - urgent_open * 25)`. Nunca null (0 urgentes = 100).

**Pesos (si los tres ingredientes existen):**

- NPS 40%, contact 30%, tickets 30%.

**Redistribución cuando falta un ingrediente:**

- Sin `nps_component`: contact 50%, tickets 50%.
- Sin `contact_component`: NPS 60%, tickets 40%.
- Sin ambos: tickets 100%.

Cuando faltan datos, la ficha del cliente muestra badge `"Datos limitados"` para no
confundir.

**Override manual:** setear `project_health.health_score` a valor concreto → selector
devuelve ese valor y pinta badge `"Manual"`. Volver a null → automático.

### 1.5 Verificación al cerrar

- [ ] Cargar al menos 3 clientes reales, atar 1-2 projects existentes a cada uno.
- [ ] Los 6 forms (clients, health, nps, tickets, renewals, upsells) devuelven a la
      ficha del cliente sin recargar completo.
- [ ] Health score = 100 para un cliente feliz reciente, 0 para uno abandonado.
- [ ] LTV coincide con Financiero (sumado sobre los projects atados al cliente).
- [ ] Un ticket con `project_id` seteado a un project de otro cliente rebota con el
      mensaje del trigger (verifica el guard de coherencia de 0110).

> Notas del bloque Clientes:
> _(completar durante el trabajo)_

---

## 2. Operaciones

Backend: bloque 5 (0090-0096). Cero filas en las 9 tablas.

### 2.0 Refactor de alcance (2026-08-06)

Ajustes acordados antes de arrancar el CRUD:

- **Teams se muda a `/organizacion/equipos`.** Son config org-level (paralelos a
  `/organizacion/personas`), no operación día-a-día. Se usan desde Operaciones pero
  se administran en Organización. El módulo Operaciones queda con 6 tabs (Dashboard,
  Proyectos, Tareas, Bloqueadores, Tiempo, Procesos).
- **Vinculación `auth_user_id` en `organization_people`.** Migración nueva
  `alter table organization_people add column auth_user_id uuid unique references
  auth.users(id) on delete set null`. **Unique global** (una persona = un
  auth_user; multi-org es lejano). Backfill por email match + UI en Personas para
  asignar/desasignar manualmente. Cierra la decisión abierta del Anexo A.
- **Filtro "mis tareas" por default para operador/analista/etc.** El path natural
  es "entro y veo lo mío". Superadmin/dev arrancan viendo TODAS y pueden togglear
  a "mis tareas". La lista queda scoped server-side por `assignee_id` derivado de
  `auth.uid() → organization_people.id`. Un operador que fuerce `?scope=all` por URL
  rebota.
- **Vencidas visualmente marcadas como urgentes en la UI — SIN mutar `priority` en
  DB.** Mutar priority silenciosamente rompería el historial (no se distingue "el
  operador la marcó urgente" de "venció y el sistema la marcó"). La regla vive en la
  presentación (dot rojo + badge "Vencida" si `due_on < today`).
- **Notion sync postergado — Anexo C.** Es un proyecto aparte (OAuth, sync
  periódico, dedup, mapping) que se traga el bloque si se mete acá.

### 2.1 Sub-gate del bloque

- [x] Releer 0090-0096 justo antes de escribir código.
- [x] Confirmar que `src/lib/ops/{types,overdue,carga,throughput}.ts` no cambió.
- [x] Estructura de rutas decidida: 6 tabs planos en `/operaciones` (Dashboard,
      Proyectos, Tareas, Bloqueadores, Tiempo, Procesos) + `/operaciones/proyectos/
      [projectId]` para la ficha del proyecto interno. Equipos vive en Organización.
- [x] `tasks.assignee_id → organization_people(id)` — confirmado. El picker lee de
      `organization_people`, no de `team_members` (proyecto-scope de LaunchOS).

### 2.2 CRUD y sub-piezas (orden de commits)

Con las decisiones de §2.0. Los ítems marcan commits atómicos, no filas de tabla.

- [ ] **Andamio + plan MD update** (este commit).
- [ ] **Migración `organization_people.auth_user_id`** + backfill por email + UI en
      `/organizacion/personas` para asignar/desasignar usuario. Helper server-only
      `resolveCurrentPersonId(): Promise<string | null>` en `src/lib/ops/`.
- [ ] **CRUD `internal_projects`** + ficha `/operaciones/proyectos/[id]` con
      placeholders para sub-secciones (tasks/blockers/checklists/time del proyecto).
- [ ] **CRUD `tasks`** con:
  - Vista global `/operaciones/tareas`.
  - Filtro "mis tareas" default (server-scoped por auth_user_id → person_id).
  - Toggle "Todas" — para operador/analista el toggle NO aparece; para superadmin/
    dev es visible y default a "Todas".
  - Marcado visual de vencidas (dot rojo + badge "Vencida").
  - Integración inline en ficha de proyecto.
- [ ] **CRUD `blockers`** + integración inline en tasks/projects. XOR duro.
- [ ] **CRUD `checklists + checklist_items`** inline en tasks/projects (sin vista
      global — un checklist suelto no aporta). XOR duro.
- [ ] **CRUD `time_entries`** vista global filtrable por persona/proyecto/tarea/
      período. Blocked delete on person con historial (already RESTRICT en DB).
- [ ] **CRUD `teams + team_membership`** en `/organizacion/equipos` (fuera del
      layout de Operaciones — nueva entrada en `ORGANIZATION_MODULES`).
- [ ] **CRUD `processes`** — SOPs Markdown. Vista global + ficha con content_md.
- [ ] **Dashboard `/operaciones`** consumiendo `computeLoadByPerson`,
      `computeThroughput`, `sumMinutesByPerson`, `filterOverdueTasks`. Ranking de
      productividad por persona con período configurable.

### 2.3 Reglas transversales

- Todos los CRUD siguen el patrón de Clientes: `Drawer` + `useActionState` + server
  action con discriminated union `{ok, id} | {error}` + `revalidatePath`.
- **NO sync automático** entre `tasks.status='blocked'` ↔ `blockers`. La UI puede
  sugerir "cambiar status a blocked cuando creás un bloqueador", pero no forzar.
- **NO sync automático** entre `tasks.status='done'` ↔ `completed_at`. La action
  setea/limpia según transiciones (mismo patrón de tickets con `resolved_at`).
- Reusar `Drawer`, `EmptyState`, `StatusPill`, `KgDataTable`, `KgParamPills`.
- Sin borrado duro cuando hay historial contable (time_entries ya lo bloquea a
  nivel DB con on delete RESTRICT en person_id).

### 2.4 Fuera de scope de este bloque

- **Componente "Mi Jornada" en el sidebar** (Anexo A). La migración de
  `auth_user_id` sí se hace acá (habilita "mis tareas" en `/operaciones/tareas`);
  lo que queda en el Anexo A es solo el widget de sidebar.
- **Dependencias entre tareas** (`depends_on`): no están modeladas en el schema.
  Fuera de scope.
- **Sync con Notion**: Anexo C.

### 2.5 Verificación al cerrar

- [ ] Cargar 1-2 proyectos internos reales.
- [ ] Cargar 10+ tareas con distintos assignees, algunas con `due_on` en el pasado
      para verificar el marcado visual de "Vencida".
- [ ] Vincular al menos 2 personas a usuarios distintos (self + otra); entrar como
      operador y verificar que solo se ven las propias; entrar como superadmin y
      verificar que se ven todas + toggle "Mis tareas" funciona.
- [ ] Un bloqueador abierto y otro resuelto.
- [ ] Time entries de al menos 2 personas en la misma ventana.
- [ ] El dashboard muestra números coherentes con las tablas.

> Notas del bloque Operaciones:
> _(completar durante el trabajo)_

---

## 3. Academia

Backend: bloque 4 (0070-0078) + guard 0079. Cero filas en las 8 tablas.
**Restringido a empresas propias** (`projects.ownership='propia'`).

### 3.0 Refactor de alcance (2026-08-06)

- **Estructura de rutas** decidida: 5 tabs planos en `/academia` (Dashboard,
  Cohortes, Estudiantes, Cursos, Certificados) + fichas
  `/academia/cohortes/[id]` y `/academia/estudiantes/[id]`. Ver §3.1.
- **"Sin empresas propias"** (§3.5): banner amarillo en el layout si no hay
  ningún project con `ownership='propia'`. No bloquea navegación; explica por
  qué las tablas van a rechazar cualquier insert (`guard_propia_project`
  rebota con `23514`) y muestra el SQL para setear una empresa como propia
  desde Studio.
- **Migración renumerada:** el puente estudiante-venta es **0112** (no 0110
  como decía la primera versión del plan — 0110 ya fue usada para el pivot
  de Clientes). Ver §3.2.

### 3.1 Sub-gate del bloque

- [x] Releer 0070-0079 justo antes de escribir código, especialmente el guard.
- [x] `src/lib/academia/kpis.ts` intacto. 5 KPIs (activeStudents,
      completionRate, averageAttendance, examPassRate, certificationRate).
- [x] `products.project_id` y `sales.product_id NOT NULL` siguen vigentes.
- [x] Rey Academy y Growins como propia: **acción manual del operador** en
      Studio si aún no está seteado (`update projects set ownership='propia'
      where name in ('Rey Academy', 'Growins');`). Con `ownership='externa'`,
      el guard rebota cualquier insert. El banner del layout lo aclara.
- [x] Estructura de rutas: 5 tabs planos + fichas de cohorte y estudiante.

### 3.2 Migración 0112 — puente estudiante-venta

Aditiva, sin backfill (todo cero). Se corre **dentro del sub-bloque academia**, no
antes.

- [ ] Agregar `enrollments.sale_id uuid nullable references sales(id) on delete set
      null`.
- [ ] Índice `enrollments_sale_idx on (sale_id) where sale_id is not null`.
- [ ] Trigger de consistencia: si `sale_id is not null`, validar que la venta
      apunta al mismo producto que el `course` de la `cohort` del `enrollment`. Es
      decir: `sales.product_id = courses.product_id where courses.id =
      cohorts.course_id where cohorts.id = enrollments.cohort_id`. Si la cohort
      no tiene `course_id`, rebota — no se puede validar coherencia.
- [ ] Sin cambios en `students` — el atado del alumno al comprador vive en
      `enrollments.sale_id` porque un alumno puede inscribirse a varios cursos vía
      varias ventas.

### 3.3 CRUD (primero — todo en cero)

- [ ] **courses**: crear curso sobre un producto existente (product_id UNIQUE, no
      todos los productos son cursos). Metadatos: duration_hours, modules_count,
      syllabus.
- [ ] **cohorts**: crear cohorte (project_id, course_id opcional, name, fechas,
      status). Unique por (project_id, name).
- [x] **classes**: crear clase dentro de cohorte (scheduled_at, topic, notes).
      Inline en la ficha de la generación con Drawer create/edit + delete rojo.
- [ ] **students**: crear alumno (project_id, name, email, phone, status). Unique
      parcial por (project_id, phone_normalized) y (project_id, email).
- [ ] **enrollments**: inscribir alumno a cohorte. **Con dropdown "Origen":**
  - _Venta LaunchOS_: picker de `sales` del proyecto filtradas por producto que
    tenga curso asociado. Muestra "cliente / producto / fecha". Auto-completa
    `sale_id` y valida contra el trigger de consistencia. Badge en listado: "Auto".
  - _Carga manual_: sin `sale_id`. Badge en listado: "Manual".
- [x] **attendance**: matriz masiva por clase (Drawer con checkboxes + Marcar
      todos/Limpiar + upsert `on_conflict=class_id,student_id`). Solo inscriptos
      con status active/completed entran a la matriz.
- [x] **exams**: registrar examen (student, cohort, title, score, passed, taken_at).
      Inline en la ficha de la generación con Drawer create/edit + delete rojo.
      Radio Pendiente/Aprobado/Reprobado (passed null/true/false) independiente
      del score (nullable si aún no se corrigió).
- [x] **certificates**: emitir certificado (student, course, code, issued_at, url).
      **Manual** — no hay automatismo al aprobar examen (decisión de negocio).
      Vista global `/academia/certificados` con tabla + drawer, y panel inline
      en la ficha del estudiante que reusa el mismo drawer con student presetado.

### 3.4 Lectura (después del CRUD)

- [ ] Listado de cohortes con producto asociado, instructor, fechas, ocupación.
- [ ] Listado de estudiantes con badges Auto/Manual, cohorte activa, progreso,
      status.
- [ ] Vista de clase con asistencia inline editable.
- [ ] Vista de exámenes por cohorte.
- [ ] Vista de certificados emitidos.
- [ ] Dashboard: estudiantes activos, tasa de completion (`completionRate`),
      asistencia promedio (`averageAttendance`), tasa de aprobación
      (`examPassRate`), tasa de certificación (`certificationRate`).

### 3.5 Riesgo específico

- [ ] Si no hay empresas propias en la org, la pantalla tiene que **decirlo
      explícitamente** — "Academia se activa cuando la organización opera al menos un
      proyecto propio" — no mostrar cero cohortes como si no hubiera datos.

### 3.6 Verificación al cerrar

- [ ] Crear 1 producto en Rey Academy + curso + cohorte + 5 alumnos.
- [ ] 3 alumnos vía "Venta LaunchOS" con sale asociada, 2 vía "Manual".
- [ ] Marcar asistencia masiva en 1 clase.
- [ ] Emitir 2 certificados manualmente.
- [ ] KPIs coherentes.

> Notas del bloque Academia:
> _(completar durante el trabajo)_

---

## 4. Ejecutivo

**Último. Bloqueado por Clientes + Operaciones + Academia.**

Vista transversal del negocio: la pantalla que mira el dueño cuando quiere saber cómo va
todo sin entrar a ningún módulo.

### 4.1 Regla que gobierna el bloque

- [ ] **Ejecutivo no calcula nada propio.** Consume los selectores que ya existen en
      cada módulo (`src/lib/finance/*`, `src/lib/clients/*`, `src/lib/academia/*`,
      `src/lib/ops/*`). Si un número que hace falta no está calculado en ningún lado, se
      agrega al selector del módulo que le corresponde, nunca acá.

      Motivo concreto: si Ejecutivo recalcula el ingreso por su cuenta, en algún momento
      va a mostrar un número distinto al de Financiero y nadie va a saber cuál creer. Ya
      evitamos ese problema tres veces (agregación duplicada del simulador,
      clasificación de facturas, ingreso versus facturación del grupo).

### 4.2 Contenido

- [ ] KPIs de cabecera: ingreso Kingrow, utilidad neta, caja, runway (todos vía
      selectores existentes).
- [ ] Tendencia de ingreso (últimos N meses).
- [ ] Estado de los proyectos: activos, liquidados, en riesgo.
- [ ] Salud de clientes: cantidad en cada relationship_status, score promedio,
      alertas por proyectos rojos.
- [ ] Resumen de operaciones: bloqueadores abiertos, tareas críticas atrasadas.
- [ ] Academia si hay empresas propias con cohortes activas.
- [ ] Marketing NO aparece hasta que se construya el módulo (ver Anexo B).

### 4.3 Motor de alertas (decisión pendiente en este bloque)

- [ ] Decidir si entra en este bloque o se posterga.

      Es lo que hace que el tablero sirva de verdad, pero también es donde más fácil se
      construye algo que grita todo el tiempo y termina ignorado. Si entra, que sea con
      pocas reglas y umbrales explícitos, no con una lista larga de condiciones.

- [ ] Si entra: umbrales configurables o al menos centralizados en un solo archivo, no
      repartidos por la vista.

### 4.4 Verificación al cerrar

- [ ] Los números coinciden con los módulos originales (spot check en 5 KPIs).
- [ ] Roles no-superadmin/dev no llegan por URL.
- [ ] Estados vacíos correctos si algún módulo aún no tiene datos.

> Notas del bloque Ejecutivo:
> _(completar durante el trabajo)_

---

## Verificación transversal (cada bloque antes de cerrar)

- [ ] `tsc --noEmit` en 0.
- [ ] Suite completa sin regresiones.
- [ ] Tests de la lógica nueva que no sea presentación.
- [ ] Prueba de rol: los roles fuera de la lista blanca no llegan por URL.
- [ ] Estados vacíos correctos incluso con datos reales cargados.
- [ ] Ninguna escritura fuera de las server actions declaradas.
- [ ] Ningún cálculo duplicado de algo que ya existe en otro selector.

---

## Anexo A — Mi Jornada (postergado, parcialmente absorbido en §2)

Panel de tareas del usuario logueado **en el sidebar**. Postergado explícitamente
porque:

1. Es una feature de conveniencia UX, no de correctitud. Operaciones funciona sin
   ella — `/operaciones/tareas` con filtro "mis tareas" default (§2.2) cubre el 90%
   del uso.
2. Requiere componente en el shell/sidebar que hoy no está pensado para widgets
   dinámicos.

### Absorbido en §2 (ya no es puramente Anexo)

- **Migración `auth_user_id`** se hace dentro del bloque Operaciones (§2.2).
  Decisión cerrada: **unique global**. Una persona = un auth_user; multi-org se
  refactoriza si aparece.
- **Helper `resolveCurrentPersonId()`** también nace en §2.2 (se necesita para el
  filtro "mis tareas" del `/operaciones/tareas`).
- **UI para vincular usuario a persona** en `/organizacion/personas` — también §2.2.

### Lo que queda para el Anexo cuando se retome

- **Componente `MiJornadaPanel`** en el sidebar (KingrowShell) con:
  - Tareas asignadas al `person_id` con `status ∈ {todo, doing}`.
  - Ordenadas por `due_on asc nulls last`.
  - Badge de vencidas (usa `filterOverdueTasks` de `src/lib/ops/overdue.ts`).
  - Click en tarea → drawer con detalle + acciones rápidas (marcar done, cambiar
    status, agregar time_entry rápido).
- **Botón "Trabajé X minutos ahora"** opcional que crea un `time_entries` con
  `logged_on=today, person_id=me, task_id=selected`.

### Backfill de `auth_user_id`

Cuando se corra la migración del §2.2:

- Match automático por email en un script one-shot (organization_people.email ↔
  auth.users.email, ambos lowercased).
- Resto asignado manualmente en `/organizacion/personas` con un dropdown "Usuario
  Kingrow" (personas sin match aparecen con badge "sin usuario").

---

## Anexo B — Marketing (postergado)

Módulo Marketing sacado del alcance inicial. Cuando se retome, la opción confirmada por
el Gate 0 es la **Opción A: vista agregada de datos LaunchOS a nivel organización**.

### Motivación de la postergación

- No hay backend propio de marketing. Todo lo que existe vive en tablas de LaunchOS
  (`launch_daily_ads`, `launch_community_metrics`) por launch.
- Las prioridades reales (clientes, operaciones, academia, ejecutivo) tienen mayor
  impacto operativo.
- Meterlo en la primera pasada agrega superficie sin resolver una necesidad urgente.

### Diseño cuando se retome (Opción A)

Sin migraciones. Solo selectores nuevos y UI.

- **Selector nuevo** en `src/lib/marketing/aggregate.ts`:
  ```
  aggregateOrgAds(orgId, since, until) → {
    total_spend, total_leads, cpl,
    by_channel: { meta: {...}, google: {...}, tiktok: {...} },
    by_launch: [{launch_id, launch_name, spend, leads, cpl}],
    trend: [{date, spend, leads}]
  }
  ```
  Lee `launch_daily_ads` filtrado por launches de proyectos de la org.

- **Selector para SendFlow** en `src/lib/marketing/community.ts`:
  ```
  aggregateOrgCommunity(orgId, since, until) → {
    total_entered, total_removed, total_clicks,
    by_launch: [...]
  }
  ```
  Lee `launch_community_metrics` filtrado por launches de la org.

- **UI** en `/marketing`:
  - KPIs de cabecera: inversión total, leads totales, CPL agregado, ROI si hay ventas
    atribuibles.
  - Comparativa entre lanzamientos.
  - Comparativa entre canales (meta / google / tiktok).
  - Evolución temporal (spark de últimos 30 días).
  - **Cero escrituras.** Los datos entran por el sync de LaunchOS.

- **Cuidado importante:** los ads publicitarios ya se cargan como gasto en `expenses`
  (decisión de Financiero). Esta pantalla los muestra como **métrica de marketing**,
  **no** los suma a ningún total financiero. Si se hiciera, se doblaría el gasto.

### Estimación

4–6 horas de trabajo (selectores + UI + tests). Trivial una vez que hay tiempo para
construirlo.

### Fuera de alcance incluso al retomarlo

- Contenido orgánico (posts, cuentas sociales, engagement). Requiere backend nuevo,
  integración Meta Feed API, esquema de atribución. **Es un proyecto, no un módulo.**
  Si aparece la necesidad, se decide como bloque backend aparte.
- Analíticas granulares (creativos, audiencias, keywords). Fuera de v1 explícitamente.

---

## Anexo C — Sync con Notion (postergado)

Integración con el board de Notion del equipo para materializar las tareas en KG y
poder correr los análisis de productividad sobre esa data. Postergado porque es un
proyecto aparte (20-40 horas estimadas) que se traga el bloque Operaciones si se
mete adentro.

### Motivación

- El equipo ya vive en Notion. Duplicar carga en dos lados es fricción y desalinea.
- El módulo Operaciones nace útil sin Notion (carga manual funciona) — traer Notion
  es una capa de conveniencia que se justifica cuando ya haya adopción del CRUD
  nativo.

### Diseño cuando se retome (esbozo)

- **OAuth con Notion**. Token por org (nuevo `organization_integrations`?) o
  global. Decidir según scope multi-org.
- **Mapping de propiedades**: Notion `Assignee` (persona Notion) → KG
  `organization_people` por email/nombre. `Status` → `tasks.status` (mapa
  configurable — Notion suele tener enums distintos: "Not started", "In progress",
  "Done"). `Due date` → `tasks.due_on`. `Priority` → `tasks.priority`. Título +
  descripción directo.
- **Dedup**: agregar `tasks.notion_page_id text unique` para linkear 1:1. Un update
  en Notion trae la fila y hace UPDATE, no INSERT.
- **Estrategia de source of truth**: mejor "Notion manda, KG es sombra" que
  bidireccional. Bidireccional abre conflictos, versionado y explota complejidad.
- **Sync**: webhook de Notion (si soporta el nivel de free/pro del equipo) o cron
  cada 5-15 min. Para arrancar, cron simple + botón "Sincronizar ahora" manual.
- **UI**: badge "Fuente: Notion" en las tareas sincronizadas + link al page. El
  operador NO edita esas desde KG (bloquear en el drawer o permitir con warning).

### Migración necesaria (cuando se retome)

- `alter table tasks add column notion_page_id text unique;` (nullable — las nativas
  KG no la tienen).
- Nueva tabla `notion_sync_log` con timestamps + status + errores por corrida.
- Config en `organization_integrations` con el token OAuth.

### Estimación

Con OAuth + mapping + dedup + cron + botón manual + UI de conflictos + tests
razonables: **20-40h**. Sin producir data nueva; solo importar. Bien puede ser un
bloque propio (Bloque 6 · Integraciones externas).

### Fuera de alcance incluso al retomarlo

- Escritura KG → Notion. Bidireccional es un multiplicador de complejidad — la
  primera versión solo lee.
- Sub-tareas de Notion (nested pages). Se traen como flat; el operador reorganiza
  si aplica.

---

## Deuda y decisiones abiertas del proyecto

No pertenecen a estos módulos pero conviene no perderlas de vista:

- [ ] Porcentajes de split de Maestro Charcutero y Super Instructor Marcos.
- [ ] Liquidación complementaria: los ~$40M pendientes de Maratón G7 van a rebotar con
      `already-settled` cuando entren.
- [ ] Reapertura de liquidaciones: sin definir.
- [ ] `created_by` en `settlement_rules`.
- [ ] `expenses` es org-scope: hoy no se puede saber cuánto cuesta operar cada proyecto.
- [ ] Fórmulas marcadas `// REVISAR CON CONTADOR`.
- [ ] Gating de sidebar por rol para `/financiero`, `/organizacion` y `/comercial`.
- [ ] Segunda cuenta superadmin como respaldo.
