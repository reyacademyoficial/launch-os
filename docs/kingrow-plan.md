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

- **Clients ↔ projects:** confirmado por el usuario. "Cliente" en Kingrow = empresa B2B
  externa que contrata a Kingrow. Se modela como fila en `projects` con
  `organization_id`. **No hay tabla `clients` explícita.** Vale para v1; si más adelante
  crecen los metadatos B2B (contacto, industria, revenue potencial), se sube a tabla
  propia sin drama.
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

Backend: bloque 3 (0080-0084). Cero filas en las 5 tablas.

### 1.1 Sub-gate del bloque

- [ ] Leer las 5 migraciones, listar columnas y RLS explícito (aunque ya se auditó a
      nivel Gate 0, hay que releerlas justo antes de escribir código).
- [ ] Confirmar que `src/lib/clients/{health,ltv,churn,types}.ts` no cambió desde el
      Gate 0.
- [ ] Decidir estructura de rutas: una sola `/clientes` con tabs, o
      `/clientes/[projectId]/{overview,tickets,renewals,upsells,nps}` con sub-rutas.

### 1.2 CRUD (primero — todo en cero)

Cada uno con: form en `Drawer`, server action, validación manual, RLS org-scope.

- [ ] **project_health**: setear health inicial (relationship_status, health_score
      override manual opcional, last_contact_at, notes).
- [ ] **nps_responses**: cargar respuesta (respondent, score 0-10, comment, channel).
- [ ] **tickets**: crear ticket (title, description, priority, category, due_date,
      assignee_person_id opcional).
- [ ] **renewals**: registrar renovación (period_start/end, amount, currency, status).
- [ ] **upsells**: registrar upsell (title, description, amount, currency, status).

Reglas transversales:
- [ ] Sin borrado. Se cambia status a `perdida` o se marca `active=false`.
- [ ] Los enums de status siguen el modelo del backend — no inventar valores.
- [ ] Reusar `Drawer`, `EmptyState`, `StatusPill`, `Delta`, `KgDataTable`, `Paginator`.

### 1.3 Lectura (después del CRUD)

- [ ] Listado de clientes (= projects) con estado, responsable y health score
      calculado.
- [ ] Ficha de cliente con tabs: overview, tickets, renovaciones, upsells, NPS.
- [ ] **LTV por cliente.** Reusar la lógica ya existente en `src/lib/clients/ltv.ts`
      (usa criterio percibido cobrado + liquidaciones retenidas + renewals cobradas +
      upsells cobrados). Es coherente con `finance/revenue.ts`. No escribir una segunda
      definición.
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

- [ ] Cargar al menos 3 clientes reales con datos de negocio de Elbio (o reyacademy).
- [ ] Los 5 forms devuelven a la ficha del cliente sin recargar completo.
- [ ] Health score = 100 para un cliente feliz reciente, 0 para uno abandonado.
- [ ] LTV coincide con Financiero.

> Notas del bloque Clientes:
> _(completar durante el trabajo)_

---

## 2. Operaciones

Backend: bloque 5 (0090-0096). Cero filas en las 9 tablas.

### 2.1 Sub-gate del bloque

- [ ] Releer 0090-0096 justo antes de escribir código.
- [ ] Confirmar que `src/lib/ops/{types,overdue,carga,throughput}.ts` no cambió.
- [ ] Decidir estructura de rutas: `/operaciones` con sub-rutas
      `{proyectos,tareas,bloqueadores,tiempo,procesos,equipos}` o tabs planos.
- [ ] `tasks.assignee_id → organization_people(id)` — confirmado en Gate 0. El selector
      del picker de asignatario tiene que leer de `organization_people`, no de
      `team_members`.

### 2.2 CRUD (primero — todo en cero)

- [ ] **teams**: crear equipo (name, description, active).
- [ ] **team_membership**: sumar/quitar personas al equipo (unique parcial `(team_id,
      person_id) where active` — permite historial).
- [ ] **internal_projects**: crear proyecto interno (name, description, status,
      priority, owner_id opcional, fechas).
- [ ] **tasks**: crear tarea (title, description, internal_project_id opcional,
      assignee_id opcional, status, priority, due_on).
- [ ] **checklists**: crear checklist con XOR — o pertenece a task o a
      internal_project, nunca ambos.
- [ ] **checklist_items**: agregar item con position, marcar done/undone.
- [ ] **blockers**: abrir bloqueador con XOR (task o project), resolver con
      resolved_by + resolved_at.
- [ ] **time_entries**: cargar horas (person_id, minutos, logged_on, task_id y/o
      internal_project_id).
- [ ] **processes**: crear/versionar SOP (title, slug, content_md, category, version).

### 2.3 Lectura (después del CRUD)

- [ ] Listado de proyectos internos con responsable, estado y avance derivado del %
      de tareas done.
- [ ] Vista de tareas filtrable por proyecto, responsable, estado, vencimiento.
- [ ] Bloqueadores abiertos con severidad implícita en la antigüedad.
- [ ] Registros de tiempo agrupables por persona/proyecto/período.
- [ ] Dashboard: tareas completadas en el período, bloqueadores abiertos, carga por
      persona (usar `sumMinutesByPerson` y `computeLoadByPerson` de `src/lib/ops/`).

### 2.4 Fuera de scope de este bloque

- **Mi Jornada** (panel de tareas del usuario logueado en el sidebar): Anexo A.
- **Dependencias entre tareas**: no están modeladas en backend (`tasks` no tiene
  `depends_on`). No se agregan en este bloque. Si aparece la necesidad, se decide
  aparte.

### 2.5 Verificación al cerrar

- [ ] Cargar 1-2 proyectos internos reales.
- [ ] Cargar 10+ tareas con distintos assignees.
- [ ] Un bloqueador abierto y otro resuelto.
- [ ] Time entries de al menos 2 personas.
- [ ] El dashboard muestra números coherentes.

> Notas del bloque Operaciones:
> _(completar durante el trabajo)_

---

## 3. Academia

Backend: bloque 4 (0070-0078) + guard 0079. Cero filas en las 8 tablas.
**Restringido a empresas propias** (`projects.ownership='propia'`).

### 3.1 Sub-gate del bloque

- [ ] Releer 0070-0079 justo antes de escribir código, especialmente el guard.
- [ ] Confirmar que `src/lib/academia/kpis.ts` no cambió.
- [ ] Confirmar que `products.project_id` y `sales.product_id NOT NULL` siguen
      vigentes (base del puente estudiante-venta).
- [ ] Confirmar que Rey Academy y Growins están con `ownership='propia'` — si no, el
      módulo se ve vacío legítimamente.
- [ ] Decidir estructura de rutas: `/academia/{cohortes,estudiantes,clases,examenes}`
      con o sin scoping por proyecto propio.

### 3.2 Migración 0110 — puente estudiante-venta

Aditiva, sin backfill (todo cero). Se corre **dentro del sub-bloque academia**, no
antes.

- [ ] Agregar `enrollments.sale_id uuid nullable references sales(id) on delete set
      null`.
- [ ] Índice `enrollments_sale_idx on (sale_id) where sale_id is not null`.
- [ ] Trigger de consistencia: si `sale_id is not null`, validar que la venta
      apunta al mismo producto que el `course` de la `cohort` del `enrollment`. Es
      decir: `sales.product_id = courses.product_id where courses.id =
      cohorts.course_id where cohorts.id = enrollments.cohort_id`. Si no, error con
      mensaje claro.
- [ ] Sin cambios en `students` — el atado del alumno al comprador vive en
      `enrollments.sale_id` porque un alumno puede inscribirse a varios cursos vía
      varias ventas.

### 3.3 CRUD (primero — todo en cero)

- [ ] **courses**: crear curso sobre un producto existente (product_id UNIQUE, no
      todos los productos son cursos). Metadatos: duration_hours, modules_count,
      syllabus.
- [ ] **cohorts**: crear cohorte (project_id, course_id opcional, name, fechas,
      status). Unique por (project_id, name).
- [ ] **classes**: crear clase dentro de cohorte (scheduled_at, topic, notes).
- [ ] **students**: crear alumno (project_id, name, email, phone, status). Unique
      parcial por (project_id, phone_normalized) y (project_id, email).
- [ ] **enrollments**: inscribir alumno a cohorte. **Con dropdown "Origen":**
  - _Venta LaunchOS_: picker de `sales` del proyecto filtradas por producto que
    tenga curso asociado. Muestra "cliente / producto / fecha". Auto-completa
    `sale_id` y valida contra el trigger de consistencia. Badge en listado: "Auto".
  - _Carga manual_: sin `sale_id`. Badge en listado: "Manual".
- [ ] **attendance**: marcar asistencia por clase. **Carga masiva:** una clase, N
      alumnos marcados de una — no de a uno. Fila por `(class_id, student_id)`.
- [ ] **exams**: registrar examen (student, cohort, title, score, passed, taken_at).
      `passed` puede quedar null si aún no corregido.
- [ ] **certificates**: emitir certificado (student, course, code, issued_at, url).
      **Manual** — no hay automatismo al aprobar examen (decisión de negocio).

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

## Anexo A — Mi Jornada (postergado)

Panel de tareas del usuario logueado en el sidebar. Postergado explícitamente porque:

1. Requiere un **primitive nuevo** que no existe: resolver `auth.uid() →
   organization_people(id)`. Es un helper de servidor que no está construido.
2. Es una feature de conveniencia, no de correctitud. Operaciones funciona sin ella.

### Diseño cuando se retome

- Helper server-only en `src/lib/ops/mi-jornada.ts` que resuelve el `person_id` del
  usuario logueado a partir de `auth.uid()`.
  - Estrategia: primero buscar en `organization_people` una fila que tenga
    `auth_user_id = auth.uid()` (columna que hoy no existe — habría que agregarla en
    la migración del anexo).
  - Cachear por request para no volver a resolver en cada componente.
- Componente `MiJornadaPanel` en el sidebar con:
  - Tareas asignadas al `person_id` con `status ∈ {todo, doing}`.
  - Ordenadas por `due_on asc nulls last`.
  - Con badge de vencidas (usa `filterOverdueTasks` de `src/lib/ops/overdue.ts`).
  - Click en tarea → drawer con detalle + acciones rápidas (marcar done, cambiar
    status, agregar time_entry rápido).
- Fila en `time_entries` opcional: botón "Trabajé X minutos ahora" que crea entry
  con `logged_on=today, person_id=me, task_id=selected`.

### Migración necesaria (cuando se retome)

- `alter table public.organization_people add column if not exists auth_user_id uuid
  unique references auth.users(id) on delete set null;`
- Backfill manual: matchear por email de organization_people con email de auth.users.

### Decisión abierta

- ¿Cómo se maneja el caso de una persona con dos organizaciones? Hoy
  `organization_people` es org-scope y `auth.users` es global. Si un mismo humano
  tiene fila en dos orgs distintas, `auth_user_id` en `organization_people` puede
  colisionar. Decidir antes de agregar la columna: unique global (una persona = un
  auth_user), o unique por (org, auth_user) que permitiría duplicar.

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
