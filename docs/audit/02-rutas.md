# 02 · Mapa de rutas y superficie de la app

Objetivo: enumerar exhaustivamente lo que hay bajo `src/app/`, qué ejecuta cada archivo, cómo se autoriza y qué datos consume. Las rutas del portal cliente están marcadas explícitamente para diferenciarlas de las internas del equipo.

Todas las páginas son **Server Components** salvo las 6 marcadas al final de `01-estructura.md` §1.9 (todas son *forms*, no *pages*). Los `layout.tsx` se ejecutan siempre en el servidor.

**Runtime**: default de Next 16 (Node.js Fluid Compute en Vercel). Ninguna ruta declara `export const runtime = "edge"` — el único override de segment config detectado es `maxDuration = 300` en `launches/[launchId]/integraciones/page.tsx:15` y `dynamic = "force-dynamic"` en `dev/auditoria/page.tsx:11`.

---

## 2.1 Layouts y árbol de anidamiento

```
app/
├── layout.tsx                                 [server]  root html + tema (cookie THEME_COOKIE)
│                                                        + Inter font + <body>. No auth.
│
├── (auth)/layout.tsx                          [server]  wrapper centrado. **Sin auth guard.**
│   ├── login/page.tsx                                   [server]  renderiza form (client)
│   └── set-password/page.tsx                            [server]  renderiza form (client)
│
├── (admin)/layout.tsx        (admin/layout.tsx:17)      requireRole("superadmin")
│   └── admin/                                           → Shell del equipo (mismo del (app))
│       ├── proyectos/                                   CRUD proyectos + edit + new
│       └── usuarios/                                    CRUD usuarios + soft delete
│
├── (app)/layout.tsx          (app/layout.tsx:23-24)     requireSessionProfile()
│   │                                                    + redirect a /portal si role="cliente"
│   ├── page.tsx                                         picker de proyecto (0 / 1 / N)
│   ├── calculadora/                                     3 archivos (page + actions)
│   ├── configuracion/                                   nombre + password + tema
│   ├── dev/auditoria/                                   ruta oculta (`dynamic=force-dynamic`)
│   └── proyectos/[projectId]/layout.tsx (layout.tsx:24-32)  chequea que el projectId sea
│       │                                                     accesible (`.from('projects')…`)
│       │                                                     → redirect("/") si no
│       ├── page.tsx                                     overview (12 KPIs, últimos launches)
│       ├── analitica/                                   dashboard analítico
│       ├── audit/                                       log de auditoría
│       ├── bancos/                                      CRUD bancos (Fase 11)
│       ├── cobros/                                      vista global de cobros
│       ├── comisiones/                                  reglas + modalidades + payouts
│       ├── equipo/                                      miembros del proyecto
│       ├── launches/                                    listado
│       │   └── [launchId]/layout.tsx  (…/layout.tsx:31)  fetch launch + tabs + acciones
│       │       ├── page.tsx  → redirect a ./kpi
│       │       ├── alertas/                             reglas + row-actions (client)
│       │       ├── calendario/                          calendario de fases
│       │       ├── cobros/                              cobros del launch
│       │       ├── ia/                                  resumen ejecutivo IA
│       │       ├── integraciones/    (maxDuration = 300) config Meta+GHL+SendFlow por launch
│       │       ├── kpi/                                 grid de KPIs
│       │       └── (Server Actions colaterales: ai-actions.ts, daily-actions.ts,
│       │          sync-actions.ts, alertas/actions.ts)
│       ├── leaderboard/                                 leaderboard + payouts modal
│       ├── leads/                                       tabla + kanban + import wizard
│       ├── metodos-pago/                                CRUD métodos (Fase 11)
│       ├── productos/                                   CRUD productos (Fase 8)
│       └── ventas/                                      vista global ventas
│
└── (cliente)/layout.tsx      (cliente/layout.tsx:24-25) requireSessionProfile()
    │                                                    + role !== "cliente" → redirect("/")
    └── portal/
        ├── page.tsx                                     picker portal (0/1/N)
        ├── calculadora/                                 calculadora client-side + action
        ├── configuracion/                               config personal cliente
        └── proyectos/[projectId]/layout.tsx  (layout.tsx:24-31)  gate por acceso al project
            ├── page.tsx                                 overview cliente
            ├── leads/                                   tabla leads (sin team member)
            └── launches/
                └── [launchId]/
                    ├── page.tsx                         detalle
                    └── ia/                              resumen ejecutivo cliente
```

Guardas efectivas por capa:

- **Proxy (`src/proxy.ts:26-34`)**: redirect a `/login` si no hay sesión, salvo paths en `PUBLIC_PATHS = ["/login", "/auth/confirm"]` (`proxy.ts:20`). Applica a *todo* incluyendo `api/*`.
- **Layout (auth capa #2)**: la tabla siguiente muestra el guard por archivo.
- **RLS (capa #3)**: chequeada en `03-datos.md`.

| Layout | Archivo:línea | Guard efectivo |
| --- | --- | --- |
| `(auth)/layout` | `src/app/(auth)/layout.tsx:1-11` | **ninguno** (páginas públicas) |
| `(admin)/layout` | `src/app/(admin)/layout.tsx:17` | `requireRole("superadmin")` |
| `(app)/layout` | `src/app/(app)/layout.tsx:23-24` | `requireSessionProfile()` + redirect si cliente |
| `(cliente)/layout` | `src/app/(cliente)/layout.tsx:24-25` | `requireSessionProfile()` + redirect si no cliente |
| `(app)/proyectos/[projectId]/layout` | `src/app/(app)/proyectos/[projectId]/layout.tsx:24-32` | `.from('projects').select('id').eq(projectId)` (delega a RLS + redirect si empty) |
| `(app)/proyectos/[projectId]/launches/[launchId]/layout` | `src/app/(app)/proyectos/[projectId]/launches/[launchId]/layout.tsx:38-54` | `getLaunch(launchId)` + `notFound()` si `launch.project_id !== projectId` |
| `(cliente)/portal/proyectos/[projectId]/layout` | `src/app/(cliente)/portal/proyectos/[projectId]/layout.tsx:22-31` | `.from('projects').select('id').eq(projectId)` + redirect a `/portal` |

**Root layout** (`src/app/layout.tsx:29-49`) no autoriza — solo lee la cookie de tema y monta el `<html>`.

---

## 2.2 Tabla exhaustiva de rutas

Convenciones:

- **Rol destinatario** = quién puede llegar tras layout+proxy, no lo que ve el sidebar.
- **Auth (page)** = guard *dentro* del `page.tsx` (además del layout). Muchas páginas confían en el layout y no re-verifican; se anota "hereda".
- **LOC** cuenta solo `page.tsx` (no incluye `loading.tsx`, `actions.ts`, componentes hijos).

### 2.2.1 Rutas públicas / auth

| Ruta | Archivo | Tipo | S/C | Auth requerida | LOC | Datos que consume |
| --- | --- | --- | --- | --- | ---: | --- |
| `/login` | `src/app/(auth)/login/page.tsx` | page | server | pública | 35 | error/dbg querystring |
| `/set-password` | `src/app/(auth)/set-password/page.tsx` | page | server | pública, pero requiere sesión válida para que el form corra | 17 | ninguno server-side |
| `/auth/confirm` | `src/app/auth/confirm/route.ts` | route handler | server | pública (procesa el link) | 60 | `code` o `token_hash+type` (PKCE / OTP) |

Notas:

- El form de login usa `"use client"` (`src/app/(auth)/login/form.tsx:1`).
- `set-password` acepta *cualquiera* con sesión — no filtra por rol ni por si aún necesita setearla. Bajo riesgo (el flow lo activa el proxy solo tras `/auth/confirm`), pero anotable.

### 2.2.2 Superadmin (route group `(admin)`)

Todas heredan `requireRole("superadmin")` del layout. Ninguna re-verifica.

| Ruta | Archivo | Tipo | LOC | Datos |
| --- | --- | --- | ---: | --- |
| `/admin/proyectos` | `.../admin/proyectos/page.tsx` | list | ~90 | `projects` + membership counts |
| `/admin/proyectos/new` | `.../admin/proyectos/new/page.tsx` | form | ~50 | ninguno |
| `/admin/proyectos/[projectId]/edit` | `.../admin/proyectos/[projectId]/edit/page.tsx` | form | ~80 | `projects` por id |
| `/admin/usuarios` | `.../admin/usuarios/page.tsx` | list + modal | ~250 | `profiles` + `project_members` + `projects` (join) |

Server Actions asociadas:
- `admin/proyectos/actions.ts:44,71,95` — createProject / updateProject / deleteProject. Todas revalidan `requireRole("superadmin")`.
- `admin/usuarios/actions.ts:46,115,193` — createUser / updateUser / deactivateUser. Usan `createServiceClient()` para operaciones sobre `auth.admin`.

### 2.2.3 Equipo interno (route group `(app)`, no cliente)

Layout: `requireSessionProfile()` + redirect si `role === "cliente"`. Todos los pages internos son server components salvo los forms cliente-side listados.

| Ruta | Archivo | Auth (además del layout) | LOC | Datos |
| --- | --- | --- | ---: | --- |
| `/` | `(app)/page.tsx` | hereda | 62 | `listAccessibleProjects()` |
| `/calculadora` | `(app)/calculadora/page.tsx` | `requireSessionProfile()` (calculadora/page.tsx:15) | 45 | ninguno server |
| `/configuracion` | `(app)/configuracion/page.tsx` | `requireSessionProfile()` (page.tsx:10) | 85 | `profiles` |
| `/dev/auditoria` | `(app)/dev/auditoria/page.tsx` | `requireSessionProfile()` (page.tsx:67); *filtra por `role`* dentro | 375 | `audit_log` con paginación |
| `/proyectos/[id]` | overview | hereda; layout chequea acceso | ~200 | `projects` + `launches` + agregados |
| `/proyectos/[id]/analitica` | `.../analitica/page.tsx` | `requireSessionProfile()` (page.tsx:66) | ~180 | agregados por launch |
| `/proyectos/[id]/audit` | `.../audit/page.tsx` | `requireSessionProfile()` (page.tsx:24) | ~90 | `audit_log` del proyecto |
| `/proyectos/[id]/bancos` | `.../bancos/page.tsx` | `requireSessionProfile` + `userCanEditProject` (page.tsx:38) | ~100 | `banks` |
| `/proyectos/[id]/cobros` | `.../cobros/page.tsx` | `requireSessionProfile` (page.tsx:56) | ~180 | `payments` + `sales` |
| `/proyectos/[id]/comisiones` | `.../comisiones/page.tsx` | `requireSessionProfile` + `userCanEditProject` (page.tsx:35) | ~160 | `commission_rules` + `payment_modalities` + `commission_tiers` + `launch_revenue_split` |
| `/proyectos/[id]/equipo` | `.../equipo/page.tsx` | `requireSessionProfile` + `userCanEditLaunchesIn` (page.tsx:35) | ~120 | `team_members` |
| `/proyectos/[id]/leaderboard` | `.../leaderboard/page.tsx` | `requireSessionProfile` (page.tsx:49) | ~180 | RPCs `leaderboard_*` (mig. 0046, 0047) |
| `/proyectos/[id]/leads` | `.../leads/page.tsx` | `requireSessionProfile` + `userCanEditLaunchesIn` (page.tsx:88) | **533** | `leads` paginados + kanban + filtros |
| `/proyectos/[id]/metodos-pago` | `.../metodos-pago/page.tsx` | `requireSessionProfile` + `userCanEditProject` (page.tsx:35) | ~110 | `payment_methods` |
| `/proyectos/[id]/productos` | `.../productos/page.tsx` | hereda | ~80 | `products` |
| `/proyectos/[id]/ventas` | `.../ventas/page.tsx` | hereda | ~180 | `sales` + `payments` + `commissions` |
| `/proyectos/[id]/launches` | `.../launches/page.tsx` | hereda | ~120 | `launches` con status |
| `/proyectos/[id]/launches/[lid]` | `page.tsx` (redirect) | hereda | 14 | — |
| `/proyectos/[id]/launches/[lid]/kpi` | `.../kpi/page.tsx` | hereda | ~200 | KPIs computados |
| `/proyectos/[id]/launches/[lid]/calendario` | `.../calendario/page.tsx` | hereda | ~140 | `launch_calendar` |
| `/proyectos/[id]/launches/[lid]/cobros` | `.../cobros/page.tsx` | hereda | ~120 | `payments` scoped |
| `/proyectos/[id]/launches/[lid]/ia` | `.../ia/page.tsx` | hereda | ~90 | `ai_runs` + summary IA |
| `/proyectos/[id]/launches/[lid]/integraciones` | `.../integraciones/page.tsx` (`maxDuration=300`) | hereda | ~380 | `project_integrations` + `launch_secrets` + `integration_runs` |
| `/proyectos/[id]/launches/[lid]/alertas` | `.../alertas/page.tsx` | hereda; sub-forms client | ~130 | `alert_rules` + evaluaciones |

Observaciones que quedaron sueltas y merecen chequeo:

- **Layout de proyecto** (`.../proyectos/[projectId]/layout.tsx`) apoya el gate en RLS: hace `.from('projects').select('id')` y redirige si null. La página no re-chequea `has_project_access`. Correcto en teoría, pero es una única capa server-side entre el proxy y la DB. Si RLS falla en una migración, todo el árbol de proyectos queda expuesto (`03-datos.md` cubre las policies).
- El layout del launch (`.../launches/[launchId]/layout.tsx:54`) valida `launch.project_id === projectId` — es el guard concreto contra URL tampering entre proyectos.
- **`(app)/dev/auditoria/page.tsx:67`** llama a `requireSessionProfile()` pero **no filtra por rol dev/superadmin dentro del código snapshot que vi**. Ver `01-estructura.md`: ese archivo tiene 375 LOC — hay que confirmar que el filtro de rol esté adentro. Marcado como pregunta abierta.

### 2.2.4 Portal cliente (route group `(cliente)`)

Layout: `requireSessionProfile()` + rechazo de todo rol ≠ `cliente` (`(cliente)/layout.tsx:24-25`).

| Ruta | Archivo | LOC | Datos |
| --- | --- | --- | ---: | --- |
| `/portal` | `(cliente)/portal/page.tsx` | 57 | `listAccessibleProjects()` (misma función que el equipo) |
| `/portal/calculadora` | `(cliente)/portal/calculadora/page.tsx` | ~80 | ninguno server; `actions.ts` opcional |
| `/portal/configuracion` | `(cliente)/portal/configuracion/page.tsx` | ~80 | `profiles` |
| `/portal/proyectos/[id]` | `.../proyectos/[projectId]/page.tsx` | ~120 | overview reducido |
| `/portal/proyectos/[id]/leads` | `.../leads/page.tsx` | ~120 | `client-portal/leads` — sin `team_member` |
| `/portal/proyectos/[id]/launches` | `.../launches/page.tsx` | ~100 | `launches` con status |
| `/portal/proyectos/[id]/launches/[lid]` | `.../launches/[launchId]/page.tsx` | ~180 | KPIs + calendario + IA |
| `/portal/proyectos/[id]/launches/[lid]/ia` | `.../launches/[launchId]/ia/page.tsx` | ~60 | resumen IA cacheado |

Observaciones:

- La lista de rutas del portal es **estrictamente menor** que la del equipo. No hay `/portal/proyectos/[id]/{cobros,comisiones,leaderboard,ventas,equipo,bancos,metodos-pago,productos,audit,analitica}`. Esa asimetría es **explícita** (ver comentario en `src/app/api/portal/…/report/executive/route.ts:24-32`: "explícitamente NO se expone el endpoint paralelo de comisiones").
- La bandera dura sobre datos sensibles (comisiones, cobros, equipo) es DB, no ruta — `0023_cliente_role_frontier.sql` (322 LOC) revoca grants al rol `cliente` sobre tablas internas. Confirmar en Paso 3.
- Layout del proyecto en el portal usa el mismo patrón `.from('projects').select('id')` (`(cliente)/portal/proyectos/[projectId]/layout.tsx:24-31`).

---

## 2.3 API Routes (route handlers)

Todas son **`GET`**. No hay `POST/PUT/DELETE/PATCH` — las mutaciones viven en Server Actions.

| Ruta | Archivo:línea | Auth | Escribe | Lee | Notas |
| --- | --- | --- | --- | --- | --- |
| `GET /api/notifications` | `notifications/route.ts:13` | `getSessionUser()` (soft; devuelve `[]` si no hay sesión) | no | `listMyNotifications()` (últimas 20) | Cache-Control: no-store |
| `GET /api/notifications/unread-count` | `notifications/unread-count/route.ts:14` | `getSessionUser()` (soft) | no | `countUnreadNotifications()` | Polling 30 s desde `notification-bell.tsx` |
| `GET /api/proyectos/[projectId]/leads/template` | `.../leads/template/route.ts:11` | `requireCanEditLaunchesIn` | no | `buildTemplateWorkbook()` | xlsx muestra |
| `GET /api/proyectos/[projectId]/leads/export?format=csv|xlsx` | `.../leads/export/route.ts:36` | `requireCanEditLaunchesIn` | no | `listLeadsForExport()` (max 50 k) | Truncation headers |
| `GET /api/proyectos/[projectId]/launches/[launchId]/daily/export?format=csv` | `.../daily/export/route.ts:29` | `requireCanEditLaunchesIn` | no | daily + ads merge | CSV |
| `GET /api/proyectos/[projectId]/launches/[launchId]/probes/ghl-messages` | `.../probes/ghl-messages/route.ts:23` | `requireCanEditLaunchesIn` | no | fetch GHL `/conversations/search` con service role | **Sanitiza teléfonos/emails/bodies** (`probes/ghl-messages/route.ts:24-26`) |
| `GET /api/proyectos/[projectId]/launches/[launchId]/report/executive` | `.../report/executive/route.ts:33` | `requireCanEditLaunchesIn` | no | KPIs + merged daily + kanban + calendar | PDF |
| `GET /api/proyectos/[projectId]/launches/[launchId]/report/commissions` | `.../report/commissions/route.ts:30` | `requireCanEditProject` | no | `sales` + `commissions` + rules | PDF |
| `GET /api/portal/proyectos/[projectId]/leads/export?format=csv|xlsx` | `portal/…/leads/export/route.ts:32` | `requireRole("cliente")` | no | `listClientLeadsForExport()` (sin `team_member_id`) | export cliente |
| `GET /api/portal/proyectos/[projectId]/launches/[launchId]/report/executive` | `portal/…/report/executive/route.ts:33` | `requireRole("cliente")` | no | KPIs + merged + kanban + calendar | PDF cliente |

Observaciones importantes:

- **No hay endpoint POST/PUT/DELETE en la app.** Todas las mutaciones son Server Actions (24 archivos `*actions.ts`). Eso simplifica el patrón de auth (uniforme via `requireX`), pero acopla el CRUD al framework Next; migrar a otro front (e.g. un mobile) requeriría rehacer todas las escrituras como API pública.
- **`getSessionUser` (soft)** vs **`requireX` (hard)**: los endpoints de notificaciones no fallan sin sesión — devuelven `count=0` / `rows=[]` (`notifications/route.ts:16`, `unread-count/route.ts:20`). La justificación está en el comment: la campanita polea desde cualquier shell y un usuario recién sesión-cerrada no debe pintar 401 ruidoso. Correcto, pero es un patrón inconsistente con el resto.
- **Handler de sync de integraciones** vive como **Server Action** en `.../launches/[launchId]/sync-actions.ts` (506 LOC), no como route handler. Se dispara desde botones en la UI. **No hay cron externo (Vercel Cron) que lo dispare** — coherente con la memoria `project_launchos_roadmap_v2` que dice "Fase 3c (cron) no empezada".

---

## 2.4 Rutas "de cara al cliente final" vs. internas

**Cliente final ve** (habilitado):

- `/login` (compartido con el equipo)
- `/set-password` (compartido)
- `/portal`, `/portal/calculadora`, `/portal/configuracion`
- `/portal/proyectos/[id]` + `leads/` + `launches/[lid]` + `launches/[lid]/ia`
- `GET /api/portal/proyectos/[id]/leads/export`
- `GET /api/portal/proyectos/[id]/launches/[lid]/report/executive`
- `GET /api/notifications*` (cualquier sesión válida — sirve al cliente)
- `GET /auth/confirm`

**Cliente final NO ve** (bloqueado por rol o por ausencia de ruta):

- Todo `/proyectos/[id]/**` fuera de portal (equipo)
- `/admin/**`
- `/dev/**`
- Cualquier PDF de comisiones, cobros del launch, alertas, integraciones, leaderboard, equipo, bancos, métodos de pago, productos, ventas, analítica.

Ancho de banda visible al cliente: **8 rutas HTML** + **2 endpoints de export/report** + **2 endpoints de notificación** = **12 endpoints públicos para el cliente**. Superficie chica por diseño. Bueno para modularizar; ese conjunto podría extraerse a un microfrontend o subdominio con relativamente poca fricción (ver `07-modularizacion.md`).

---

## 2.5 Server Actions — inventario

24 archivos `actions.ts` fuera de `api/`. Cada uno es un módulo `"use server"` con múltiples funciones exportadas. Autorización dentro de cada función (una única capa; no hay wrapper).

| Archivo | Auth predominante |
| --- | --- |
| `(admin)/admin/proyectos/actions.ts` | `requireRole("superadmin")` |
| `(admin)/admin/usuarios/actions.ts` | `requireRole("superadmin")` |
| `(app)/calculadora/actions.ts` | `requireSessionProfile` + `requireCanEditProject` (según acción) |
| `(app)/configuracion/actions.ts` | `requireSessionProfile` |
| `(app)/proyectos/[id]/bancos/actions.ts` | `requireCanEditProject` (6 funciones) |
| `(app)/proyectos/[id]/comisiones/actions.ts` | `requireCanEditProject` (6 funciones) |
| `(app)/proyectos/[id]/equipo/actions.ts` | (por ver — cadenas encontradas sólo en page) |
| `(app)/proyectos/[id]/launches/actions.ts` | `requireCanEditProject`, `requireCanEditLaunchesIn` |
| `(app)/proyectos/[id]/launches/[lid]/ai-actions.ts` | `requireSessionProfile` |
| `(app)/proyectos/[id]/launches/[lid]/alertas/actions.ts` | `requireSessionProfile` + `requireCanEditLaunchesIn` |
| `(app)/proyectos/[id]/launches/[lid]/daily-actions.ts` | (por ver) |
| `(app)/proyectos/[id]/launches/[lid]/sync-actions.ts` | `requireSessionProfile` (varias) |
| `(app)/proyectos/[id]/leaderboard/actions.ts` | (por ver) |
| `(app)/proyectos/[id]/leads/actions.ts` | (por ver — 4 archivos separados) |
| `(app)/proyectos/[id]/leads/bulk-actions.ts` | (por ver) |
| `(app)/proyectos/[id]/leads/import-actions.ts` | (por ver) |
| `(app)/proyectos/[id]/leads/sale-actions.ts` | **1 025 LOC** — el más grande |
| `(app)/proyectos/[id]/metodos-pago/actions.ts` | `requireCanEditProject` (3 funciones) |
| `(app)/proyectos/[id]/productos/actions.ts` | `requireCanEditProject` (3 funciones) |
| `(auth)/login/actions.ts` | público |
| `(auth)/set-password/actions.ts` | requiere sesión |
| `(cliente)/portal/calculadora/actions.ts` | `requireSessionProfile` |
| `(cliente)/portal/proyectos/[id]/launches/[lid]/ia/actions.ts` | `requireRole("cliente")` |
| `theme-actions.ts` (root) | público (setea cookie) |

Los "(por ver)" no salieron en el grep inicial de `requireX` — muy probablemente porque cada actions dispatchea a helpers en `src/lib/**/*.ts` que a su vez validan. `05-negocio.md` desagrega la lógica y confirma dónde está el guard.

---

## 2.6 Loading skeletons y estado de carga

Prácticamente **cada page tiene su `loading.tsx`** (memoria `project_launchos_roadmap_v2` menciona commit `ee6c9c1` "add loading skeleton components"). Cuenta rápida: 34 `loading.tsx` en `src/app/`. Distribuidos en todas las rutas visibles.

`src/components/ui/page-skeleton.tsx` (5 069 bytes) es la fábrica de skeletons — un solo componente reutilizado.

**Sin `error.tsx`**: no encontré ninguno bajo `src/app/`. Un error del server component se propaga al error boundary global de Next (`.next/server`) — cae en la página default de "Something went wrong" sin custom UI. **Deuda técnica menor**, se anota en `08-riesgos.md`.

**Sin `not-found.tsx`**: idem. Los `notFound()` (usados en el launch layout) también caen al default.

---

## 2.7 Uso de `route groups`, `dynamic`, `revalidate`, `runtime`, `maxDuration`

Grep sobre `src/app/`:

| Símbolo | Ocurrencias | Dónde |
| --- | ---: | --- |
| `export const runtime` | 0 | ninguna |
| `export const preferredRegion` | 0 | ninguna |
| `export const revalidate` | 0 | ninguna |
| `export const dynamic` | 1 | `dev/auditoria/page.tsx:11` → `"force-dynamic"` |
| `export const maxDuration` | 1 | `launches/[launchId]/integraciones/page.tsx:15` → `300` |
| Route groups `(nombre)` | 4 | `(auth)`, `(app)`, `(admin)`, `(cliente)` |

Observaciones:

- **Ningún revalidate**. No hay ISR ni caché en la capa Next. Todas las páginas server-render en cada request.
- El único `maxDuration = 300` (Fluid Compute default lo permite en Vercel actual — ver `01-estructura.md` §1.4) protege la página de configuración de integraciones porque `sync-actions` puede correr calls a Meta/GHL sincrónico.
- `dev/auditoria` fuerza `force-dynamic` porque agrega `?cursor=`, `?type=`, etc. y no debe cachearse.

---

## ⚠️ No pude determinar

- **Guard real de `dev/auditoria`**: `page.tsx:67` sólo llama a `requireSessionProfile`, no `requireRole`. Con 375 LOC en el archivo, hay que verificar si dentro filtra por `profile.role === "superadmin"` u otro rol. Si no filtra, **es una fuga: cualquier usuario autenticado podría leer el audit log del sistema entero**. Alto impacto potencial — mirar antes de exponer el subdominio a clientes.
- **Autorización de** `equipo/actions.ts`, `leaderboard/actions.ts`, `leads/{actions,bulk-actions,import-actions}.ts`, `launches/[lid]/daily-actions.ts`: no salieron con grep de `requireX`. Podría ser que delegan a helpers de `lib/`. `05-negocio.md` lo desagrega.
- **`(auth)/set-password/page.tsx`** no valida rol ni si la contraseña *ya* está seteada. Si un usuario tiene sesión y navega al link, aterriza acá. Bajo riesgo, pero raro para clientes finales.
- **`error.tsx` / `not-found.tsx`**: confirmar si se dan bien vía default o si conviene hacer custom antes de exponer clientes.
- **Cron jobs externos**: no hay `vercel.json` ni `crons` en config; no hay endpoints `POST /api/cron/*`. Si algo se dispara periódicamente hoy (watchdog stale runs, purge audit, recompute alerts, sync GHL/Meta), es **manual**. Pregunta abierta: ¿el `pg_cron` de Supabase corre algo? (mencionan en `0034_dev_role_and_audit.sql:13,304` "Studio → Database → Cron").

---

## Discrepancias con `docs/AUDITORIA.md`

`AUDITORIA.md:333-382` describe una estructura de rutas mucho menor:

| Dice | Realidad |
| --- | --- |
| Sólo `(auth)`, `(app)/…{calculadora, configuracion, proyectos/[id]/{launches, integraciones}}`, `(admin)/admin/{proyectos, usuarios}` (`AUDITORIA.md:353-362`) | **41 rutas HTML** + **10 route handlers** + **24 Server Actions files**. Se agregaron leads, ventas, cobros, comisiones, leaderboard, equipo, bancos, métodos-pago, productos, analítica, audit, dev/auditoria, portal cliente completo, y 6 tabs bajo cada launch (kpi, calendario, cobros, ia, integraciones, alertas). |
| Integraciones a nivel *proyecto* (`AUDITORIA.md:224-240`) | Existe `.../launches/[launchId]/integraciones/` — la config es **por launch**, no por proyecto (coherente con `launch_secrets` y `launch_integrations` en migraciones). El endpoint viejo `/proyectos/[id]/integraciones/` **no existe** en el árbol. |
| Auth "3 capas: proxy + layouts + RLS" | Sigue vigente, se sumó la 4ta convención de fact-check por `layout.tsx` a nivel `[projectId]` y a nivel `[launchId]`. |
| `src/app/(app)/proyectos/[id]/launches/{list, new, [lid], [lid]/edit}` (`AUDITORIA.md:355-357`) | Existe `list` y `[lid]`. **`new` y `[lid]/edit` fueron reemplazados por `LaunchFormModal`** (un modal del layout). El launch se crea/edita desde el header. |
| Ausencia total de menciones a: leads, sales, commissions, leaderboard, notifications, portal cliente, alerts, dev/auditoria, banks, payment methods, products, integraciones por launch, exports xlsx/csv/pdf | **Todos existen** y son mayoría del código. Documento entero desactualizado. |
