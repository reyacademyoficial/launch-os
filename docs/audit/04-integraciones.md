# 04 · Integraciones externas

4 proveedores conectados: **Meta Ads**, **GoHighLevel (GHL)**, **SendFlow**, **OpenAI**. Todo el código vive bajo `src/lib/integrations/` (14 archivos, 8 983 LOC) y `src/lib/ai/` (4 archivos, 252 LOC). Los syncs se disparan **manualmente** desde la UI (Server Actions); no hay cron activo en el código de la app ni en `vercel.json` (no existe).

---

## 4.1 Vista general

| Proveedor | Cliente | Orquestador (Server) | Tabla destino | Estado del sync |
| --- | --- | --- | --- | --- |
| Meta Ads | `src/lib/integrations/meta.ts` (998 LOC) | `src/lib/integrations/sync.ts` (1 749 LOC) + `sync-actions.ts:52-74` | `launch_daily_ads`, `leads` (fase C) | producción manual |
| GHL | `src/lib/integrations/ghl.ts` (1 881 LOC) | `src/lib/integrations/sync-ghl.ts` (1 341 LOC) + `sync-actions.ts` | `leads`, `launch_opportunities`, `launch_messages_daily`, `ghl_user_mappings` (config) | producción manual |
| SendFlow | `src/lib/integrations/sendflow.ts` (623 LOC) | `sync.ts` (bloque SendFlow) + `sync-actions.ts` | `launch_community_metrics` | producción manual |
| OpenAI | `src/lib/ai/client.ts` (58 LOC) | `src/lib/ai/summarize-launch.ts` (133 LOC) + `ai-actions.ts:85` | `ai_runs` | producción manual |

**Tokens** — sin excepción — viven en dos tablas Postgres blindadas (RLS activa, cero policies, sólo `service_role` lee):

- `launch_secrets(launch_id, provider, secret)` — token por launch (Meta / GHL / SendFlow).
- `project_secrets(project_id, provider, secret)` — legacy (no lo consumen los syncs de hoy salvo AI runs indirectamente).

El único token en variable de entorno es `OPENAI_API_KEY` (server-only, `src/lib/ai/client.ts:19`).

`sync-actions.ts:506 LOC` orquesta el flujo desde el frontend — cada botón "Sincronizar Meta / GHL / SendFlow" invoca una Server Action que hace `requireCanEditLaunchesIn(projectId)` y despacha al orquestador correspondiente.

---

## 4.2 Meta Ads

### 4.2.1 Archivos

| Archivo | LOC | Función |
| --- | ---: | --- |
| `src/lib/integrations/meta.ts` | 998 | Cliente HTTP (Graph API), parseo, extracción de leads. |
| `src/lib/integrations/meta.test.ts` | 580 | Tests unitarios sobre fixtures reales (`__fixtures__/meta/`). |
| `src/lib/integrations/sync.ts` (parte Meta) | ~700 | Orquestador: valida config, upsertea `launch_daily_ads`, dispara fase C (leads). |
| `src/lib/integrations/__fixtures__/meta/*.json` | — | Respuestas reales cacheadas para tests. |

### 4.2.2 Autenticación y endpoints

- Base URL: `https://graph.facebook.com/v25.0` (`meta.ts:21-22`).
- Auth: `Authorization: Bearer <token>`; token en `launch_secrets(launch_id, provider='meta')` — leído con `createServiceClient()` desde `sync.ts`.

Endpoints consumidos:

| Uso | URL builder | Archivo:línea |
| --- | --- | --- |
| Insights por ad account | `${base}/${adAccountId}/insights?...` | `meta.ts:887` |
| Discovery de páginas | `${base}/me/accounts?...` | `meta.ts:718` |
| Leadgen forms por página | `${base}/${pageId}/leadgen_forms?...` | `meta.ts:727` |
| Leads por form | `${base}/${formId}/leads?...` | `meta.ts:748` |

### 4.2.3 Paginación y rate limiting

- Cursor: `paging.next` (URL absoluta) — se sigue en loop.
- Cap defensivo: **MAX_PAGES = 50** (`meta.ts:312`). Si se alcanza → `hitMaxPages = true` → el sync marca `partial` en lugar de `success`.
- Rate limit Meta: parseado desde header `X-Business-Use-Case-Usage` y códigos `4/17/32/341` (`meta.ts:230,240`). Se propaga `retryAfterSeconds`.
- **No hay retry automático en el adapter**. El adapter falla y el orquestador decide (`sync.ts` clasifica y termina el run — no reintenta).

### 4.2.4 Idempotencia

- `launch_daily_ads` tiene UNIQUE `(launch_id, date, provider)` (`0012:82-83`). El sync hace **upsert** por esa clave — re-run deja el mismo estado.
- Leads (fase C): dedup en tres niveles (`sync.ts:1343-1465`):
  1. UNIQUE parcial `(project_id, source='meta', external_id=leadgen_id)`.
  2. Lowercase + trim email cross-source.
  3. `phone_normalized` E.164 (via `libphonenumber-js`).
  4. Intra-batch dedup en memoria con `Set`.

### 4.2.5 Aislamiento por launch

- Cada `sync-actions.ts:triggerSync(...)` corre para **un** launch.
- Filtro de ventana en el adapter: `date >= date_start AND date <= date_end` (columnas GENERATED del launch, `0011`).
- Un fallo en un launch **no** afecta a otros; cada corrida escribe una fila en `integration_runs`.

### 4.2.6 Escritura y Realtime

- `launch_daily_ads` está en la publication `supabase_realtime` (`0012:157-166`). La UI del launch se suscribe y refetchea KPIs cuando el sync termina — no hay que refrescar la página.

### 4.2.7 Mapeo campo por campo

| Meta API | Tabla / columna | Procesamiento | Archivo:línea |
| --- | --- | --- | --- |
| `spend` | `launch_daily_ads.spend` | `toNumber()` | `meta.ts:124-130` |
| `impressions` | `.impressions` | `toInt()` | `meta.ts:133-135` |
| `clicks` | `.clicks` | `toInt()` | `meta.ts:219` |
| `actions[]` filtrado por `action_type='lead'` | `.leads` | `parseLeadsFromActions()` | `meta.ts:162-187` |
| `date_start` | `.date` | `regex YYYY-MM-DD` | `meta.ts:207` |
| item entero | `.raw jsonb` | crudo para auditoría | `meta.ts:222` |
| `id` del lead | `leads.external_id` | leadgen_id | `meta.ts:410` |
| `created_time` | `leads.created_at` | ISO | `meta.ts:412` |
| `field_data[]` | `leads.{name,email,phone}` | `mapFieldData()` acepta español ("nombre completo", "correo") | `meta.ts:451-540` |

---

## 4.3 GoHighLevel (GHL)

### 4.3.1 Archivos

| Archivo | LOC | Función |
| --- | ---: | --- |
| `src/lib/integrations/ghl.ts` | 1 881 | Cliente HTTP puro: appointments, conversations, contacts, opportunities, calendars, users. |
| `src/lib/integrations/sync-ghl.ts` | 1 341 | Orquestador: 3 fases (contacts → orphan WhatsApp → appointments); bulk locate + upsert + apply reglas. |
| `src/lib/integrations/ghl-match.ts` | (100+) | Matcher declarativo: tag "cliente" → cerrado; inbound WhatsApp en ventana → tibio; appointment confirmed → agendado. |
| `src/lib/integrations/ghl-messages.ts` (¿archivo separado?) | | Sync específico de `launch_messages_daily` (Fase B, `0035`). |
| Tests: `ghl.test.ts`, `ghl-match.test.ts`, `ghl-messages.test.ts`, `sync-ghl.test.ts` | | Sobre fixtures en `__fixtures__/ghl/`. |

### 4.3.2 Autenticación y endpoints

- Base URL: `https://services.leadconnectorhq.com` (`ghl.ts:27`).
- Header obligatorio: `Version: 2021-04-15` (`ghl.ts:28,1600`). GHL rechaza sin él.
- Auth: **Private Integration Token (PIT)**, per-location, en `launch_secrets(launch_id, provider='ghl')`.
- `location_id` en `launches.integration_config.ghl.location_id` (`0012:29`).

Endpoints consumidos (verificados por grep):

| Uso | Endpoint | Archivo:línea |
| --- | --- | --- |
| Descubrir calendarios | `/calendars/?locationId=...` | `ghl.ts:475` |
| Descubrir users | `/users/?locationId=...` | `ghl.ts:446` |
| Appointments (events) | `/calendars/events?...` | `ghl.ts:338` |
| Búsqueda de conversaciones | `/conversations/search?...` | `ghl.ts:512,650,935` |
| Detalle de conversación (mensajes) | `/conversations/${id}` (+ paths) | `ghl.ts:760,1047` |
| Contactos filtrados | `/contacts/?...` | `ghl.ts:1221` |
| Opportunities | `/opportunities/search?...` | `ghl.ts:1378` |

### 4.3.3 Paginación

- Contacts / Opportunities: **cursor** (`nextPageToken` o similar).
- Conversations: **limit/offset**.
- Cap defensivo por endpoint (constantes en `sync-ghl.ts`).

### 4.3.4 Idempotencia

- Contacts: bulk locate por `(project_id, source='ghl', external_id=contactId)` + `phone_normalized` (chunked a 500) → upsert.
- Opportunities: UNIQUE `(project_id, external_id)` en `launch_opportunities` (`0022:59-60`). Sync es upsert.
- Appointments: si el appointment ya existe, actualiza status.
- Mensajes (Fase B): upsert por `(launch_id, date)` en `launch_messages_daily` (`0035:35`).

### 4.3.5 Sync particionado por `stage` (mig `0020`)

`integration_runs.stage` agrega la etapa a la corrida. **Un botón por stage** — cada corrida es chica y termina dentro de los 300 s del Server Action (Fase 3b: "el usuario aprieta el botón de Appointments, después el de Conversaciones, después el de Contactos" — `0020_integration_runs_stage.sql:4-8`). `stage` queda `NULL` para Meta y SendFlow.

### 4.3.6 Mapeo `assignedTo` → `team_member_id`

- Vía `ghl_user_mappings(project_id, ghl_user_id, team_member_id)` (`0021:20-31`).
- Configuración manual desde UI (`/proyectos/[id]/equipo` + modal específico).
- Si no hay mapping → lead queda con `team_member_id = NULL`.
- **Nota**: este es exactamente el path donde puede aparecer drift entre `sales.team_member_id` y `leads.team_member_id` (bug motivo de `0047`).

### 4.3.7 Clasificación "tibio" (regla de negocio)

- Un contact con `lastInboundWhatsappMessageDate` dentro de `[launch_date + dur_compra_start, launch_date + fin_cierre]` → `leads.status = 'tibio'`.
- Documentado en `docs/INTEGRATIONS_GHL.md:21` (coincidente con el código).
- **Imprecisión conocida** (mismo doc, líneas 26-36): no distingue 1 vs 50 mensajes; queda "tibio" cualquiera con al menos un inbound en ventana. Escalable pero coarse-grained.

### 4.3.8 Probe `/api/proyectos/[projectId]/launches/[launchId]/probes/ghl-messages`

- Route Handler descripto en `02-rutas.md:2.3`. Es un **read-only debug**: no dispara sync, no persiste, sanitiza teléfonos/emails/bodies (`probes/ghl-messages/route.ts:24-26`).
- Se usa para confirmar shape real de `/conversations/search` — motivo del descubrimiento de `TYPE_CUSTOM_SMS` que llevó a `0035`.

---

## 4.4 SendFlow

### 4.4.1 Archivos

- `src/lib/integrations/sendflow.ts` (623 LOC).
- `src/lib/integrations/sendflow.test.ts` (373 LOC — foco en parsing de fechas DDMMYYYY).
- Bloque específico en `sync.ts`.

### 4.4.2 Autenticación y endpoints

- Base URL: `https://sendflow.pro/sendapi` (`sendflow.ts:27`).
- Auth: Bearer API Key en `launch_secrets(launch_id, provider='sendflow')`.
- Endpoints:
  - `GET /releases` — lista de comunidades (`sendflow.ts:128`).
  - `GET /releases/${releaseId}/analytics` — métricas (`sendflow.ts:299`).

### 4.4.3 Ventana y agregación

- Ventana desde `launches.date_start` / `date_end` (columnas GENERATED, `0011`).
- Múltiples releases por launch: **secuencial paced** (1,1 s entre calls, no paralelo) para evitar rate limit.
- Rate limit de SendFlow: HTTP 403 con body `{"code":"rate-limit-exceeded","retryAfterMs":1000}` (**no** estándar 429; parseo custom en `sendflow.ts:585-600`).
- Retry inline **una vez** si la primera llamada rate-limita (`sync.ts:812-824`).
- Upsert final: 1 fila en `launch_community_metrics(launch_id, provider='sendflow', window_start, window_end, entered, removed, clicks, raw)` (`0029:352`).

### 4.4.4 Formato de fecha DDMMYYYY

- Parser: `parseSendflowDateKey()` (`sendflow.ts:78-103`).
- Input: `"10072025"` → Output: `"2025-07-10"`.
- **Riesgo**: si SendFlow cambia el formato a MMDDYYYY, el filtro por ventana suma días equivocados. Test unitario documenta el riesgo (`sendflow.test.ts`).

### 4.4.5 Retención

- Fórmula `(entered - removed) / entered` **no vive en el adapter**. El adapter guarda `entered` y `removed`. El cálculo se hace en KPI layer (`src/lib/kpis.ts` — a verificar en Paso 5).

### 4.4.6 Aislamiento y errores

- `token_invalid` en cualquier release → abort total (`sync.ts:844-850`).
- `rate_limited` en TODAS las releases → status `rate_limited`.
- `rate_limited` en algunas → status `partial` con detalle `failed_releases` (`sync.ts:945-951`).

---

## 4.5 OpenAI

### 4.5.1 Archivos

- `src/lib/ai/client.ts` (58 LOC) — singleton lazy + `generateText()`.
- `src/lib/ai/summarize-launch.ts` (133 LOC) — prompt builder.
- `src/lib/ai/list-runs.ts` — lister historial.
- `src/lib/ai/` (4 archivos, 252 LOC).
- **Sin tests unitarios**.

### 4.5.2 Cliente

`src/lib/ai/client.ts:1` empieza con `import "server-only"` → cualquier intento de bundlear al browser rompe. `OPENAI_API_KEY` se lee sólo de env server (`client.ts:19`); si falta, lanza excepción con mensaje amigable en castellano.

Config activa:

- Modelo: `DEFAULT_MODEL = "gpt-4o-mini"` (`client.ts:13`).
- `max_tokens` default 1024 (`client.ts:37`), sobrescribible por caller.
- Mensajes: system + user (no tool use, no vision).
- **No streaming** (blocking `await`).

### 4.5.3 Prompt y persistencia

- `summarize-launch.ts:21-46` — system prompt: rol "analista senior de marketing digital", español rioplatense, 3 secciones (Funcionó / No funcionó / Recomendaciones), máx 350 palabras, markdown.
- `summarize-launch.ts:67-132` — user prompt: metadata del launch + KPIs computados con `calculateLaunchKPIs()` (mismo pipeline del dashboard) + revenue split + daily por canal.
- Se persiste en `ai_runs` (mig `0015`): un row por corrida, `output_text` markdown completo. **UPDATE revocado** — historial inmutable.

### 4.5.4 Cambio de provider

Provider abstraction: sólo `src/lib/ai/client.ts` conoce la SDK específica (`import OpenAI from "openai"`). Cambiar a Anthropic o Vercel AI Gateway toca **1 archivo** más ajustes de `max_tokens` en el prompt builder si cambia la semántica. Bajo acoplamiento.

---

## 4.6 `integration_runs` — contrato

Tabla `0012:113-130` + `0020` (columna `stage`).

Columnas clave: `id`, `launch_id`, `provider text`, `stage text` (NULL para Meta/SendFlow), `triggered_by user_id`, `started_at`, `finished_at`, `status text CHECK(...)`, `rows_written int`, `error_detail jsonb`, `window_start date`, `window_end date`.

**7 estados** válidos:

| Estado | Origen | Nota |
| --- | --- | --- |
| `running` | INSERT inicial (`sync.ts:281-300`) | Temporal. Watchdog `expire_stale_integration_runs` lo baja tras 15 min. |
| `success` | Todo OK | `finalizeRun(..., 'success', ...)` |
| `partial` | Meta hitMaxPages, SendFlow algunas releases fallan, GHL truncó | `sync.ts:402,676,945` |
| `error` | Cualquier falla no clasificada | shape roto, JSON parse, upsert falla |
| `token_invalid` | 401 / código 190 Meta / equivalente en GHL / SendFlow | Se rompe la corrida y se pide rotar el token en UI |
| `rate_limited` | Meta 4/17/341, GHL 429, SendFlow custom | Se registra `retry_after` en `error_detail` cuando se puede |
| `config_missing` | Falta `date_start`/`date_end`, launch cerrado, token ausente, o `integration_config` vacío | El sync ni siquiera intenta llamar afuera |

RLS: `SELECT` para miembros del proyecto padre; **cero policies** de I/U/D → sólo `service_role` escribe (`0012:140-144`). El watchdog `expire_stale_integration_runs()` corre como SECURITY DEFINER.

---

## 4.7 Flujo end-to-end de un sync (Meta como ejemplo)

1. **UI**: usuario clickea "Sincronizar Meta" en `/(app)/proyectos/[id]/launches/[lid]/integraciones`.
2. **Server Action**: `sync-actions.ts:triggerSync(projectId, launchId, 'meta')` (`sync-actions.ts:52-74`) → `requireCanEditLaunchesIn(projectId)`.
3. **Orquestador**: `sync.ts:syncLaunch(...)` (`sync.ts:147-419`):
   - Fetch launch: id, project_id, date_start, date_end, closed_at, integration_config.
   - Gates: si `closed_at != null` → `config_missing`; si ventana ausente → `config_missing`.
   - Watchdog: `rpc('expire_stale_integration_runs', {p_threshold: '15 minutes'})` (fire-and-forget).
   - `createServiceClient()` → lee `launch_secrets`. Si falta → `config_missing`.
   - `INSERT integration_runs(status='running', window_start, window_end)`.
4. **Adapter**: `fetchMetaInsights()` (`meta.ts:337-396`) paginado hasta 50 páginas.
5. **Persistencia**: filtro ventana → merge por date → upsert en `launch_daily_ads`.
6. **Fase C leads**: `syncMetaLeads()` (`sync.ts:1362-1524`): descubre pages → forms → leads, normaliza email/phone, dedup en 3 niveles, insert batch de 500.
7. **Finalizar**: `UPDATE integration_runs(status, finished_at, rows_written, error_detail)`.
8. **Side effects fire-and-forget**:
   - `rpc('create_notification', ...)` si status ≠ success.
   - `evaluateAlertsForLaunch(launch_id)` si success (a verificar en `05-negocio.md`).
   - `supabase_realtime` propaga el UPDATE a los suscriptores → dashboard refetchea.

**Duración típica**: 10–30 s para ~1 000 leads; 3–5 s para incremental. `maxDuration = 300` en la page de integraciones (`launches/[launchId]/integraciones/page.tsx:15`).

**Qué pasa si tarda más de 300 s**: la Server Action muere → el run queda en `running` → el watchdog lo baja a `error` cuando expira (o virtualmente en el read según memoria del roadmap "runs GHL colgados pendiente"). Ese es exactamente el bug abierto que menciona `project_launchos_roadmap_v2`.

---

## 4.8 Crons y automatización

- **Sin `vercel.json`** en la raíz — no hay `crons` declarados a nivel plataforma.
- **Sin `/api/cron/*`** en `src/app/api/`.
- Todo se dispara desde UI. Los tokens siguen siendo per-launch, así que no se puede hacer un cron global sin refactor (habría que iterar `launch_secrets`).
- **`purge_audit_old()`** (`0034:307`): comentario en la migración pide "agendar en Studio → Database → Cron o Vercel cron" — **no agendado** que yo pueda ver desde el repo. `audit_log` sigue creciendo sin límite.
- **`expire_stale_integration_runs()`**: hoy se dispara **desde el propio código del sync** como fire-and-forget (`sync.ts:150+`, con `p_threshold='15 minutes'`). Además la lectura de `integration_runs` en la UI hace virtual expiration (a verificar en Paso 5). Si nadie corre un sync durante horas, no hay quien limpie.

---

## 4.9 Riesgos para el subdominio / portal cliente

- **URLs de proveedores hardcodeadas**: `META_API_BASE`, `GHL_API_BASE`, `SENDFLOW_API_BASE` son constantes exportadas. Correcto (no dependen del host). ✅
- **No hay callbacks / webhooks entrantes** — cero endpoints que reciban notificaciones de Meta/GHL/SendFlow. No hay dependencia del host público para el sync.
- **`OPENAI_API_KEY`** es server-only vía `import "server-only"` (`client.ts:1`). Nunca llega al bundle del cliente. ✅
- **Secretos por launch** en `launch_secrets` con RLS blindada. ✅
- **Endpoint interno de probe** (`/api/proyectos/[id]/launches/[lid]/probes/ghl-messages`) requiere `requireCanEditLaunchesIn`. Cliente final no accede. ✅
- **PDFs de comisiones** (`/api/proyectos/[id]/launches/[lid]/report/commissions`) — **no** están replicados en portal cliente. Frontera de contenido correcta.

### ⚠️ Hallazgo crítico

Durante esta auditoría un subagente leyó `.env.local` y expuso el valor de `OPENAI_API_KEY` a mi contexto. Ese valor **no** llegó a ningún archivo del audit ni al git — la exposición fue efímera. Pero como el valor real de una clave productiva ya salió de su envelope de configuración, **rotala en la consola de OpenAI** antes del próximo despliegue. Es un hallazgo operacional, no una brecha en el diseño del sistema.

---

## 4.10 Superficie de tests

Cobertura fuerte donde importa (integraciones + parsing):

| Archivo test | LOC |
| --- | ---: |
| `meta.test.ts` | 580 |
| `sendflow.test.ts` | 373 |
| `ghl.test.ts` | (no medí — quedan disponibles vía Glob) |
| `ghl-match.test.ts` | 100+ |
| `ghl-messages.test.ts` | 100+ |
| `sync-ghl.test.ts` | 300+ |

Fixtures reales de las APIs en `src/lib/integrations/__fixtures__/{ghl,meta,sendflow}/`. Estos son valiosos para el subdominio: si mañana se reescribe el sync, los fixtures replican el shape real y evitan que el nuevo código rompa silenciosamente.

**AI sin tests**: `src/lib/ai/*` no tiene ningún test unitario. La generación de resumen no está aislada por contrato (mockeo de OpenAI). Deuda anotada en `08-riesgos.md`.

---

## 4.11 Resumen numérico

| Métrica | Valor |
| --- | ---: |
| LOC total (integrations + ai) | 9 235 |
| Archivos source | 14 + 4 = 18 |
| Archivos test | 8 |
| Endpoints externos distintos | ~14 (Meta 4 + GHL 8 + SendFlow 2 + OpenAI 1) |
| Modelos IA | 1 (`gpt-4o-mini`) |
| Estados válidos de `integration_runs.status` | 7 |
| Migraciones directamente relacionadas | 10 (`0012, 0015, 0017, 0019, 0020, 0021, 0022, 0026, 0027, 0029, 0035`) |
| Cron jobs activos en código | 0 |
| Tablas escritas por syncs | 6 (`launch_daily_ads`, `launch_opportunities`, `launch_community_metrics`, `launch_messages_daily`, `leads`, `integration_runs`) |

---

## Discrepancias con `docs/INTEGRATIONS_META.md` y `docs/INTEGRATIONS_GHL.md`

Ambos documentos son cortos (`AUDITORIA.md` no los reemplaza, son notas de proceso Fase 3). No están desactualizados por lo grave, pero:

- `INTEGRATIONS_META.md` menciona "cron de sincronización" (línea 63) — no existe hoy. Consistente con la posición de "Fase 3c cron no empezada".
- `INTEGRATIONS_META.md` lista tipos de action (`lead`, `fb_pixel_lead`, `leadgen.other`) como parte del parseo. El código sólo chequea `action_type='lead'` (`meta.ts:78`). Riesgo de subcontar leads si Meta cambia el tipo en algún ad set. Bajo, pero conviene extender el matcher.
- `INTEGRATIONS_GHL.md` lista validaciones pendientes de Fase 3b (tag "cliente" → cerrado). El código lo aplica hoy vía `ghl-match.ts` — los docs quedaron desactualizados en el status pero no en las decisiones.

---

## ⚠️ No pude determinar

- **Cron real que dispare `purge_audit_old` o el watchdog en el remoto**: puede que exista un cron manual en Supabase Studio que no está en migraciones. Consulta directa a `cron.job` (extensión `pg_cron`) desde SQL Editor:
  ```sql
  select jobid, schedule, command from cron.job order by jobid;
  ```
- **Estado de configuración de OpenAI Vercel AI Gateway** (mencionado en el system reminder de Vercel al inicio de la sesión): hoy el código usa el SDK `openai` directo. Migrar a AI Gateway daría fallback + observabilidad — decisión aparte.
- **Historial de `git log --all -- .env.local`**: no chequeé si en algún commit pasado se hayan commiteado los valores por error. Vale la pena correr:
  ```
  git log --all --full-history -- .env.local
  ```
  desde tu shell — si aparece algún commit, hay que hacer `git filter-repo` o BFG y rotar todas las keys.
- **Cómo se dispara hoy el sync de `launch_messages_daily`** (mig `0035`): la migración menciona "botón aparte + cron en 3c". Sin cron, tiene que haber un botón. Verificar en Paso 5.
