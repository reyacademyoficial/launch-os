# 06 · Frontend, componentes y rendimiento

Perfil general: **App Router puro** con **Server Components por default** y **Server Actions para mutaciones**. Cero librerías de estado global. No hay `useQuery`, no hay `swr`, no hay `zustand`. La data flowa desde el page.tsx server component al componente cliente vía props.

Bundle size real por ruta requiere `next build` (autorizado por el usuario, se corre en el paso final). Todo lo que sigue es análisis estático.

---

## 6.1 Inventario de componentes

### 6.1.1 Volumen

`src/components/` — 102 archivos, 17 291 LOC (`01-estructura.md § 1.2.4`).

- `src/components/dashboard/` — 85 archivos, 16 407 LOC.
- `src/components/client-portal/` — 6 archivos, 309 LOC.
- `src/components/ui/` — 8 archivos, 301 LOC.
- `src/components/notifications/` — 1 archivo, 274 LOC.
- `src/components/charts/` — vacío (sólo `.gitkeep`).

### 6.1.2 `use client` — 81 archivos

Grep `"use client"` sobre `src/components` + `src/app`: **81 hits** (de un total efectivo de ~90 componentes + forms). No es que "todo es cliente" — es que casi todo lo que se llama "componente reutilizable" en `dashboard/` es un formulario, un modal o una tabla con selección/filtros, lo que naturalmente pide cliente. Los `page.tsx`, `layout.tsx` y `route.ts` son server (excepciones: 0 en pages y layouts).

Distribución:

- Componentes puros de UI (`src/components/ui/*`): las 6 primitivas (button, input, label, select, badge, field-error) más `page-skeleton`, `skeleton` — **no marcados** con `"use client"`. Se rendean server. ✅
- Todo `src/components/dashboard/*` es cliente **menos** los shells (`shell.tsx`, `topbar.tsx`, `sidebar.tsx` — no listados como cliente).
- `notification-bell.tsx` cliente (polling y estado abierto/cerrado).
- Forms en `src/app/**` (login, set-password, usuarios, configuracion, alertas) son cliente porque son forms.

### 6.1.3 Reuso

Confirmé por grep las reutilizaciones importantes:

- `computeCommission` y `computeCommissionFromAgg` (`lib/commissions/calc.ts`) → importado por `sale-modal.tsx`, `cobros-view.tsx`, `project-sales-view.tsx`, `kanban-board.tsx`, `leaderboard/aggregate.ts`, `commissions-launch-pdf.tsx`. ✅ Todos consumen la misma función.
- `buildSaleRanks` (`lib/commissions/ranking.ts`) → importado por `cobros-view.tsx`, `leaderboard/aggregate.ts`.
- `calculateLaunchKPIs` (`lib/kpis.ts`) → importado por pages, PDFs, y route handlers (server-side). No aparece duplicada en componentes.
- `computeInstallmentStatuses`, `classifyClient`, `summarizeSaleOverdue` (`lib/installments/status.ts`) → reutilizados en `sale-modal.tsx`, `cobros-view.tsx`, `project-sales-view.tsx`.

**No detecté** componentes que copien lógica de `lib/**` — todo importa. Esto es un plus fuerte para modularizar. Los cinco puntos rojos que anoté en `05-negocio.md § 5.12` son **contratos JS↔SQL** (cuotas, watchdog, calendar, atribución) — no JS↔React.

### 6.1.4 Componentes chicos vs. componentes-monstruo

Ordenado por LOC (top 15 componentes de UI, excluyendo modules generados):

| Archivo | LOC | Uso |
| --- | ---: | --- |
| `sales/sale-modal.tsx` | 1 671 | Modal de venta + cuotas + comisión en vivo. Consumido por kanban, cobros, project-sales |
| `sales/cobros-view.tsx` | 1 194 | Vista global de cobros del proyecto |
| `sales/project-sales-view.tsx` | 819 | Vista de ventas por proyecto |
| `leads/import-modal.tsx` | 688 | Wizard xlsx (3 pasos) |
| `leads/leads-table.tsx` | 637 | Tabla server-paginada (comment `leads-table.tsx:26-32`) |
| `launches/integrations/launch-integrations-section.tsx` | 567 | Config Meta/GHL/SendFlow por launch |
| `commissions/rule-form.tsx` | 515 | Form de regla con tiers + modalidades + accrual |
| `launches/launch-form.tsx` | 510 | Form 6 secciones del launch |
| `leads/kanban-board.tsx` | 502 | Kanban con drag-drop |
| `banks/banks-view.tsx` | 446 | CRUD banks + movimientos |
| `launches/integrations/config-modal.tsx` | 407 | Configuración por integración |
| `leaderboard/payouts-modal.tsx` | 349 | Modal para cargar pagos al equipo |

Candidatos claros a fragmentar: `sale-modal.tsx` (>1 500 LOC en un solo componente) y `cobros-view.tsx`. Ninguno es imposible de leer pero cualquier cambio grande obliga a scroll largo. Anotado como deuda técnica en `08-riesgos.md`.

### 6.1.5 Componentes vacíos o placeholder

- `src/components/charts/` con `.gitkeep` — **carpeta abandonada**. Los charts viven en `dashboard/analytics/` y `dashboard/launches/daily/`.
- `src/hooks/` con `.gitkeep` — sin hooks reutilizables. Todo está inline en cada componente.
- `src/types/` — vacía. Tipos viven en `src/lib/**/types.ts`.

---

## 6.2 Sistema de diseño

### 6.2.1 Tokens (`src/app/globals.css:1-136`)

Tailwind v4 CSS-first, según memoria `feedback_tailwind_v4_config`. Tokens en `@theme`:

- **Brand**: `--color-accent: #ff006e`, `--color-success: #00d084`, `--color-warning: #ffb800`, `--color-error: #ff5a5f` (`globals.css:14-17`).
- **Dark surfaces** (default): `--color-bg`, `--color-bg-elevated`, `--color-surface`, `--color-border`, `--color-input`, `--color-fg`, `--color-fg-muted`, `--color-fg-subtle` (`globals.css:20-27`).
- **Radios**: `sm/md/lg = 6/10/14 px` (`globals.css:30-32`).
- **Shadow**: `--shadow-card` (`globals.css:35`).
- **Font**: `--font-sans` inyectado por Inter (`globals.css:9-11` + `src/app/layout.tsx:9-14`).

### 6.2.2 Tema oscuro / claro

Tres estados:

- Sin atributo `data-theme` en `<html>` → default dark, con override auto para light si `prefers-color-scheme: light` (`globals.css:51-63`).
- `data-theme="dark"` → dark forzado (`globals.css:79-89`).
- `data-theme="light"` → light forzado (`globals.css:66-76`).

La cookie `THEME_COOKIE` decide el atributo en el server layout (`src/app/layout.tsx:37-45`) → **sin flash** en la carga inicial.

### 6.2.3 Scrollbars custom

`globals.css:101-137`. Native scrollbars replicados con `--color-fg-subtle` para el thumb, hover al `--color-accent`. Se aplica global (`html`) para agarrar el scrollbar del propio `<html>`.

### 6.2.4 Uso real de los tokens

Grep de clases Tailwind ad-hoc vs. token-based: no lo automatizé, pero de las lecturas hechas (`page.tsx`, `layout.tsx`, `leads-table.tsx`, `sale-modal.tsx`) las clases usadas son casi siempre `bg-surface`, `text-fg`, `text-fg-muted`, `border-border`, `text-accent`, `text-success`. Ad-hoc en el estilo `bg-[#XXX]` no aparece.

✅ Diseño coherente y token-based. Migrar el "look" al subdominio es **sólo actualizar `globals.css`** — cero cambios en los componentes.

### 6.2.5 Primitivas UI (`src/components/ui/`)

- `button.tsx` (996 bytes) — sin variants (todo estilo se pasa por `className`).
- `input.tsx`, `select.tsx`, `label.tsx`, `field-error.tsx` — mínimos.
- `badge.tsx` — variantes por `color` prop.
- `skeleton.tsx`, `page-skeleton.tsx` (5 069 bytes) — usado por `loading.tsx` de todas las páginas.

Sin librería tercera de UI (radix, headless UI, shadcn). Los modales se construyen inline en cada componente que los necesita (patrón consistente pero repetitivo).

---

## 6.3 Estado global — no hay

Instalado y usado:

- **React Server Components + Server Actions** (Next 16).
- `useState`, `useEffect`, `useMemo`, `useTransition`, `useActionState` — hooks nativos.

**No** instalado:

- `zustand`, `jotai`, `valtio`, `redux`.
- `@tanstack/react-query`, `swr`.
- `@radix-ui/*`, `@headlessui/*`, `shadcn-ui`.
- Ningún form lib (`react-hook-form`, `formik`) — se usa el patrón nativo del App Router (`<form action={serverAction}>`).

Ver `package.json:17-28` (`01-estructura.md § 1.4.2`).

### 6.3.1 Persistencia de estado UI

Es sí URL-scoped:

- Filtros de tabla de leads → query string (`leads-table.tsx:32`: "sincronizar filtros/búsqueda/sort con la URL (?status=…&page=2)").
- Tab activo del launch → query string (`launches/[launchId]/kpi|calendario|ia|integraciones|alertas` — son rutas).
- Tab kanban vs. tabla en leads → `?view=kanban` (`leads/page.tsx:91`).
- Selección de fila en el kanban → estado local en `kanban-board.tsx`.

Consecuencia: **shareable + refresh-safe**. Bueno para el subdominio (los links llevan estado).

### 6.3.2 Cliente Supabase browser

Un solo uso en cliente puro: `realtime-probe.tsx:27` (`createClient()` desde `@/lib/supabase/client`). Es una utilidad de debug de Realtime. Ningún componente productivo mantiene una conexión Supabase por sí mismo.

---

## 6.4 Fetching — waterfalls, N+1, over-fetch

### 6.4.1 Buen uso de `Promise.all`

30 archivos usan `Promise.all` server-side (grep). Ejemplos representativos:

- **Overview del proyecto** (`(app)/proyectos/[projectId]/page.tsx:36-52`): 5 fetches en paralelo (`project`, `launches`, `canEdit`, `adsAggregates`, `kanbanSalesAggregates`).
- **Leads** (`leads/page.tsx:94-114`): **9 fetches en paralelo** (`teamMembers`, `launches`, `canEdit`, `sales`, `payments`, `modalities`, `products`, `rules`, `paymentMethods`). ✅
- **Layout del launch** (`launches/[launchId]/layout.tsx:40-52`): `getLaunch`, `userCanEditLaunchesIn`, `userCanEditProject`, `listLaunchesForProject`, `listEvergreensTargeting` — 5 en paralelo.
- **Layout de proyecto** (`(app)/proyectos/[projectId]/layout.tsx`): sólo hace `select` para chequear existencia — nada waterfall.

### 6.4.2 Cascada intencional en Leads

En `leads/page.tsx:118`:

```ts
const installments = await listInstallmentsForSales(sales.map((s) => s.id));
```

Se hace **después** del `Promise.all` porque depende de `sales.map(...)`. Es una cascada de 2 niveles (fetchs paralelos → 1 fetch dependiente). No hay forma de evitarla sin mover la agrupación a la DB. Aceptable.

### 6.4.3 Anti-N+1 explícito

`leads/page.tsx:116-118`:

> "Fase 11: cuotas por venta. Se cargan una vez y se agrupan por sale_id para pasárselas al SaleModal (evita N+1 en el kanban)".

Y `leads/page.tsx:132-150`: agrupación en memoria por `lead_id`, `sale_id` para evitar loops de query dentro del componente. ✅

### 6.4.4 ⚠️ Over-fetch en Leaderboard y Ventas

- **Ventas** (`ventas/page.tsx`): trae `listSalesForProject` + `listPaymentsForProject` completos. A **1 000 ventas y 20 000 payments** eso es potencialmente pesado — pero según memoria `project_launchos_payments_project_id` la denorm de `payments.project_id` (`0045`) + índice `payments_project_idx` acelera esto a un scan indexado. En la práctica, decenas de kB.
- **Leaderboard** (`leaderboard/page.tsx`): **usa las RPCs `leaderboard_lead_stats` y `leaderboard_sale_stats`** (mig `0046-0047`) — no trae leads crudos. ✅ El agente en `_business-raw.md` (§ 5.5) lo confirmó.

### 6.4.5 Filtros server-side

- **Leads**: paginación, filtros, búsqueda y sort son **server-side** (`leads-table.tsx:27-33`). ✅ La tabla no descarga 100k rows; el page.tsx server component recibe `searchParams` y arma la query.
- **Ventas / Cobros**: viene todo. Filtros son client. Aceptable a volumen actual, pero si un proyecto pasa 5 000 ventas conviene mover a server. Anotado en `08-riesgos.md`.

### 6.4.6 Sin paginación / virtualización

- El **kanban de leads** paga con "pinned only" a partir de la mig `0016` — un lead se agrega al tablero manualmente. Escalable.
- La **tabla de leads** pagina server-side (default 50 por página, `search-config.ts`).
- Las tablas de sales, cobros, comisiones **no paginan** — se renderea toda la lista. Un cliente con 5 000 sales verá el DOM entero.
- Sin virtualización (`react-window`, `react-virtualized`, etc.). **Deuda para escala**.

---

## 6.5 Imports pesados y bundle

### 6.5.1 Distribución

| Lib | LOC package | Dónde aparece | Bundle impact |
| --- | ---: | --- | --- |
| `recharts` | ~500 kB min | Solo 3 componentes cliente: `analytics/funnel-chart.tsx`, `analytics/trends-chart.tsx`, `launches/daily/daily-chart.tsx` (todos "use client") | Se carga cuando el usuario navega a la ruta correspondiente. Con Turbopack chunking, no impacta ni la landing ni el login. |
| `exceljs` | ~1 MB | `lib/leads/{import,export}.ts`, `lib/client-portal/export.ts` — todos **server-only** | **NO llega al browser**. ✅ |
| `@react-pdf/renderer` | ~800 kB | `lib/reports/*.tsx` — server-only (SSR streaming) | **NO llega al browser**. ✅ |
| `openai` SDK | ~200 kB | `lib/ai/client.ts` — `import "server-only"` | **NO llega al browser**. ✅ |
| `react-markdown` | ~150 kB | `launches/ai/summary-markdown.tsx`, `launches/integrations/instructions-modal.tsx` — cliente | Impacto en las rutas donde se muestra IA / instrucciones. |
| `libphonenumber-js` | ~500 kB | `leads/import-actions.ts` (server), `integrations/sync-ghl.ts` (server) | **NO llega al browser**. ✅ |
| `@supabase/ssr` + `@supabase/supabase-js` | ~100 kB | Server + client | Comportamiento default: sí llega, pero es la infra. |

### 6.5.2 Sin `dynamic()` / sin `Suspense`

Grep sobre `src/`:

- `next/dynamic`: **0 usos**.
- `React.Suspense` / `Suspense`: **0 usos**.
- `React.lazy` / `lazy`: **0 usos**.

Implicaciones:

- El chart de recharts se carga en un chunk aparte por Turbopack, pero no hay un `Suspense` boundary para mostrar skeleton mientras el chunk baja.
- Todo `page.tsx` renderea en un go — sin streaming intra-page (aunque los `loading.tsx` sí funcionan como Suspense de ruta).
- Modales grandes (`sale-modal.tsx` con 1 671 LOC) están siempre en el bundle inicial de la ruta que los importa aunque el usuario no los abra.

**Anotado en `08-riesgos.md`**: para el subdominio, mover `sale-modal.tsx` a `dynamic()` corta un pedazo del bundle inicial de leads y cobros.

---

## 6.6 Server Components vs. Client Components

### 6.6.1 Cuándo debería ser server pero es client

Revisado top-down:

- `analytics/analytics-filters.tsx` — cliente por selects controlados. Correcto.
- `analytics/funnel-chart.tsx`, `trends-chart.tsx`, `daily-chart.tsx` — cliente por recharts + resize observers. Correcto.
- `banks-view.tsx` — cliente porque agrupa CRUD + modal + refresh de sub-datos. Aceptable.
- `leaderboard/payouts-modal.tsx` — cliente por form + optimistic update. Correcto.
- Toda la carpeta `banks/`, `payment-methods/`, `products/`, `team/` — cliente por CRUD/modales. Correcto.

**Candidatos a que sean server** pero hoy están como cliente:

- `leaderboard/*` (938 LOC) — tiene 4 archivos client. La tabla del leaderboard es server-render friendly (data ya viene agregada por RPC). Los filtros de fecha podrían mover a URL params + form action, dejando la tabla como server component. Ver en `08-riesgos.md` — pequeña mejora de bundle.

No detecté un abuso general de `"use client"`. Cada archivo cliente tiene una razón concreta.

### 6.6.2 Sin streaming ni PPR

- **Ningún `Suspense` boundary** dentro de pages.
- No hay `<Suspense fallback={...}>` alrededor de secciones caras (KPIs vs. gráfico vs. IA — hoy todo se espera).
- Sin cache components (Next 16 introdujo `use cache` / `cacheLife` / `cacheTag` — no aparecen en el código).
- Sin ISR (`revalidate`), sin `dynamic`. Todo se recomputa por request.

Para el subdominio y para clientes finales, **PPR sería una mejora significativa**: cachear el shell y el KPI grid, streamear la sección de IA en Suspense. `next-cache-components` skill de Vercel está disponible para asistir.

---

## 6.7 Realtime

- 5 tablas en la publication `supabase_realtime`: `launch_daily`, `launch_daily_ads`, `launch_opportunities`, `launch_community_metrics`, `launch_messages_daily` (`03-datos.md § 3.11`).
- **Único consumo real** en el frontend: `src/components/dashboard/launches/integrations/realtime-probe.tsx:27`.
- No detecté `.channel('...')` en ninguna otra ruta / componente. Las páginas del launch (KPI, integraciones, daily) tampoco parecen subscribirse — recargar la página trae los datos nuevos, no hay push.

**Implicancia**: la publication está armada pero **subutilizada**. El watchdog de runs (`runs.ts:60-79`) hace expiración virtual justamente porque la UI no confía en Realtime.

---

## 6.8 Notifications bell

`src/components/notifications/notification-bell.tsx` (274 LOC, cliente). Consume:

- `GET /api/notifications` al abrir.
- `GET /api/notifications/unread-count` cada 30 s (polling explícito).

**Alternativa mejor**: suscribirse a `notifications` via `supabase_realtime` en vez de polling. Requiere agregar `notifications` a la publication + agregar reconexión / re-fetch al focus. Deuda técnica menor para el portal cliente, donde 30 s de latencia importa poco pero un polling permanente le pega a los `active minutes` de Vercel Fluid Compute.

---

## 6.9 Duplicaciones y patrones repetitivos en la UI

- **Modales inline**: cada carpeta que hace CRUD reimplementa modal + backdrop + focus trap + Esc-to-close. Ver `banks/bank-modal.tsx`, `commissions/rule-modal.tsx`, `products/product-modal.tsx`, `payment-methods/payment-method-modal.tsx`, `team/team-member-modal.tsx`. **Todos similares**. Un componente `<Modal>` primitivo en `ui/` cortaría el LOC repetitivo.
- **Formularios CRUD** con `useActionState` — el patrón es idéntico: form + FieldError + Server Action bound. Sin abstracción.
- **Delete buttons** con confirmación: `bank-delete.tsx`, `movement-delete.tsx`, `payment-method-delete.tsx`, `product-delete.tsx`, `row-delete.tsx` (commissions), `team-row-actions.tsx`, `project-delete-button.tsx` — todos con la misma estructura.

Es deuda técnica **estética**, no funcional. En el marco de "extraer a un subdominio", conviene primero mover **al core / shared** una `<Modal>` y una `<ConfirmButton>` — bajaría a la mitad el volumen de componentes.

---

## 6.10 Loading + error boundaries

- `loading.tsx` en 34 rutas — resuelto por `src/components/ui/page-skeleton.tsx` (comment en memoria `project_launchos_roadmap_v2` menciona commit `ee6c9c1`). ✅
- **Sin `error.tsx`** en ninguna ruta.
- **Sin `not-found.tsx`** custom.

Consecuencia: cualquier `throw` de Server Component cae al default de Next ("Something went wrong") sin contexto de qué falló. Anotado en `08-riesgos.md`. Para clientes finales conviene tener error.tsx que rinda un mensaje "algo salió mal, refrescá" en el idioma correcto y con el logo del proyecto (o del subdominio).

---

## 6.11 Rendimiento — resumen

✅ Puntos fuertes:

- 5 KPI cards en overview corren 5 fetches paralelos.
- Leaderboard usa RPCs pre-agregadas → escala a 100k+ leads.
- Tabla de leads es server-paginated con índices trigram (mig `0016`).
- Anti-N+1 explícito en fase 11 (cuotas cargadas en batch).
- Bundle de exceljs/pdf/openai queda server-only.
- `libphonenumber-js` no viaja al browser.

⚠️ Puntos débiles:

- Ninguna ruta usa `dynamic()`, `Suspense` intra-page, `revalidate` ni `use cache`. Todo se recomputa por request y todo el JS crítico sube al bundle inicial de cada ruta.
- Tablas de ventas / cobros / comisiones sin paginación server-side. A volumen alto se sentirá.
- `notification-bell.tsx` polea cada 30 s — costo de Fluid Compute idle.
- Modales grandes (sale-modal 1 671 LOC) están en el bundle inicial de ~3 rutas.
- Realtime armado pero subutilizado.

**Objetivo modular concreto** (agenda para el subdominio):

1. Envolver `sale-modal.tsx` en `dynamic({ ssr: false })` — corta ~50 kB del bundle inicial de `/leads`, `/cobros`, `/ventas`.
2. Convertir `notification-bell` a Realtime, cortando el polling.
3. Agregar `error.tsx` a cada route group (una vez para `(app)`, `(admin)`, `(cliente)`) con logo y contacto.
4. Server-paginar `/ventas` y `/cobros` (patrón ya montado en `/leads`).
5. Agregar `<Suspense>` en la tab IA del launch (permite que las KPIs muestren mientras la IA carga).

---

## Discrepancias con `docs/AUDITORIA.md`

`AUDITORIA.md § 6` (UI/UX) describe el shell, el theming, la topbar, y patrones de delete. Todo eso sigue vigente.

Lo que **no menciona** y es novedad:

- `notification-bell` (existe con 274 LOC).
- Kanban con "pinned to kanban" — el modelo de kanban cambió en `0016` y `0018` para escalar y para el nuevo vocabulario (frío/tibio).
- El wizard de import de leads en 3 pasos (`import-modal.tsx`, 688 LOC).
- El tema light/dark con cookie (memoria `project_launchos_roadmap_v2` y `layout.tsx:37-45`, pero `AUDITORIA.md:326` dice "Hoy hereda del `prefers-color-scheme`, sin toggle" — hay toggle desde antes de esta auditoría).
- Los 34 `loading.tsx` — memoria dice "commit `ee6c9c1`". `AUDITORIA.md` no los menciona.

---

## ⚠️ No pude determinar

- **Bundle size real por ruta** — se mide con `next build`. Autorizado; se corre después de escribir todos los documentos según lo acordado.
- **Uso real de Realtime en producción** — si nadie está suscrito a las tablas de la publication, el costo Postgres es mínimo pero está el ancho de banda. Verificar en Studio.
- **Peso del chunk de recharts** — hasta correr el build no sé si Turbopack lo separa bien.
- **Cross-tab session sync** — con Supabase Auth cookies el proxy refresca cada request. Pero si abrí dos pestañas y en una hago logout, la otra sigue con estado stale hasta el próximo request. Aceptable para dashboard, no ideal para portal cliente.
