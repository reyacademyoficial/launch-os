# Auditoría — Launch OS

> Estado de la plataforma a 2026-06-06.
> Stack productivo, sin features fantasma, sin promesas a futuro mezcladas con lo entregado.

---

## 1. Qué es Launch OS

Centro de operaciones para lanzamientos de marketing digital. Multi-tenant
(cada cliente = un **proyecto**), con tres roles, control granular de acceso,
métricas planas y derivadas, simulador de escenarios y resúmenes ejecutivos
generados con IA.

Lo usan tres tipos de usuarios al mismo tiempo:
- **Superadmin** (Growins/equipo interno) — administra todo: crea proyectos,
  invita usuarios, ve cualquier proyecto, edita y borra.
- **Admin** (el dueño del proyecto cliente) — administra los datos de su(s)
  proyecto(s): crea/edita/borra lanzamientos, carga datos diarios, conecta
  integraciones, ve y dispara resúmenes IA.
- **Cliente** (rol de solo lectura dentro de un proyecto) — ve métricas,
  detalle de lanzamientos, calculadora y resúmenes IA. No puede editar nada.

---

## 2. Stack tecnológico

| Capa | Tecnología | Notas |
| --- | --- | --- |
| Frontend / SSR | Next.js 16 (App Router) | React 19.2, Turbopack, TypeScript estricto |
| Estilos | Tailwind CSS v4 | Configuración CSS-first (`@theme` en `globals.css`) |
| Backend / DB | Supabase (Postgres + Auth + RLS) | Conectado vía `@supabase/ssr` (server) y `@supabase/supabase-js` (browser/admin) |
| IA | OpenAI (`gpt-4o-mini`) | Provider abstracto: cambiar a Anthropic/otro es editar un archivo |
| Gráficos | Recharts | LineChart para series temporales |
| Markdown | `react-markdown` | Para renderizar el resumen ejecutivo IA |
| Auth | Supabase Auth | Email + password, sin signup público (invite-only por superadmin) |
| Lint / Format | ESLint 9 flat config + Prettier | `eslint-config-next` 16 |

**Defensa en profundidad (auth)** — toda ruta protegida pasa por 3 capas:
1. **Proxy** (`src/proxy.ts`, ex-middleware en Next 16): refresh de sesión + redirect coarse.
2. **Layouts server-side** (`requireSessionProfile`, `requireRole`, `requireCanEditProject`): chequeo de rol/permisos en cada ruta protegida.
3. **RLS de Postgres**: políticas atadas a tres helpers SECURITY DEFINER (`is_superadmin`, `has_project_access`, `can_edit_project`). Backstop final.

Ninguna capa sola alcanza. Las tres tienen que romperse para que un cliente vea datos de otro proyecto.

---

## 3. Modelo de datos

Diagrama (relaciones FK con cascada donde corresponde):

```
auth.users ───┬─→ profiles (1:1, soft-delete via deleted_at)
              └─→ project_members ←──→ projects ──┬─→ launches ──→ launch_daily
                                                  ├─→ project_integrations
                                                  ├─→ project_secrets   (BLINDADA)
                                                  └─→ audit_log
```

### 3.1 Tablas

| Tabla | Para qué | Notas de seguridad |
| --- | --- | --- |
| `profiles` | Metadata del usuario (full_name, role global, deleted_at) | RLS: ver/editar lo propio o ser superadmin. Trigger anti auto-escalada de rol. |
| `projects` | Tenant raíz. name + business_name + created_by | RLS: lectura = miembro o superadmin. Insert = superadmin. Edición/Delete = admin del proyecto o superadmin. |
| `project_members` | Membresía rol-por-proyecto | RLS: escritura solo superadmin (por ahora). |
| `launches` | ~22 métricas por lanzamiento | RLS: lectura = miembro; escritura = admin/superadmin. |
| `launch_daily` | 1 fila por launch+fecha, 7 canales | RLS resuelve el proyecto padre via función helper. |
| `project_integrations` | Metadata de conexión por provider | RLS: lectura = miembro; escritura = admin+. |
| `project_secrets` | API keys / tokens | **RLS sin policies**. Solo service-role accede. Cliente o admin que intente `select` directo recibe 0 filas. |
| `audit_log` | Registro inmutable de acciones | RLS: lectura = miembro del proyecto. |

### 3.2 Triggers automáticos

- `handle_new_user` (en `auth.users` INSERT): crea profile con rol leído del metadata de la invitación.
- `guard_profile_role` (en `profiles` UPDATE): impide cambiar `role` salvo superadmin. Anti-escalada de privilegios.
- `set_updated_at`: actualiza la columna `updated_at` automáticamente en todas las tablas que la tienen.

### 3.3 Funciones helper (SECURITY DEFINER)

Las RLS se montan sobre estas para que la lógica viva en un solo lugar:

| Función | Devuelve | Usada por |
| --- | --- | --- |
| `is_superadmin()` | `bool` | Polícy SELECT/INSERT/etc. en todas las tablas |
| `has_project_access(project_id)` | `bool` | Policies SELECT (lectura) |
| `can_edit_project(project_id)` | `bool` | Policies INSERT/UPDATE/DELETE + Server Actions de write |
| `project_of_launch(launch_id)` | `uuid` | Policies de `launch_daily` (resuelve project padre del launch) |

---

## 4. Roles y permisos

| Acción | superadmin | admin | cliente |
| --- | :---: | :---: | :---: |
| Ver proyectos | todos | los asignados | el suyo |
| Crear proyecto | ✅ | ❌ | ❌ |
| Editar / borrar proyecto | ✅ | ✅ (los suyos) | ❌ |
| Crear / editar / borrar lanzamientos | ✅ | ✅ | ❌ |
| Cargar datos diarios | ✅ | ✅ | ❌ |
| Conectar / rotar / desconectar integraciones | ✅ | ✅ | ❌ |
| Ver métricas y gráficos | ✅ | ✅ | ✅ |
| Generar resumen IA | ✅ | ✅ | ✅ |
| Usar calculadora | ✅ | ✅ | ✅ |
| Cambiar su contraseña / nombre | ✅ | ✅ | ✅ |
| Crear / editar / desactivar usuarios | ✅ | ❌ | ❌ |
| Crear / editar / borrar otros proyectos | ✅ | ❌ | ❌ |

> La distinción funcional fina entre superadmin y admin está aislada: la
> lógica de permisos vive en `src/lib/auth/permissions.ts` y en la función
> SQL `can_edit_project`. Cambiarla es tocar dos archivos, no veinte.

---

## 5. Funcionalidades por área

### 5.1 Autenticación (invite-only, sin email)

- Login con email + password.
- **No hay signup público**: los superadmins desactivan esa opción en el dashboard de Supabase.
- Los usuarios se crean directamente desde la UI por un superadmin con email + password definidos en el momento. Las credenciales se comparten por canal externo (chat seguro, password manager). Decisión consciente para evitar dependencia de SMTP y problemas de deliverability.
- Cambio de contraseña propia disponible en `/configuracion` para todos los roles.
- Logout vía menú desplegable de usuario en el header.
- Sesión refresca automáticamente en cada request (proxy `@supabase/ssr`).

Rutas armadas pero hoy out-of-path, listas para futuro password-reset por email:
- `/auth/confirm` (Route Handler que verifica tokens de invitación / recovery vía PKCE u OTP)
- `/set-password` (form para setear contraseña tras el confirm)

### 5.2 Gestión de proyectos — `/admin/proyectos` (solo superadmin)

- Listado tabular: Nombre / Razón social / Fecha de alta.
- Botón **+ Nuevo proyecto** → ruta `/admin/proyectos/new` con form (name obligatorio + business_name opcional).
- Por fila: **Editar** (`/admin/proyectos/[id]/edit`) y **Borrar**.
- Borrar usa modal con type-`DELETE` (alto riesgo: cascadea launches, daily, integrations, secrets, members, audit log; no se puede deshacer).

### 5.3 Gestión de usuarios — `/admin/usuarios` (solo superadmin)

- Listado tabular con: Email / Nombre / Rol (badge coloreado por rol) / Proyectos asignados (chips) / Fecha de alta / Acciones.
- En la fila del propio superadmin se reemplazan las acciones por "vos" para evitar auto-bloqueo.
- Botón **+ Crear usuario** abre modal con form completo: email, nombre, contraseña inicial (min 8 chars), rol (admin/cliente — superadmin se crea por Studio), proyecto a asignar.
- Por fila: **Editar** (modal con full_name + proyecto editable; rol read-only por seguridad de trigger) y **Desactivar** (soft delete).
- **Soft delete (Desactivar)**:
  - Setea `profiles.deleted_at = now()`.
  - Llama `auth.admin.updateUserById({ ban_duration: "876000h" })` para invalidar sesiones activas y bloquear futuro login.
  - El user desaparece del listado pero los datos persisten en DB.
  - Al intentar loguear: mensaje "Tu cuenta fue desactivada".
  - Reactivación: hoy se hace desde Studio (clear deleted_at + ban_duration: "none").

### 5.4 Selector y picker de proyecto

- Login → si el user tiene 1 proyecto, redirect directo a `/proyectos/<id>`. Si tiene varios, picker en `/`. Si tiene 0, mensaje "Sin proyectos asignados".
- **Switcher en el header**: dropdown con todos los proyectos accesibles. Selección navega instantáneamente.
- Se oculta en rutas no-scopeadas: `/configuracion`, `/admin/*` (no aplican a un proyecto puntual).
- El proyecto activo vive en la URL (`/proyectos/[projectId]/...`). Bookmarkeable, share-able, no requiere cookie state.

### 5.5 Overview de proyecto — `/proyectos/[id]`

KPIs agregados sobre todos los launches del proyecto. Los **rate-style KPIs (ROAS, show rate, close rate, CAC) se calculan sobre los totales** — no son promedio de ratios, así launches grandes no se subcuentan.

- Header: nombre + razón social + contador "N total · M activos · K finalizados".
- Grid de 8 KPI cards: Revenue total / Inversión total / Profit (verde o rojo según signo) / ROAS agregado / CAC agregado / Leads totales / Show rate / Close rate.
- Sección "Últimos lanzamientos": preview de los 5 más recientes con status badge + revenue, linkeables al detalle.
- Empty state cuando no hay launches: CTA "Crear primer lanzamiento" si el caller puede editar.

### 5.6 Lanzamientos — listado + detalle + CRUD

**Listado** `/proyectos/[id]/launches`
- Tabla con: Nombre / Fecha / Status (badge coloreado) / Revenue / ROAS / Profit (verde/rojo).
- Orden por fecha desc.
- Botón **+ Nuevo lanzamiento** (admin+ solamente).

**Detalle** `/proyectos/[id]/launches/[launchId]`
- Header con nombre, fecha, tipo, status badge, plataformas como chips.
- Botones **Editar** y **Borrar** (admin+ solamente; borrar con type-DELETE).
- **Grid de 12 KPIs**:
  - Revenue · Inversión total · Profit · ROAS
  - CAC · Leads totales · Show rate · Close rate
  - CPL Meta · CPL Google · CPL TikTok · % WhatsApp del revenue
- Cada KPI cardea con el contexto extra (e.g. "X leads · $Y invertido").
- Sección de datos diarios + gráfico (ver 5.7).
- Sección "Resumen ejecutivo" (ver 5.9).

**Form de crear/editar** `/proyectos/[id]/launches/{new|[lid]/edit}`
- Form unificado con ~22 campos en 6 secciones: Datos básicos / Meta Ads / Google Ads / TikTok Ads / Webinar+lifecycle / Conversión+revenue.
- Plataformas como pills checkbox.
- Validación: nombre obligatorio, números coercionados con safe math (sin NaN/Infinity nunca).
- Cliente que intenta acceder a `/new` o `/edit` por URL directa → redirect al detalle.

**Borrar** — modal con type-`DELETE`. Borra launch + todos sus daily entries via cascade.

### 5.7 Datos diarios + gráfico

- Sub-sección dentro del detalle del launch.
- Tabla con 1 fila por fecha, 7 canales (Meta Ads / Google Ads / TikTok Ads / Orgánico / WhatsApp / Referidos / Otro) + columna Total.
- Botón **+ Agregar día** abre modal con fecha + 7 inputs numéricos.
- Por fila: **Editar** (mismo modal prefilled) y **Borrar** (inline two-step confirm).
- Validación: fecha obligatoria, al menos 1 canal > 0, no se permiten duplicados (constraint unique `launch_id + date` con mensaje friendly).
- **Gráfico** debajo: LineChart de Recharts con 1 línea por canal con datos. Canales con todo en 0 no se grafican para no saturar la leyenda. Tooltip con valores por día.
- Empty state: "Agregá uno para empezar a ver el gráfico".

### 5.8 Calculadora — `/calculadora`

Simulador 100% client-side, sin persistencia, accesible a todos los roles.

**Modo Reverse — meta → presupuesto:**

Inputs: Revenue Goal, Ticket, ROAS objetivo, % asistencia clase 1, % asistencia oferta, % conversión oferta→app, % conversión app→venta, CPL, costos extra (equipo / OpEx / comisiones).

Outputs:
- Funnel inverso: Ventas necesarias → Apps → Asistentes oferta → Asistentes clase 1 → Leads necesarios.
- Económicos: Inversión máx (revenue/ROAS), Budget (leads × CPL), Total costos, Profit, Margen %, ROAS proyectado, BE ROAS (break-even), CPL máx, CPA máx.
- **Gráfico de funnel horizontal** con 5 pasos coloreados.

**Modo Forward — presupuesto → resultados:**

Inputs: Budget, CPL, Show up %, Close %, Ticket.

Outputs: Leads, Asistentes, Ventas, Revenue, Profit (verde/rojo), ROAS (verde si ≥1).

- Cambio entre modos preserva el estado de cada uno (no perdés lo que tipeaste).
- Math reutiliza los helpers safe (`safeNumber`, `safeDiv`, `safePercent`) del módulo `lib/kpis.ts`. Sin NaN ni Infinity.

### 5.9 Integraciones — `/proyectos/[id]/integraciones` (stub)

6 providers soportados: **Meta Ads · Google Ads · TikTok Ads · WhatsApp · SendFlow · Go High Level**.

- Banner amarillo en la página avisando que es **modo stub**: las credenciales se guardan pero todavía no llaman a las APIs externas.
- 6 cards (2 columnas en desktop) con: icono coloreado del provider, status (Conectado/Desconectado), Account ID, último sync, estado de la conexión.

**Para admin+:**
- **+ Conectar** (cuando está desconectado): modal con Account ID + secret (password input).
- **Rotar** (cuando está conectado): modal solo con la nueva credencial.
- **Desconectar** (cuando está conectado): inline confirm.

**Seguridad de credenciales:**
- Los secrets viven en `project_secrets` que tiene **RLS habilitada con cero policies**.
- Solo el service-role lee/escribe esa tabla.
- Ningún admin ni cliente puede ver los secrets ni siquiera con queries directas.
- La UI nunca recibe el valor del secret — solo refleja el status del registro de `project_integrations`.

### 5.10 Resumen ejecutivo IA — sección dentro del detalle del launch

Análisis automático del lanzamiento generado server-side por OpenAI.

- Botón **Generar** (o **Regenerar** después de la primera vez).
- Disponible para todos los roles con acceso al proyecto.
- El prompt entrega al modelo: nombre, fecha, tipo, status, plataformas, inversión y leads por canal, funnel completo, revenue, todos los KPIs computados, datos diarios.
- Output estructurado en 3 secciones:
  - **Lo que funcionó** (3 puntos)
  - **Lo que no funcionó** (3 puntos)
  - **Recomendaciones para el próximo lanzamiento** (3 acciones priorizadas, lista numerada)
- Máximo 350 palabras, español rioplatense, sin clichés.
- Renderizado como markdown con headings, listas numeradas y bullets, bold para métricas clave. Estilo consistente con el resto del dashboard.

**Por qué server-side:**
La key de OpenAI vive solo en `OPENAI_API_KEY` (env del servidor). Nunca llega al browser. El prototipo previo exponía la key de Anthropic en el front — eso era un red flag que ya quedó fixeado.

### 5.11 Configuración personal — `/configuracion` (todos los roles)

- Form de **Mi información**: email read-only (gestionado por Supabase Auth) + nombre completo editable.
- Form de **Cambiar contraseña**: nueva + repetir (min 8 chars).
- Mensajes de éxito/error inline. Tras cambio de contraseña, el cambio aplica inmediatamente.

---

## 6. UI / UX

- **Header y sidebar fijos**: el shell ocupa la viewport entera y nunca scrollea. Solo el contenido central scrollea. Sidebar y header quedan siempre visibles.
- **Menú de usuario en la topbar**: icono de persona → dropdown con nombre/email/rol, link a Configuración, Cerrar sesión (en rojo). Click fuera o Esc cierra.
- **Sidebar** con navegación:
  - Operaciones del proyecto activo: Overview, Lanzamientos, Calculadora, Integraciones.
  - Sección Admin (solo superadmin): Proyectos, Usuarios.
- **Switcher de proyecto** en el header — se oculta en rutas no-scopeadas (`/configuracion`, `/admin/*`).
- **Diseño consistente** con tokens de color (magenta brand `#FF006E`, verde success `#00D084`, amarillo warning `#FFB800`, rojo error `#FF5A5F`) y tipografía Inter en toda la app.
- **Estados claros**: hover en links, loading en submits ("Generando…", "Guardando…", "Borrando…"), empty states con CTA accionable cuando aplica, error inline en cada form.
- **Modales accesibles**: role="dialog", aria-modal, Esc para cerrar, click fuera para cerrar, focus en input al abrir.
- **Patrones de delete diferenciados por riesgo**:
  - Type-`DELETE` modal: para proyectos y lanzamientos (alto riesgo, cascadea).
  - Inline two-step confirm: para datos diarios, desconexión de integración, desactivación de usuario (bajo riesgo o reversible).

---

## 7. Seguridad — resumen consolidado

| Riesgo | Mitigación |
| --- | --- |
| Cliente lee datos de otro proyecto | RLS filtra por `has_project_access`. Layout server-side valida access. Proxy redirige sin sesión. |
| Cliente escribe (CRUD launches, etc.) | RLS bloquea por `can_edit_project`. Server Actions re-chequean. Cliente no ve los botones tampoco. |
| Usuario auto-escala su propio rol | Trigger `guard_profile_role` raisa excepción 42501. Service-role tampoco puede vía UI. |
| Credenciales de integraciones expuestas | `project_secrets` con RLS sin policies. Solo service-role. UI nunca recibe el valor. |
| Service-role key o OpenAI key filtra al browser | `server-only` imports + naming convention (`NEXT_PUBLIC_` solo para vars seguras). |
| Sesión vieja de user desactivado | `auth.admin.updateUserById({ ban_duration })` la invalida + filtro `deleted_at IS NULL` en `getSessionProfile`. |
| URL tampering (e.g. `/proyectos/[id-ajeno]/...`) | Layout de proyecto chequea acceso via RLS y redirige; pages re-validan que el launch.project_id matchee el URL. |
| Borrado accidental de proyecto | Modal con type-`DELETE` literal + advertencia de cascada. |
| Inyección via Server Actions | Validación + coerción de FormData en cada action. Nada se confía. |
| Cambio de rol vía UI | Explícitamente bloqueado. Cambios de rol requieren Studio + apagar trigger. |

---

## 8. Variables de entorno

| Variable | Lado | Para qué |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | público | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | público | Anon key (Authenticated user) |
| `SUPABASE_SERVICE_ROLE_KEY` | **servidor** | Service-role para Server Actions (invites, secrets, soft delete) |
| `OPENAI_API_KEY` | **servidor** | Generación de resumen ejecutivo |
| `NEXT_PUBLIC_APP_URL` | público | URL canónica (futuros redirect targets) |

> Regla: `SUPABASE_SERVICE_ROLE_KEY` y `OPENAI_API_KEY` nunca se importan desde código de cliente. El bundler de Next falla si lo intentás (imports `server-only`).

---

## 9. Lo que NO está implementado todavía

Decisiones conscientes, no olvidos. Cada uno tiene su razón y su gancho técnico.

| Feature | Estado | Razón |
| --- | --- | --- |
| Sync real Meta / Google / TikTok / etc. | Stub — solo guarda credenciales | Cada provider tiene su propio OAuth + esquema de datos. Es un proyecto en sí mismo. La UI ya está lista para enchufar el sync cuando se haga. |
| Password reset por email | Rutas creadas (`/auth/confirm`, `/set-password`), flujo no cableado | Requiere configurar SMTP (Resend/SendGrid) y customizar template de email. Se hace cuando el cliente lo pida. |
| Reactivar usuario desactivado desde UI | Solo desde Studio (limpiar `deleted_at` + `ban_duration: 'none'`) | Caso de uso bajo. Si se vuelve común, se agrega botón. |
| Cambiar rol de usuario desde UI | Bloqueado por trigger `guard_profile_role` | Cambiar el rol vía UI requiere una migración chica para que service-role pueda hacerlo. No riesgosa, se agrega cuando se necesite. |
| Asignación de un user a múltiples proyectos | El schema lo soporta, la UI no | El form de edit hoy reemplaza la asignación por una. Multi-proyecto se agrega si surge el caso de uso. |
| Vista mobile responsive completa | Desktop está OK; mobile rompe en algunas vistas (sidebar, tablas anchas) | Pasada de pulido pendiente. Hoy todo el flujo funciona en desktop. |
| Tema claro/oscuro con toggle manual | Hoy hereda del `prefers-color-scheme` del sistema | Si el cliente lo pide, se agrega picker en el menú de usuario. |
| Backups automáticos | Depende del plan Supabase | Free tier no incluye. Si el proyecto va a prod con datos reales, hay que upgradear o programar `pg_dump`. |
| Custom SMTP (Resend/SendGrid) | No configurado | No hace falta hoy (no se mandan emails). Necesario cuando se active password reset. |

---

## 10. Estructura del repo

```
launch-os/
├── docs/
│   ├── AUDITORIA.md              ← este archivo
│   └── legacy/                   ← snapshot del prototipo Vite previo (referencia)
├── public/
├── supabase/
│   ├── config.toml
│   ├── migrations/               ← 5 migraciones, orden histórico
│   │   ├── 0001_schema.sql
│   │   ├── 0002_functions.sql
│   │   ├── 0003_rls.sql
│   │   ├── 0004_seed.sql
│   │   └── 0005_soft_delete_profiles.sql
│   └── tests/
│       └── rls_smoke_test.sql    ← 8 aserciones pgTAP que validan toda la RLS
└── src/
    ├── app/
    │   ├── (auth)/                ← rutas públicas (login, set-password)
    │   ├── auth/confirm/          ← Route Handler para flujos futuros de email
    │   ├── (app)/                 ← rutas protegidas (todo el dashboard)
    │   │   ├── proyectos/[projectId]/
    │   │   │   ├── launches/      ← list / new / [launchId] / [launchId]/edit
    │   │   │   └── integraciones/
    │   │   ├── calculadora/
    │   │   └── configuracion/
    │   └── (admin)/admin/         ← solo superadmin
    │       ├── proyectos/         ← CRUD de proyectos
    │       └── usuarios/          ← CRUD + soft delete de usuarios
    ├── components/
    │   ├── ui/                    ← primitivas (Button, Input, Select, Badge, etc.)
    │   └── dashboard/             ← composiciones (Shell, Sidebar, Topbar, UserMenu,
    │                                 LaunchForm, KpiGrid, DailyChart, Calculator, etc.)
    ├── lib/
    │   ├── ai/                    ← provider abstraction + summarize-launch
    │   ├── auth/                  ← permissions + Server Actions (signOut)
    │   ├── calculator/            ← math reverse/forward pure
    │   ├── integrations/          ← provider catalog + list helper
    │   ├── launches/              ← types + list + get helpers
    │   ├── launch-daily/          ← types + list helper
    │   ├── projects/              ← list + aggregates helpers
    │   ├── supabase/              ← clientes browser/server/service + middleware refresh
    │   ├── users/                 ← list helper para admin
    │   ├── format.ts              ← formatters monetarios/percent/fecha
    │   ├── kpis.ts                ← cálculos derivados puros (safe math)
    │   └── types/database.ts      ← tipos generados desde Supabase
    └── proxy.ts                   ← session refresh + redirect coarse (Next 16 ex-middleware)
```

---

## 11. Testing y verificación

- **Smoke test de RLS**: `supabase/tests/rls_smoke_test.sql` con **8 aserciones pgTAP** que validan el modelo de seguridad end-to-end:
  1. Cliente NO puede insertar launches.
  2. Admin SÍ puede insertar launches en su proyecto.
  3. Admin SÍ ve su proyecto asignado.
  4. Admin NO ve un proyecto ajeno.
  5. Superadmin ve todos los proyectos.
  6. `project_secrets` inaccesible desde rol authenticated.
  7. Cliente SÍ puede leer launches de su proyecto.
  8. Cliente NO ve un proyecto ajeno.
- **Validación manual end-to-end** por fase, con checklist específica documentada antes de cada commit.
- **Build + typecheck + lint** verde en cada commit (TypeScript estricto, ESLint flat config).
- **Defense in depth**: si una capa de seguridad fuera bypasseable, las otras dos siguen activas. Ningún punto único de falla.

---

## 12. Datos y métricas — qué se trackea

### Por lanzamiento (~22 campos directos en `launches`)

- Identificación: nombre, fecha, tipo (En Vivo / Automatizado / Replay), status (Activo / Escalando / Finalizado / Evergreen), plataformas.
- Inversión publicitaria: Meta / Google / TikTok (investment + clicks + leads cada uno).
- Funnel directo: contactos vía API, registrados, asistentes, hasta el pitch.
- Conversión: ventas totales, ventas mensuales, ventas anuales.
- Revenue: revenue total, ingresos vía WhatsApp.
- Sources jsonb: provenance por métrica (manual / meta / sendflow / ghl / tiktok). Útil para auditoría del origen del dato.

### Datos diarios (1 fila por launch+fecha, 7 canales)

- Meta Ads, Google Ads, TikTok Ads, Orgánico, WhatsApp, Referidos, Otro — leads por canal por día.

### KPIs calculados (no se persisten — se recomputan en cada render)

Por lanzamiento:
- CPL Meta / Google / TikTok
- ROAS, CAC
- Show rate (asistentes / registrados)
- Close rate (ventas / asistentes)
- Profit (revenue − inversión)
- % WhatsApp del revenue total
- Total de leads e inversión agregada

Por proyecto (agregado sobre todos los launches):
- Revenue total, inversión total, profit total
- ROAS agregado (revenue total / inversión total — no promedio de ratios)
- CAC agregado (inversión total / ventas totales)
- Show rate y close rate agregados
- Contador de launches activos vs finalizados

---

## 13. Infraestructura

- **Backend**: proyecto Supabase remoto. Modo sandbox-to-prod: mientras la base esté vacía es manejable destructivamente; cuando entren datos reales, las migraciones van con `db push` incremental y el smoke test destructivo se jubila.
- **Frontend**: Next.js. Local dev con `npm run dev`. Para deploy: cualquier host compatible con Next 16 (Vercel es el camino más directo; también funciona en self-hosted con Node + el build de `npm run build`).
- **Sin Docker**: el flujo de desarrollo no requiere Docker corriendo. Todo apunta al Supabase remoto via CLI.
- **Variables de entorno**: las claves sensibles (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`) viven solo en `.env.local` (gitignored) y en el dashboard del provider de deploy.

---

## 14. Estado final

**Implementado y probado:**
- Auth con 3 roles + invite-only + soft delete + ban
- CRUD completo de proyectos / usuarios / lanzamientos / datos diarios
- Métricas en vivo en 3 niveles (launch, proyecto, calculadora)
- Resumen ejecutivo IA server-side con render markdown
- Gestión de credenciales de 6 integraciones con seguridad blindada
- Defense in depth en 3 capas con smoke test SQL que lo valida
- UI consistente con app shell fija, navegación clara, modales accesibles

**Listo para producción cuando se complete:**
- Sync real de las integraciones (Meta, Google, TikTok, etc.)
- Configuración de SMTP para password reset si se quiere ese flujo
- Pasada de mobile responsive
- Backups automáticos según el plan de Supabase elegido

Todo el código vive en un repo de git con commits atómicos por entrega, build verde en cada uno, comentarios donde el "porqué" no es obvio del código. La migración del prototipo original (un único archivo de ~1900 líneas con `localStorage` y la key de IA expuesta en el browser) está completa.
