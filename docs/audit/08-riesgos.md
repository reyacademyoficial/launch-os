# 08 · Riesgos, deuda técnica y estado real de las fases

Consolida todo lo que quedó marcado en los pasos 1–7 más el análisis de qué hay que hacer antes de exponer LaunchOS como subdominio y a clientes finales.

---

## 8.1 Deuda técnica priorizada

Ordeno por **impacto en la migración** (alto = bloqueante, medio = ruidoso, bajo = cosmético). Cada ítem con la ubicación exacta.

| # | Item | Ubicación | Impacto | Esfuerzo | Nota |
| ---: | --- | --- | :---: | :---: | --- |
| 1 | Cookie de sesión sin `domain` — impide SSO cross-subdominio | `src/lib/supabase/middleware.ts:47,81`, `src/lib/supabase/server.ts:26`, `src/lib/theme-cookie.ts` | Alto | Bajo (~4 líneas + env) | Nueva env `NEXT_PUBLIC_COOKIE_DOMAIN=.growins.com`. Ver `07-modularizacion.md § 7.5.2`. |
| 2 | `redirect("/")` como "home del sistema" — asume LaunchOS es la app raíz | `07-modularizacion.md § 7.5.1` (6+ ocurrencias) | Alto para microfrontend / basePath. Bajo para subdominio dedicado. | Bajo si sólo subdominio; medio si microfrontend | Introducir `PLATFORM_HOME_URL` en env y helper. |
| 3 | `/dev/auditoria/page.tsx` — sólo `requireSessionProfile`, no `requireRole('dev')` que se ve en el guard del layout | `src/app/(app)/dev/auditoria/page.tsx:67` | Potencialmente Alto (fuga del audit del sistema entero) | Bajo | **Verificar dentro de las 375 LOC del page si filtra por rol al armar la query o al renderear.** Si no filtra, cualquier `authenticated` lo lee. |
| 4 | `sale-modal.tsx` 1 671 LOC en un solo componente | `src/components/dashboard/sales/sale-modal.tsx` | Medio (bundle + mantenibilidad) | Medio | Split por sub-formularios + `dynamic()` para lazy. Ver `06-frontend-performance.md § 6.11`. |
| 5 | Duplicación fórmula cuotas JS↔SQL | `src/lib/installments/schedule.ts:10-14`, `generate_installments_for_sale` (mig 0043) | Medio | Bajo — test de contrato JS↔SQL | Un solo test que arme un caso y compare. |
| 6 | Constante `STALE_RUN_THRESHOLD_MS = 15min` duplicada | `src/lib/integrations/runs.ts:8`, RPC `expire_stale_integration_runs` (mig 0019) | Bajo | Bajo | Pasar el threshold desde JS explícitamente en la RPC call — ya se hace (`runs.ts:39`). Consolidar como fuente única el JS. |
| 7 | `aggregateLeaderboard` JS: bucket de ranking usa `sale.team_member_id`, atribución usa `lead.team_member_id` | `src/lib/leaderboard/aggregate.ts:266,278-280`, `src/lib/commissions/ranking.ts:28` | Medio | Bajo | La RPC 0047 ya usa `lead.team_member_id` para ambas cosas. El JS legacy debería reflejarlo. |
| 8 | `NEXT_PUBLIC_APP_URL` declarada pero no usada | `.env.example:15-16` | Bajo | Muy bajo | Sacarla del `.env.example` o cablearla. |
| 9 | Sin `engines` pin en `package.json` — drift Node local↔prod | `package.json:1-42` | Bajo | Muy bajo | Agregar `"engines": {"node": ">=20"}` o `.nvmrc`. |
| 10 | `docs/AUDITORIA.md` desactualizado 6 meses | `docs/AUDITORIA.md` (464 LOC) | Bajo (documental) | Bajo | Ver `## Discrepancias` en cada uno de los pasos 1–7. |
| 11 | Ningún `error.tsx` / `not-found.tsx` custom | `src/app/**` | Bajo (UX) | Bajo | Agregar uno por route group. |
| 12 | Ningún `dynamic()`, `Suspense`, `revalidate`, `use cache` en toda la app | `src/app/**` | Bajo hoy, medio a escala | Medio | PPR + Cache Components — `vercel:next-cache-components` skill puede ayudar. |
| 13 | Tablas de ventas/cobros/comisiones sin paginación server-side | `src/app/(app)/proyectos/[projectId]/{ventas,cobros,comisiones}/page.tsx` | Bajo hoy, medio con 5 000+ ventas | Medio | Patrón de `leads` ya montado. |
| 14 | Modales inline reimplementados en cada CRUD | 6+ archivos `*-modal.tsx` en `banks/`, `commissions/`, `products/`, `payment-methods/`, `team/` | Bajo (LOC) | Medio | Extraer `<Modal>` a `ui/`. |
| 15 | `sync-actions.ts` (506 LOC) mezcla orquestación de sync con Server Action HTTP | `src/app/(app)/proyectos/[projectId]/launches/[launchId]/sync-actions.ts` | Bajo | Medio | Split adapters vs. orchestrator (parte de refactor de `integrations/`, ver `07-modularizacion.md § 7.2.6`). |
| 16 | `notification-bell` polea `/api/notifications/unread-count` cada 30 s | `src/components/notifications/notification-bell.tsx` | Bajo (costo Fluid Compute) | Medio | Migrar a Supabase Realtime — agregar `notifications` a la publication. |
| 17 | Realtime armado en 5 tablas pero **subutilizado**: sólo `realtime-probe.tsx:27` lo consume | `src/lib/supabase/*`, tablas `launch_daily`, `launch_daily_ads`, `launch_opportunities`, `launch_community_metrics`, `launch_messages_daily` | Bajo | Medio | O usar o desactivar. Habilitación cuesta bytes/mes en Supabase. |
| 18 | Muchas tablas: `sales.team_member_id` denorm que **puede driftear** con `lead.team_member_id` | mig 0014 + 0047 patch | Medio | Alto (backfill periódico o dropear la columna) | Se abre la posibilidad de dropear `sales.team_member_id` — todos los lectores debieran migrar a `lead.team_member_id` como en la RPC 0047. |
| 19 | Carpetas vacías: `src/components/charts/` (`.gitkeep`), `src/hooks/` (`.gitkeep`), `src/types/` | `src/components/charts/`, `src/hooks/`, `src/types/` | Bajo | Muy bajo | Borrar si no se van a usar. |
| 20 | `docs/legacy/` (~1 900 LOC prototipo Vite) sigue en repo | `docs/legacy/App.jsx` etc. | Bajo | Muy bajo | Referencia útil por si hay que replicar algún cálculo, pero está fuera de tsconfig y eslint. Se puede mover a un repo separado. |

---

## 8.2 Riesgos de seguridad (foco cliente final)

Priorizado por **qué podría filtrarse hoy** si el hook de Supabase no está aplicado o si la RLS falla.

### 8.2.1 🔴 Crítico

- **`custom_access_token_hook` no verificado en Studio remoto** (`03-datos.md § 3.8.5`). Sin el hook activo, un `profile.role='cliente'` entra como `authenticated` en PostgREST. Los grants abiertos a `authenticated` incluyen `commission_rules`, `team_members`, `payment_modalities`, `integration_runs`, etc. — la RLS es la única barrera restante, y `has_project_access` devuelve true para el proyecto del cliente. **Efecto**: un cliente podría hacer `select * from team_members`, `commission_rules` sobre su proyecto, aunque la UI del portal no lo muestre. **Fix**: activar el hook en la consola Supabase (`0023_cliente_role_frontier.sql:23-26`). Correr el bloque de queries de `03-datos.md § 3.12.5` para verificar.
- **Clave real de OpenAI expuesta a mi contexto durante la auditoría** (ver `04-integraciones.md § 4.9`). No hay evidencia de que la key esté en git ni haya salido a un servicio de terceros. Rotala como precaución antes del próximo despliegue.

### 8.2.2 🟠 Alto

- **`/dev/auditoria` sin `requireRole` verificable** en el código snapshot leído. Ver deuda #3. Si el `page.tsx:67` sólo hace `requireSessionProfile` sin filtrar la query por rol dev/superadmin, se filtra el audit del sistema entero.
- **`sales.total_amount` y `payments.amount` visibles al `cliente_role`** (`03-datos.md § 3.8.4`). Si el negocio quiere ocultar revenue al cliente final, la frontera actual no cubre. Cambio necesario: nuevo rol o column-level revoke sobre esos campos.
- **`SESSION_TRACK_COOKIE` inserta filas en `auth_events`** al primer request no-cookie. Escritura vía `authenticated` (`middleware.ts:64-80`). Sin RLS restrictiva en `auth_events` (sólo `is_dev()` lee, pero el INSERT lo hace `authenticated`) — verificar que el INSERT no exponga metadata cross-tenant. Bajo pero notable.

### 8.2.3 🟡 Medio

- **Ausencia de rate-limit en Server Actions**. Un `authenticated` con acceso al proyecto podría spamear `syncMeta` o `syncGhl` porque no hay throttle. `maxDuration=300` limita cada llamada pero no la frecuencia. Costo Fluid Compute + posible rate-limit del provider externo.
- **Sin CSP header**. `next.config.ts:1-7` no declara `headers()`. El `<script>` inline de theme (probablemente ausente) o el bundle propio no están restringidos. Bajo riesgo XSS dado que React escapa todo, pero es buena práctica.
- **`launch_secrets` con `SELECT` grant a `authenticated`** (mig `0012:48`) — la policy es la que filtra (cero rows). Si accidentalmente aparece una policy `select` con `using (true)`, todos los tokens quedan visibles. La convención "cero policies" no está enforceada por nada más que humano. Un test pgTAP que asserte "cero policies en `project_secrets` y `launch_secrets`" cerraría el gate.

### 8.2.4 🟢 Bajo

- **`(auth)/set-password/page.tsx` acepta cualquier sesión** para setear password. Bajo pero raro. Anotado en `02-rutas.md § 2.2.1`.
- **`(app)/dev/auditoria` `dynamic="force-dynamic"`** — correcto, no cacheable. ✅
- **Todos los PDFs y exports xlsx** requieren `requireCanEditX` — cliente final no tiene endpoint de PDF de comisiones (frontera de contenido explícita en `02-rutas.md § 2.4`).

### 8.2.5 Test pgTAP existente

`supabase/tests/rls_smoke_test.sql` (1 353 LOC). Cubre RLS end-to-end. **Ejecutar** desde Studio "Run without RLS OFF" antes de exponer clientes. Instrucciones en memoria `feedback_studio_smoke_tests`.

---

## 8.3 Estado real de las fases (por evidencia en código)

Basado en migraciones aplicadas y componentes UI existentes. **No** en documentación previa. Comparo con lo que documenta la memoria `project_launchos_roadmap_v2`.

Convención: ✅ completa, ⚠️ parcial, ❌ no existe.

| Fase | Descripción declarada | Estado | Evidencia | Nota |
| :---: | --- | :---: | --- | --- |
| 1 | Base app + auth + proyectos + launches CRUD | ✅ | Migraciones 0001–0006, todo el árbol `(app)/proyectos/[id]/launches` | Sin cambios respecto al roadmap. |
| 2 | Integraciones per-launch (Meta stub → Meta real Fase 3a) | ✅ | Mig 0012, adapters `meta.ts`+`sync.ts`, page integraciones. | El "stub" ya no existe (mig 0012+adapters). |
| 2b | Calendario de fases | ✅ | Mig 0011+0037, `src/lib/launches/calendar.ts` (200 LOC), tab calendario. | Incluye creación + nutrición (0037). |
| 3a | Meta Ads sync | ✅ | Mig 0012, `meta.ts` (998), `sync.ts` (1 749), Fase C leads (`sync.ts:1362-1524`). | Producción manual — funciona. |
| 3b | GHL sync (contacts, appointments, tibios) | ✅ | Mig 0017, 0018, 0020, 0021, 0022. `ghl.ts` (1 881), `sync-ghl.ts` (1 341), `ghl-match.ts` (279). | Tabla dropea `stage` fine-grained a `all` (`runs.ts:70-79`). |
| 3b (Fase B) | Mensajes WhatsApp/SMS daily por launch | ⚠️ | Mig 0035, tabla `launch_messages_daily`. Adapter en `ghl.ts` (funciones `fetchGhlMessagesDaily`). **Botón + cron no confirmado en UI**. | Sin cron. Verificar botón. |
| 3c | Cron / scheduling automático | ❌ | Cero `vercel.json`, cero `/api/cron/*`, cero `pg_cron` en migraciones. Watchdog es on-demand (`sync.ts:150+`, `runs.ts:31-46`). | Roadmap dice "no empezada" — confirmado. |
| 4 | CRM leads + equipo + pipeline | ✅ | Migs 0013 (equipo+leads), 0016 (leads at scale + trigram), 0018 (kanban vocab). Componentes leads/kanban. | |
| 4b | Ventas + cobros + comisiones | ✅ | Migs 0014 (sales, payments, modalities, rules), 0030 (payouts). | v1 completa. |
| 4c | Payouts al equipo | ✅ | Mig 0030, componente `leaderboard/payouts-modal.tsx` (349 LOC). | |
| 4d | Comisiones escalonadas (tiers + accrual) | ✅ | Migs 0031, 0032, 0039, 0040, 0042 (`on_close`). | 4 accrual modes vigentes. |
| 5 | Analítica / dashboards agregados | ✅ | `analitica/page.tsx`, `src/lib/analytics/*`, componentes `analytics/*`, `funnel-chart.tsx`, `trends-chart.tsx`. | |
| 6 | Portal cliente + frontera DB | ⚠️ | Mig 0023 (`cliente_role`+ hook + grants). Rutas `(cliente)/portal/*` (19 archivos, 1 154 LOC). API `/api/portal/*`. | **Frontera correcta en migraciones**. Falta activar el hook y validar en el remoto (§ 8.2.1). |
| 7 | Notificaciones + alertas | ✅ | Migs 0024 (notifications), 0025 (alert_rules), 0026, 0027 (triggers). Componente `notification-bell.tsx` + rutas `alertas/`. | Emisor de alertas evalúa fire-and-forget en `sync.ts`. |
| 8 | Multi-venta por lead | ✅ | Mig 0041, commit `acff138`. `buildSaleRanks` bucket por `sale.launch_id`. | ⚠️ ver **§ 8.4** (fase que memoria no listaba y hoy es fundamental). |
| 9 | Revenue split (estimated + collected manuales + kanban) | ✅ | Mig 0033. `kpis.ts` con `revenueEstimated` / `revenueCollected`. | |
| 10 | Rol `dev` + `audit_log` | ✅ | Mig 0034. `is_dev()`, `record_audit()`, `promote_to_dev()`. Página `/dev/auditoria` (375 LOC). | Ver riesgo 8.2.2 sobre guard. |
| 11 | Cuotas + métodos de pago + bancos | ✅ | Migs 0043, 0044. Componentes bank-view, sale-modal (installment plan). RPC `generate_installments_for_sale`. | Ver deuda #5. |
| 12 | Perf leaderboard (denorm + RPCs + fuente autoritativa) | ✅ | Migs 0045, 0046, 0047. Tabla `payments.project_id` denorm + trigger. RPCs leaderboard. | Ver deuda #7. |

Fases del roadmap que **no aparecen** (por si el usuario esperaba algo más):
- Ninguna "Fase 3c cron" activa. Todo lo que se pretendía agendar (watchdog, `purge_audit_old`, sync GHL/Meta cron) sigue on-demand.

---

## 8.4 Features en el código NO listadas en el roadmap

El usuario pidió esto explícitamente. Enumero features que están **en el código y no aparecen en la memoria `project_launchos_roadmap_v2`**.

| Feature | Evidencia en código | Comentario |
| --- | --- | --- |
| **Products (catálogo)** | Mig 0038, `src/lib/products/*`, `src/components/dashboard/products/*`, route `/productos`. `sales.product_id NOT NULL` con backfill "Sin categoría". Commits `bef1892` "product-specific overrides" + `f871d97` + `38f755c`. | Fase que la memoria no llamaba; ahora es dominio central (agregación por producto en leaderboard). |
| **Payment methods** | Mig 0043, `src/lib/payment-methods/*`, ruta `/metodos-pago`. | Distinto de `payment_modalities` — el método es "por dónde entró la plata", la modalidad es la regla de comisión. |
| **Banks + bank_movements** | Mig 0044, `src/lib/banks/*`, `src/components/dashboard/banks/*` (7 archivos, 891 LOC), ruta `/bancos`. Commit `231dde4` "bank management". | Fase 12. Fusión con cash-in/out manual (movements). |
| **Bulk recalculation modal de comisiones** | Commit `ccc3ca2`, `src/components/dashboard/commissions/recalculate-bulk-modal.tsx`. | Regenera snapshots (o los preserva). Ver `05-negocio.md § 5.3.8`. |
| **`on_close` accrual mode** | Commit `9ecfe61`, mig 0042. | Modo agregado — comisión al cerrar sin depender de cobros. |
| **Ranking (rename Leaderboard→Ranking en UI)** | Commit `b0136f1`. | Sólo terminología UI; la tabla/RPCs siguen llamándose `leaderboard`. |
| **Assign lead owner desde SalePanel** | Commit `ad9d8c5`. Función `assignLeadOwner` (referenciada en `leads/page.tsx:168`). | Cierra el loop de atribución `lead.team_member_id` como fuente de verdad. |
| **Project-wide sales + cobros pages** | Rutas `/ventas`, `/cobros`. Componente `project-sales-view.tsx` (819 LOC). Commits `434504a`, `b9cb2e7`. | Antes sólo había cobros por launch. |
| **Executive PDF + Commissions PDF** | `src/lib/reports/executive-launch-pdf.tsx` (624 LOC), `commissions-launch-pdf.tsx` (521 LOC). Endpoints en `/api/proyectos/…/report/*`. | @react-pdf/renderer SSR streaming. |
| **`Ranking` alias + configuraciones administración+finanzas en sidebar** | Commit `98f17f4`. Sidebar hoy tiene sección "Administración y Finanzas". | Preparación para el paso a plataforma grande. |
| **Loading skeletons por página** | 34 `loading.tsx`, `src/components/ui/page-skeleton.tsx` (5 069 bytes). Commit `ee6c9c1`. | UX no listada como fase. |
| **Recalcular ventas / bulk actions leads** | `bulk-actions.ts` (bulk assign setter, bulk status update, promote/unpromote kanban). | Escalado de operación en volumen. |
| **Recycled_from_launch_id (evergreen)** | Mig 0028, `recycle_evergreen_leads()` RPC. | Reciclado de leads no-comprados al cerrar un evergreen. |
| **Launch calendar creación+nutrición** | Mig 0037 (sumó `dur_creacion`, `dur_nutricion`). | Fase 2b extendida. |
| **Alertas por umbral** | Fase 7b (`0025`), evaluador en `alerts/*`. | Listada como Fase 7 en general. |
| **Realtime en 5 tablas** | Publications en `0012`, `0022`, `0029`, `0035`. | Habilitado pero subutilizado (`06-frontend-performance.md § 6.7`). |

Como el usuario intuyó al ver Fase 8 y Fase 11 → **hay bastante más que apareció y no está en el roadmap**. La memoria `project_launchos_roadmap_v2` está desactualizada tanto o más que `docs/AUDITORIA.md`.

---

## 8.5 Código muerto y features a medio hacer

**Sin código realmente muerto**. La ausencia de `TODO / FIXME / HACK / XXX` en `src/` (grep sobre 40+ archivos y sólo aparece la palabra española "TODOS") es indicador fuerte de que lo que no está terminado se documenta en el header de la migración o en un comentario multipárrafo. Estilo consistente con `feedback_studio_smoke_tests` y con la convención "código limpio, decisiones documentadas".

- Función `insert_lead_from_provider` **anunciada como gancho documentado** en `0013_team_and_leads.sql:147-162` — **no cablée**. Diseñada para que el sync GHL/Meta la use pero hoy los adapters escriben directo. Anotado ahí como decisión, no como olvido.
- Tabla `launch_opportunities` sigue **poblada por el sync GHL** pero `kpis.ts` **no la lee más** (Fase 9 decisión 2.a). Bug: se está gastando I/O sin consumir. Decisión de producto: dropear la tabla o el sync? Anotado como pregunta.
- `launch_calendar` (mig `0011` header) menciona que "las etapas intermedias se derivan en TS al render, no se persisten". Eso sigue vigente. No hay tabla `launch_calendar` en el schema.
- `send/proyectos/integraciones` — hay una nota vieja en `INTEGRATIONS_META.md:56-65` sobre que la página de `proyecto/[id]/integraciones` "se vuelve inerte" a partir de `0012`. Verificado: **no existe** en el árbol de rutas.

---

## 8.6 Infraestructura y límites operativos

### 8.6.1 Vercel plan Hobby

- Deploy: se asume Vercel (no hay `vercel.json` ni scripts custom).
- **Node 24 LTS default** (system reminder de Vercel al inicio de la sesión). No hay pin en el repo — `08.1 deuda #9`.
- **Fluid Compute default** — reuso de instancias, cold starts mitigados. `maxDuration = 300 s` (default en Fluid Compute nuevo). Un solo override en el código: `launches/[launchId]/integraciones/page.tsx:15`.
- **Cron jobs**: plan Hobby permite 2 crons; hoy usamos **0**. Cuando se active `3c`, hay tres candidatos: `purge_audit_old`, `expire_stale_integration_runs`, `sync GHL/Meta`. Si necesitamos > 2, o subir a plan Pro o consolidar en un endpoint que dispatchea a los 3.
- **Función tamaño**: el bundle server-side de Next 16 con `@react-pdf/renderer` + `exceljs` puede quedar chunky en algunos endpoints. `next build` (final del audit) lo va a mostrar.
- **Realtime**: 5 tablas publicadas. Costo Supabase Free tier razonable si nadie está suscrito. Ver `06-frontend-performance.md § 6.7`.

### 8.6.2 Supabase Free / Pro

- Postgres 17 (`supabase/config.toml:42`).
- Backups automáticos: no confirmado en el repo — depende del plan (`AUDITORIA.md:329` sigue vigente).
- **`audit_log` crece sin límite hasta que se agende `purge_audit_old`**. Con `record_audit` attach a todas las tablas tenant (`0034:250`), volumen puede ser alto en un cliente activo.
- **Hook `custom_access_token_hook` es acción manual** post-`0023`. Ver riesgo 8.2.1.
- **Realtime publications** en 5 tablas — bandwidth cargo si Realtime está enabled.

### 8.6.3 OpenAI

- Modelo `gpt-4o-mini` (`src/lib/ai/client.ts:13`). Bajo costo pero prompt bastante extenso (KPIs completos alimentados).
- Sin fallback a otro provider. Si OpenAI cae, la IA queda muerta hasta rotar a Anthropic o Gateway.
- Migrar a Vercel AI Gateway (system reminder de Vercel) daría: unified API, model fallback, observabilidad, image gen. Un archivo (`ai/client.ts`) — cambio de bajo riesgo.

---

## 8.7 Documentación desactualizada

- **`docs/AUDITORIA.md`** (464 LOC, 2026-06-06). Fase 2 congelada. Ya cubierta en cada paso 1–7 bajo "Discrepancias".
- **`docs/INTEGRATIONS_META.md`** (67 LOC). Habla de fase 3c pendiente. Correcto en la posición, pero adapters de meta describen fase 3a completa que el doc no refleja.
- **`docs/INTEGRATIONS_GHL.md`** (124 LOC). Correcta en decisiones (tag cliente → cerrado, tibio por inbound) — describe el path que el código hace hoy. Documentación al día con excepciones menores.
- **Memoria `project_launchos_roadmap_v2`**: fases 1, 2, 2b, 3a, 3b, 4, 5 cerradas → correcto. 3c → correcto (no empezada). **6/7/8 no empezadas** → **incorrecto**: 6 arrancada, 7 completa, 8 completa. Fase 9, 10, 11, 12 no estaban listadas. **Actualizarla es acción del usuario**.

---

## 8.8 Bundle size — resultado de `next build`

Ejecutado el 2026-07-23 al final de la auditoría, en `main@b0136f1`. Comando: `npx --no-install next build`.

- **Compilación**: `✓ Compiled successfully in 20.9 s` con Turbopack (Next 16.2.7).
- **TypeScript check**: `Finished TypeScript in 24.0 s` — sin errores.
- **Páginas estáticas**: `✓ Generating static pages using 11 workers (16/16) in 444 ms`. Los 16 estáticos son `_not-found` y las variantes de manifests; **el resto son 49 rutas dinámicas** (`ƒ Dynamic — server-rendered on demand`) — coherente con `06-frontend-performance.md § 6.6.2`: cero cache, cero ISR, cero `revalidate`.
- **Proxy (middleware)**: se lista en el output como componente activo.

Tamaño de `.next/static/`:

- **Total**: **2,5 MiB** (gzip/brotli-agnóstico, es lo que sirve Vercel a los clientes).
- Top 5 chunks (kB):
  - `384` – 2 chunks (probablemente React + Supabase + recharts partitions).
  - `240` – 1 chunk.
  - `224` – 1 chunk.
  - `112` – 2 chunks.
  - `108` – 1 chunk.
  - Cola larga de chunks 20–56 kB (código específico por ruta).

Sin `dynamic()` en el código, el chunker de Turbopack sigue partiendo por route boundary — cada `page.tsx` cliente se lleva su propio chunk. **Envolver `sale-modal.tsx` (`src/components/dashboard/sales/sale-modal.tsx`) en `dynamic({ ssr: false })`** cortaría un pedazo significativo del bundle inicial de `/proyectos/[id]/{leads,ventas,cobros}` — 1 671 LOC no cargados hasta abrir el modal.

**Sin warnings ni errores** en el output. El build es reproducible con `npm run build`.

---

## 8.9 Restricciones y advertencias para el subdominio

Consolidado de todo lo anterior — **acciones antes de exponer el subdominio**:

1. **Verificar hook `custom_access_token_hook`** activo en Studio remoto (`03-datos.md § 3.12.5`).
2. **Rotar `OPENAI_API_KEY`** (exposición efímera durante audit).
3. **Setear cookie domain** para SSO cross-subdomain (`07-modularizacion.md § 7.5.2`).
4. **Confirmar guard en `/dev/auditoria`** que filtra por rol dev/superadmin (leer las 375 LOC completas).
5. **Correr `supabase/tests/rls_smoke_test.sql`** en Studio ("Run without RLS OFF"). 8 aserciones pgTAP deben pasar.
6. **Ejecutar bloque de queries de verificación** de `03-datos.md § 3.12` para chequear que el schema remoto convergió con las migraciones.
7. **Agendar `purge_audit_old`** — crece sin límite.
8. **Definir política de `expire_stale_integration_runs`** — hoy es on-demand.
9. **Migrar a Node 20+ pin explícito** (`.nvmrc`).
10. **Agregar `error.tsx` con branding** en cada route group para no exponer stack traces genéricos a clientes.
11. **Considerar `dynamic()` para `sale-modal.tsx`** — impacto medible en bundle inicial.
12. **Actualizar `docs/AUDITORIA.md`** (o reemplazarlo con estos `docs/audit/00…08.md`).

---

## ⚠️ No pude determinar (residual)

- **Si `.env.local` fue commiteado alguna vez en git history**. Comando para chequear: `git log --all --full-history -- .env.local`. Si aparece cualquier commit, rotar todas las keys y usar `git filter-repo`.
- **Si el hook Supabase Access Token está activo en el remoto**. Chequear en Studio → Authentication → Hooks.
- **Estado de los backups automáticos** en Supabase (depende del plan).
- **Si algún cron pg_cron corre en el remoto** que no vino en migraciones. Query `select jobid, schedule, command from cron.job;`.
- **Guard efectivo del `/dev/auditoria`** — pendiente lectura de las 375 LOC del archivo.
- **Estado de `enable_signup`** en Supabase remoto (config local dice `true` pero eso es sólo dev — memoria dice el usuario lo apagó a mano en Studio).
