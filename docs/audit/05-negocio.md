# 05 · Lógica de negocio y reglas críticas

Reglas que van a viajar tal cual al subdominio. Doy el archivo autoritativo y las líneas concretas para cada una. Uso 🔴 para duplicaciones front/back, ⚠️ para invariantes con posibilidad de drift, ✅ para reglas centralizadas y limpias.

---

## 5.1 KPIs del launch — `src/lib/kpis.ts`

**Archivo autoritativo único**: `src/lib/kpis.ts` (320 LOC). Función `calculateLaunchKPIs(l, opts)` en `kpis.ts:172-320`.

### 5.1.1 Helpers defensivos

- `safeNumber(v, fallback=0)` — `kpis.ts:31-34`. Coerción con `Number.isFinite`.
- `safeInt(v, fallback=0)` — `kpis.ts:36-39`. Trunc/parseInt con la misma guarda.
- `safeDiv(a, b, fallback=0)` — `kpis.ts:41-44`. `b !== 0 ? a/b : fallback`.
- `safePercent(a, b)` — `kpis.ts:46`. `safeDiv(a,b) * 100`.
- Regla implícita: **nunca dejar NaN/Infinity llegar a la UI**. Cada punto de división pasa por `safeDiv` (`kpis.ts:295,296,297,302`). Las tasas del funnel (show/close/closeC3) devuelven `null` cuando falta denominador → la UI muestra "—" (`kpis.ts:308-310`).

### 5.1.2 Fórmulas

| KPI | Cálculo | Archivo:línea |
| --- | --- | --- |
| `metaInv`, `metaLeads`, `googleInv`, `googleLeads`, `tiktokInv`, `tiktokLeads` | Si `adsAggregate.daysCovered > 0` → del agregado. Si no → columna estática de `launches.*`. **Nunca se mezclan** (`kpis.ts:15`) | `kpis.ts:219-231` |
| `totalLeads` | `metaLeads + googleLeads + tiktokLeads` | `kpis.ts:253` |
| `totalInvestment` | `metaInv + googleInv + tiktokInv` | `kpis.ts:254` |
| `cplMeta / cplGoogle / cplTiktok` | `safeDiv(inv, leads)` | `kpis.ts:295-297` |
| `roasEstimated` | `safeDiv(revenueEstimated, totalInvestment)` | `kpis.ts:272` |
| `roasReal` | `safeDiv(revenueCollected, totalInvestment)` | `kpis.ts:273` |
| `cac` | `safeDiv(totalInvestment, ventas)` | `kpis.ts:302` |
| `showRate` | `(asistentes / registrados) * 100` o `null` | `kpis.ts:308` |
| `closeRate` (renamed — es "retención hasta el pitch") | `(hastaPitch / asistentes) * 100` o `null` | `kpis.ts:309` |
| `closeRateC3` | `(ventas / hastaPitch) * 100` o `null` | `kpis.ts:310` |
| `profitEstimated` | `revenueEstimated - totalInvestment` | `kpis.ts:274` |
| `profitReal` | `revenueCollected - totalInvestment` | `kpis.ts:275` |
| `whatsappRevenueShare` | `safePercent(whatsappRevenue, revenueEstimated)` | `kpis.ts:298` |
| `retentionRate` (comunidad WhatsApp) | `((entered - removed) / entered) * 100` o `null` | `kpis.ts:263-266` |
| `enteredCommunityRate` | `(entered / totalLeads) * 100` o `null` | `kpis.ts:267-270` |

### 5.1.3 Revenue: modelo aditivo (Fase 9, dec. 3.b)

**Regla explícita** (`kpis.ts:17-25`):

- `revenueEstimated = kanban.pledgedRevenue + launches.revenue_estimated_manual`
- `revenueCollected = kanban.collectedRevenue + launches.revenue_collected_manual`
- `ventas = kanban.salesCount + launches.ventas_total`

Kanban y manual **siempre se suman**. Si no hay kanban → sólo manual. Si no hay manual → sólo kanban. GHL opportunities ya no entran (Fase 9, dec 2.a) — el sync sigue guardando filas pero `kpis.ts` no las lee.

Aliases legacy para consumidores que no migraron: `revenue` = `revenueEstimated` (`kpis.ts:105`), `roas` = `roasEstimated` (`kpis.ts:122`), `profit` = `profitEstimated` (`kpis.ts:148`). Se van cuando pase el PDF, el AI summary y la analítica.

### 5.1.4 Se recalcula por request

Función pura, sin caché. Cada render de la page del launch corre `calculateLaunchKPIs`.

**Consumidores autoritativos**:

- `src/app/(app)/proyectos/[projectId]/launches/[launchId]/kpi/page.tsx` (la página KPI del launch).
- `src/lib/reports/executive-launch-pdf.tsx` (`04-integraciones.md` § 4.6.5) — pasa el mismo shape al AI.
- `src/lib/ai/summarize-launch.ts:67-132` — usa los mismos KPIs computados.
- `src/app/api/portal/…/report/executive/route.ts` (`02-rutas.md`) — mismo pipeline.

✅ **Sin duplicación entre front y back.** Todos consumen la misma función.

---

## 5.2 Atribución (`lead.team_member_id` ↔ `sales.team_member_id`)

### 5.2.1 Fuente de verdad

`lead.team_member_id` **es la fuente autoritativa**. `sales.team_member_id` es una denormalización mantenida por Server Actions (`createSale`, `updateLead`) — puede driftear.

### 5.2.2 Path de asignación manual

1. UI: dropdown "Vendedor" en `SalePanel` / `sale-modal.tsx` / `kanban-board.tsx`.
2. Acción: `assignLeadOwner(leadId, teamMemberId)` en `src/app/(app)/proyectos/[projectId]/leads/actions.ts` (a confirmar por grep — la línea vive en la acción, no en `kpis.ts`).
3. Efectos: UPDATE `leads.team_member_id`. Denormalización a `sales.team_member_id`: la memoria y el commit reciente `ad9d8c5 feat: implement assign lead owner functionality across various components and update leaderboard logic` explicitan que **se recalcula al UPDATE del lead** para que ambos queden alineados.

### 5.2.3 "Manual siempre gana" en GHL sync

En `src/lib/integrations/ghl-match.ts:196-251`:

- Si el lead existente ya tiene un status igual o "más caliente" que el que trae el sync, `resolveContact` **no baja el status** (`ghl-match.ts:227-240`).
- **`team_member_id`** se refresca sólo si el sync trae uno explícito vía `ghl_user_mappings` (`ghl-match.ts:212-220`). Si el sync no trae valor, el asignado manual **queda intacto**.

⚠️ **Pero**: si el sync tiene un mapping activo `ghl_user_id → team_member_id` para el contacto, **sí lo pisa** (`ghl-match.ts:214-219`). Osea "manual gana" es cierto para el status, **no para el vendedor**: si el admin cambia el mapping GHL en el medio, la próxima corrida del sync sobrescribe el owner. Anotar para modularización.

### 5.2.4 Ranking para tiers de comisión

`src/lib/commissions/ranking.ts:23-44` — `buildSaleRanks(sales)`:

- **Bucket key**: `${sale.team_member_id}|${sale.launch_id}` (`ranking.ts:28`).
- Orden dentro del bucket: `closed_at` asc, tie-break `created_at` asc (`ranking.ts:36-40`).
- Nota explícita post-Fase 8 (`ranking.ts:8-11`): "Antes usábamos `lead.launch_id` — ahora cada venta tiene atribución de launch propia".

### 5.2.5 ⚠️ Drift entre `sale.team_member_id` y `lead.team_member_id`

En dos partes del código la atribución se hace por fuentes distintas:

| Consumer | Fuente para atribución | Fuente para ranking |
| --- | --- | --- |
| **RPC `leaderboard_sale_stats`** (mig `0047:34-64`) | `leads.team_member_id` (JOIN) | `leads.team_member_id` (por consistencia con atribución) |
| **JS `aggregateLeaderboard` (legacy)** en `src/lib/leaderboard/aggregate.ts:274-303` | `ownerByLead[sale.lead_id]` = `lead.team_member_id` (`aggregate.ts:278-280`) | `sale.team_member_id` via `buildSaleRanks(sales)` (`aggregate.ts:266`) |

Si `sale.team_member_id` != `lead.team_member_id` para una venta:

- La RPC (path de producción hoy) es consistente. ✅
- El aggregator JS legacy (path de tests + fallback en desarrollo) **atribuye a A, rankea como si fuera B**. 🔴 Bug latente.

El código lo reconoce parcialmente (`aggregate.ts:274-277`): "Atribución legacy … `sale.team_member_id` … puede divergir en fixtures de tests". Pero eso implica que los tests unitarios pueden pasar con drift *o* fallar cuando refactoreamos si el fixture no está alineado. Bug menor **para el subdominio**, pero visible si mañana volvemos a usar el aggregator JS en producción.

---

## 5.3 Comisiones — `src/lib/commissions/calc.ts`

### 5.3.1 Función pura, cero persistencia

`computeCommission(sale, payments, rule, saleRank)` en `calc.ts:160-174` — wrapper delgado.
`computeCommissionFromAgg(sale, agg, rule, saleRank)` en `calc.ts:183-258` — core.

Cero persistencia de la comisión. **Se deriva en cada lectura.** Cambio de regla o de tier reflejado inmediato para ventas sin snapshot.

### 5.3.2 Snapshot congelado como fuente preferida

`calc.ts:193-199`:

```ts
const effectiveRule = sale.commission_rule_snapshot
  ? ruleFromSnapshot(sale.commission_rule_snapshot)
  : rule;
```

`sales.commission_rule_snapshot jsonb` congela la regla al cierre (mig `0039`). Si el snapshot existe → gana. Sólo se cae a `findApplicableRule` para ventas legacy sin backfill.

Consecuencia:

- **Cambio de regla del admin no afecta ventas históricas** — mientras tengan snapshot.
- Ventas legacy (pre-`0039`) sin snapshot **sí** cambian de comisión al cambiar la regla.

### 5.3.3 Cascada de regla aplicable (Fase 7)

`findApplicableRule(rules, paymentModalityId, launchId, productId)` en `calc.ts:37-66`:

1. Rule con `product_id = X` y `launch_id = NULL` → override por producto.
2. Rule con `launch_id = Y` y `product_id = NULL` → override por launch.
3. Rule con ambos NULL → default del proyecto.
4. Si nada matchea → `null` → comisión 0.

Prioridad **producto > launch** por decisión de diseño (`calc.ts:29-33`): "producto gana … qué se vendió antes que el cuándo se vendió". Ambos son mutuamente excluyentes por constraint SQL.

Match por modalidad va contra `rule.modality_ids` (pivot M:N desde `commission_rule_modalities`, mig `0031`).

### 5.3.4 Los 4 `accrual_mode`

| Modo | Base para el %/fixed | Se libera cuando | Archivo:línea |
| --- | --- | --- | --- |
| `proportional` | `collected` (cobrado) | siempre (`released=true`) | `calc.ts:268` |
| `threshold_full` | `pledged` (pactado) | cruzó `threshold_type/value` | `calc.ts:275-280,291` |
| `threshold_proportional` | `collected` | cruzó threshold | `calc.ts:275-280,321` |
| `on_close` (mig `0042`) | `pledged` | siempre al cerrar (`released=true`) | `calc.ts:269,291` |

**Threshold types** (`calc.ts:275-280`):

- `payment_count`: `paymentCount >= threshold_value` (ej: "libera a la 3ra cuota").
- `paid_ratio`: `collected / pledged >= threshold_value` (ej: 0.5 = 50% cobrado).

### 5.3.5 Tiers marginales

`findTierForRank(tiers, saleRank)` en `calc.ts:107-117`. Recorre tiers ordenados por `min_count` asc; devuelve el que satisface `min_count <= rank <= max_count` (o `max_count IS NULL` = ∞).

`applyTier(tier, mode, collected, pledged)` en `calc.ts:283-302`:

- `percent`: `base * value / 100`.
- `fixed`:
  - `on_close` o `threshold_full` → `value` entero.
  - `proportional` o `threshold_proportional` → `value * min(collected/pledged, 1)` (escala fixed por porcentaje cobrado, capado a 100%).

### 5.3.6 🔴 Interacción crítica con multi-venta (Fase 8) y cuotas (Fase 11)

Esto es lo que el usuario pidió que quedara documentado. Combinaciones:

**Caso A — 1 lead, 2 launches, 2 ventas separadas**:

- Cada venta tiene su propio `sale.launch_id`, `payment_modality_id`, y `commission_rule_snapshot`.
- Bucket de ranking: `(sale.team_member_id, sale.launch_id)` — venta A rankea 0 en launch X, venta B rankea 0 en launch Y. Sin interferencia.
- Revenue por launch: cada venta suma en su launch. ✅ Consistente.

**Caso B — 1 lead, 2 ventas en el mismo launch** (opcional, permitido pos-`0041`):

- Ambas caen al mismo bucket `(team_member_id, launch_id)`.
- Rank ordenado por `closed_at` asc → la segunda venta sube al tier siguiente (si aplica).
- Revenue: se cuentan ambos `total_amount` y todos sus `payments`. Total del launch = suma.

**Caso C — venta a 12 cuotas, `proportional`, cobrado sólo 3**:

- `collected = 3 × amount_per_installment`.
- `pledged = total_amount` (12 × amount).
- `commission = collected × pct = (3/12) × total × pct`. ✅ Escala linealmente con lo cobrado.

**Caso D — venta a 12 cuotas, `threshold_full` con `payment_count = 4`**:

- Cuotas 1-3 cobradas → `paymentCount = 3 < 4` → `released = false` → comisión 0.
- Cuota 4 cobrada → `paymentCount = 4` → `released = true` → comisión = `total × pct` (¡saltó al 100% del pactado!).
- **Cuidado si el operador borra el pago 4** — la comisión salta a 0 otra vez porque es derivada.

**Caso E — venta a 12 cuotas, `threshold_proportional` con `paid_ratio = 0.25`**:

- Hasta 24.99% cobrado → comisión 0.
- 25% cobrado → comisión = `collected × pct`.
- 50% cobrado → comisión = `collected × pct` (creciendo linealmente pos-umbral).

**Caso F — venta a 12 cuotas, `on_close`**:

- Comisión al 100% del `pledged` desde el cierre. Se libera con la venta cerrada, no con cobros.
- Ideal para negocios donde la comisión no se ata a mora del cliente.

### 5.3.7 Reconciliación de revenue con multi-venta

Reformulo con los tests del usuario en mente:

- `launches.revenue_estimated_manual` (pactado manual) y `launches.revenue_collected_manual` (cobrado manual) son **siempre sumables** al kanban.
- Kanban = leads con `status='cerrado'` cuyo lead tiene `launch_id = X` (**NO** por `sale.launch_id`, ver siguiente §).
- Cada lead cerrado suma **todas sus ventas** (Σ `sale.total_amount` para pactado, Σ `payment.amount` para cobrado).

**⚠️ Contradicción entre 2 fuentes de agregación**:

`src/lib/launch-sales/aggregate.ts` (128 LOC — pendiente de leer con detalle en Paso 6/7) — el header decía que se agregaba por `lead.launch_id`. Pero pos-Fase 8, cada venta tiene `sale.launch_id` propio (mig `0041`). En un caso multi-launch por lead, ambos criterios podrían divergir: la venta pertenece al launch B, pero el lead vive en el launch A.

Esto es exactamente el punto ambiguo que el usuario pidió mapear. **Anotado como pregunta abierta al final del documento** — necesito confirmar leyendo `launch-sales/aggregate.ts` y `getKanbanSalesAggregateForLaunch` cuál criterio usa el pipeline productivo.

### 5.3.8 Bulk recalculation modal

Memoria menciona commit `ccc3ca2 add bulk recalculation modal for commission adjustments`. Componente: `src/components/dashboard/commissions/rule-form.tsx` (515 LOC). No lo leí en detalle — pendiente de confirmar la lógica (probablemente re-genera el snapshot para todas las sales que matchean la regla, o dispara `update_commission_rule` RPC).

---

## 5.4 Cuotas (`src/lib/installments/*`)

### 5.4.1 Generación

Dos caminos deben devolver el mismo resultado:

- **JS**: `buildInstallmentSchedule({total, count, frequency, startDate})` en `installments/schedule.ts:24-53`. Reparto: primeras N-1 = `round(total/N, 2)`, la última absorbe el redondeo (`schedule.ts:42-50`).
- **SQL**: `generate_installments_for_sale(sale_id)` RPC (mig `0043:169`). Se llama desde la Server Action al cerrar la venta.

Frecuencias: `single | weekly | monthly` (`schedule.ts:16-20`). `monthly` usa `setUTCMonth` que auto-ajusta 31 ene → 28/29 feb (`schedule.ts:79-82`). Coincide con `interval '1 month'` de Postgres.

🔴 **Duplicación consciente** — el JS es para **preview en vivo** en el modal de venta (no ida-vuelta al server). Contrato explícito en el comentario (`schedule.ts:10-14`): "Debe quedar sincronizado con el SQL. Mismo reparto". Si mañana cambia una regla en el SQL, hay que tocar dos archivos. Ver `08-riesgos.md`.

### 5.4.2 Estado de cuota y clasificación

`src/lib/installments/status.ts` (156 LOC — no leí, pero según el subagente):

- 4 estados por cuota: `paid`, `partial`, `overdue`, `pending`.
- Fórmula vencido: `today - (due_date + grace_days) > 0`.
- Clasificación de cliente (`status.ts:140-156` según el subagente):
  - `malo`: 3+ cuotas vencidas o `maxDaysOverdue > 15`.
  - `regular`: 1–2 vencidas.
  - `bueno`: ninguna vencida.

Uso: ficha del alumno, panel de cobros. La clasificación no dispara acciones automáticas hoy (no se usa como input a las comisiones, no marca al lead).

### 5.4.3 Regeneración

Al cambiar `installment_count` o `installment_frequency` en una venta:

- El backend re-genera las cuotas.
- **`payments.installment_id`** de todos los cobros queda **NULL** por `ON DELETE SET NULL` (mig `0043` header).
- El operador re-liga a mano desde la ficha (`sale-modal.tsx` o `cobros-view.tsx`, según memoria `project_launchos_installments_phase11`).

---

## 5.5 Leaderboard y reconciliación de revenue

### 5.5.1 Dos caminos que deben coincidir

- **Producción**: RPC `leaderboard_lead_stats` + `leaderboard_sale_stats` (mig `0046-0047`) → JS `aggregateLeaderboardFromStats` (`aggregate.ts:124-216`).
- **Test y fallback**: JS `aggregateLeaderboard` (`aggregate.ts:225-314`) — recibe raw leads+sales+payments, replica lo que hace el SQL, y delega al `aggregateLeaderboardFromStats`.

Fila del leaderboard (`aggregate.ts:34-54`):

- `teamMember` (o `null` = "Sin asignar").
- `leadsWorked`, `closed`, `conversionRate = closed / leadsWorked * 100`.
- `revenueCollected = Σ payments.amount` de las ventas del miembro.
- `commissionAccrued = Σ computeCommissionFromAgg(sale, ...)` — con snapshot cuando existe.
- `paidOut = Σ payouts.amount` del miembro filtrados por launch + fecha.
- `pending = commissionAccrued - paidOut` (**puede ser negativo** — el UI no clampea, `aggregate.ts:49-53`).

### 5.5.2 Bucket "Sin asignar"

Se agrega **solo** si hay leads o ventas sin `team_member_id` (`aggregate.ts:209-213`). Es read-only (no tiene payouts porque el `memberId` es NULL, `aggregate.ts:184-188`).

**Nota histórica** en el código (`aggregate.ts:73`): "antes del fix esos $11.62M eran invisibles" — se agregaba sólo si el `teamMember` no era NULL, escondiendo revenue de leads sin dueño.

### 5.5.3 Ranking a filtro-agnóstico

Regla firme (`aggregate.ts:76-83`): el rank de una venta se decide sobre el **universo crudo** de ventas (sin filtros de UI). Un filtro de fecha esconde ventas del resumen pero no cambia la posición histórica.

---

## 5.6 Kanban y ciclo del lanzamiento

### 5.6.1 5 estados del lead

`frio | tibio | agendado | cerrado | perdido` (mig `0018:322-325`, tipo en `src/lib/leads/types.ts`).

Reglas de transición (`ghl-match.ts:57-63` y `196-254`):

- `STATUS_ORDER = {frio:0, tibio:1, agendado:2, cerrado:3, perdido:3}`.
- **No degradar**: un status más caliente **no baja** por señal más fría (`ghl-match.ts:227-240`).
- **Terminal**: `cerrado` y `perdido` no vuelven a abrirse desde el sync (`ghl-match.ts:210-222`).
- Appointments cancelled/noshow/invalid → `noop` (`ghl-match.ts:167-172`).

### 5.6.2 Detección de tibio

`ghl-match.ts:23-27` + `resolveContact` (`ghl-match.ts:194-254`):

- Regla: existe `hasRecentInboundActivity = true` = 1+ mensaje WhatsApp inbound del contacto dentro de la ventana **compra + cierre** del launch.
- Comportamiento:
  - Sin lead → create `status='tibio'`, `pinned_to_kanban=true`.
  - Lead frío → sube a tibio + pinned.
  - Lead más caliente → no degrada.
- El matcher se ejecuta durante el sync GHL (`sync-ghl.ts:39-48` según el reporte del subagente).

### 5.6.3 Calendario de fases

`src/lib/launches/calendar.ts:106-179` — `computeLaunchCalendar(inputs)`. Función pura, cero side effects. Todo en UTC (`calendar.ts:83-91`).

Convención de conteo (crítico, replica el ejemplo del roadmap):

- Etapas previas (creación, nutrición, captación, calentamiento): **inicio = ancla − dur, fin = ancla − 1**. Rango inclusivo de exactamente `dur` días.
- Compra y cierre: **fin = inicio + dur**, exclusivo del último.
- Ancla de captación/calentamiento = `launch_date`. Ancla de creación/nutrición = `captacionStart`.
- Evergreen: **una** clase (Clase 1). Compra arranca el día de la Clase 1 (no C3). `clase2`/`clase3 = null`.

Defaults exportados (`calendar.ts:111-118`): 30/15/21/14/5/3.

`windowStart` = `captacionStart`, `windowEnd` = `cierreEnd`. Coincide con las columnas GENERATED `launches.date_start` / `date_end` (mig `0011:196-…`).

🔴 **Duplicación** consciente: la fórmula vive en JS. El SQL (mig `0011`) implementa **sólo `date_start`/`date_end`** — las etapas intermedias no se persisten. Comentario en `calendar.ts:5-7`: "El SQL replica el cálculo de `date_start`/`date_end` en columnas GENERATED". Cambio en el JS debe replicarse en `0011` (columna GENERATED expression). Nada critical si no cambian las duraciones estructurales.

### 5.6.4 Evergreen y reciclado

Migración `0028_evergreen_recycling.sql`. Al cerrar un launch evergreen:

- `recycle_evergreen_leads(p_launch_id)` mueve los leads no-comprados al `recycle_target_launch_id` (`0028:106`).
- La función es **idempotente** (`0028:423-427`): filtra `recycled_from_launch_id IS NULL`.
- `source` **no cambia** — un lead que entró por `meta` sigue con `source='meta'`, ahora en el launch destino (`0028:415-421`).
- Traza única: `recycled_from_launch_id IS NOT NULL`.

Server Action `closeLaunch` (en `src/app/(app)/proyectos/[projectId]/launches/actions.ts`) invoca la RPC — coordenada con la transición `closed_at NULL → NOW()`.

---

## 5.7 Normalización de teléfono

- Librería: `libphonenumber-js` (`package.json:22`).
- Uso en import de leads: `src/lib/leads/import.ts:7-32` (según el subagente).
- Default country: viene del launch (o del proyecto). Sin país → `phone_normalized = null`; el lead se inserta igual.
- Formato canonical: E.164.
- Constraint DB: unique parcial `(project_id, phone_normalized) WHERE phone_normalized IS NOT NULL` (mig `0016:245-247`).
- Índice trigram sobre `name`, `phone_normalized`, `email` (mig `0016:270-277`) — habilita búsqueda parcial rápida.
- Dedup del import por E.164 + email lowercase (`src/lib/leads/import-config.ts:56-59` según el subagente).

✅ Sin duplicación aparente. `libphonenumber-js` sólo se importa desde `import.ts` (por chequear con grep en Paso 6).

---

## 5.8 Ventanas del launch y clamp de SendFlow

- Ventana autoritativa: `launches.date_start`, `launches.date_end` GENERATED (mig `0011`), derivadas de `launch_date - dur_captacion` y `launch_date + 2 + dur_compra + dur_cierre`.
- `sendflow.ts` acota `add.dates` y `remove.dates` a `[date_start, date_end]` inclusivo (`sendflow.ts:484-501` según el subagente).
- Parser DDMMYYYY: `parseSendflowDateKey()` en `sendflow.ts:78-103`.
- Retención (`(entered - removed) / entered * 100`) vive en `kpis.ts:263-266` (verificado por mí), **no** en el adapter. ✅

---

## 5.9 Notificaciones in-app

- Emisor (SQL): `create_notification(...)` RPC (`0024:180`). ON CONFLICT DO NOTHING con dedup key.
- Triggers DB que emiten:
  - `notify_launch_started` (`0026:40`, rewrite `0027:95`): dispara cuando `launches.date_start <= today` y `closed_at IS NULL`.
  - `notify_ai_summary_ready` (`0026:92`, rewrite `0027:141`): dispara al terminar `ai_runs` con `status='success'`.
- Emisor (app): las alertas de umbral (mig `0025`) las evalúa `evaluateAlertsForLaunch(launch_id)` (según el subagente y `sync.ts` fire-and-forget). Dedup: `dedup_key = ${launch_id}|${metric}|${dateUTC}`.
- Consumo:
  - `GET /api/notifications` (últimas 20) y `GET /api/notifications/unread-count` (polling 30 s) — `02-rutas.md`.
  - Componente: `src/components/notifications/notification-bell.tsx` (274 LOC).
- Frontier de destinatario:
  - `target_role ∈ {team, cliente}` **XOR** `target_user_id` (constraint `notifications_target_xor`, `0024:187-190`).
  - RLS en `notifications`: `has_project_access AND (target matchea)` — a completar en el Paso 3 (ya listado como pendiente).

---

## 5.10 Exports

| Archivo | Formato | Uso |
| --- | --- | --- |
| `src/lib/leads/export.ts` (`buildLeadsWorkbook`) | xlsx | Endpoint `/api/proyectos/[id]/leads/export?format=xlsx`; cap 50k rows (`MAX_EXPORT_ROWS`) |
| `src/lib/leads/export-csv.ts` (`buildLeadsCsv`) | csv | Idem con `format=csv` |
| `src/lib/leads/export.ts` (`buildTemplateWorkbook`) | xlsx | Template del wizard de import |
| `src/lib/launch-daily/export-csv.ts` (`buildDailyCsv`) | csv | Endpoint `/api/proyectos/[id]/launches/[lid]/daily/export` |
| `src/lib/reports/executive-launch-pdf.tsx` (624 LOC) | PDF | Report ejecutivo — usado por dashboard y por portal cliente (misma función) |
| `src/lib/reports/commissions-launch-pdf.tsx` (521 LOC) | PDF | Report comisiones (admin only) |
| `src/lib/client-portal/export.ts` (`buildClientLeadsCsv`, `buildClientLeadsWorkbook`) | csv/xlsx | Portal cliente — sin `team_member_id` |

Consumidores en `02-rutas.md:2.3` (todos GET, con `requireX` correspondiente).

✅ Executive PDF **reutilizado por dashboard y portal cliente** — misma función, distinto guard. Buen aislamiento.

---

## 5.11 Watchdog de `integration_runs`

`src/lib/integrations/runs.ts` (229 LOC).

- **Expiración virtual** (UI, en el read): `isStaleRunning(status, startedAtIso)` en `runs.ts:16-21`. Cualquier run en `running` con >15 min lo trata como `error` **en el shape que devuelve al frontend**, sin tocar DB (`runs.ts:129-135`, `runs.ts:206-224`).
- **Expiración real** (DB): `fireWatchdogInBackground()` en `runs.ts:31-46`. Llama RPC `expire_stale_integration_runs(p_threshold='15 minutes')` como **fire-and-forget con `.catch(() => {})`** — falla en silencio (`runs.ts:40-42`).
- Constante `STALE_RUN_THRESHOLD_MS = 15 * 60 * 1000` (`runs.ts:8`) — espejo del default de la RPC (mig `0019`).

Umbral duplicado en dos lados (JS y SQL). Cambiar uno sin el otro → drift.

Solución al bug de "runs colgados": la doble capa (virtual + async) desbloquea la UI sin race con el UPDATE (`runs.ts:126-131`). ✅ **Diseño limpio para escalar al subdominio** — no depende del host.

---

## 5.12 🔴 Duplicaciones y drift verificados

| # | Duplicación | Original | Duplicado | Riesgo |
| ---: | --- | --- | --- | --- |
| 1 | Fórmula de cuotas | `generate_installments_for_sale` (`0043:169`) | `buildInstallmentSchedule` (`installments/schedule.ts:24-53`) | Cambio en SQL o JS sin espejar → preview ≠ realidad. Test de contrato pendiente. |
| 2 | Umbral watchdog | RPC `expire_stale_integration_runs` (mig `0019`) usa `interval '15 minutes'` como default | `STALE_RUN_THRESHOLD_MS = 15 * 60 * 1000` (`runs.ts:8`) | Drift silencioso. |
| 3 | `date_start / date_end` GENERATED (SQL) vs `computeLaunchCalendar` (JS) | Mig `0011:196-…` | `calendar.ts:106-179` | Sólo `date_start/date_end` viven en SQL; las etapas intermedias vive en JS. |
| 4 | `aggregateLeaderboard` JS vs RPC 0046/0047 | RPC | `aggregate.ts:225-314` | Distintas fuentes de `team_member_id` para atribución (⚠️ 5.2.5). El código legacy usa `lead.team_member_id`; `buildSaleRanks` usa `sale.team_member_id`. |
| 5 | Kanban revenue por `lead.launch_id` vs Sales por `sale.launch_id` (Fase 8) | Post-`0041` cada venta tiene su launch | ¿`launch-sales/aggregate.ts` sigue usando `lead.launch_id`? | Pregunta abierta al final. |

---

## 5.13 Reglas centralizadas y limpias (✅)

Vale la pena listar dónde el subdominio **no** necesita tocar nada:

- `calculateLaunchKPIs` (`kpis.ts:172-320`) — un solo consumer path.
- `computeCommission` y `computeCommissionFromAgg` (`calc.ts:160-258`) — reutilizados por kanban, sale-modal, project-sales-view, comisiones page, PDF de comisiones. Cero duplicaciones en componentes.
- `computeLaunchCalendar` — puramente en `calendar.ts`, consumido por form + detalle + PDF.
- `resolveMatchAction` (`ghl-match.ts:151-158`) — matcher declarativo, único consumidor: sync-ghl.
- `phone_normalized` — sólo `import.ts` (por confirmar en Paso 6 grep).
- Executive PDF — mismo `renderExecutiveLaunchPdf` para dashboard y portal cliente.

---

## Discrepancias con `docs/AUDITORIA.md`

Todo este capítulo es prácticamente inexistente en `AUDITORIA.md`:

- Sin mención a comisiones, tiers, accrual modes, snapshot congelado.
- Sin mención a leads/kanban post-`0018` (frio/tibio).
- Sin mención a cuotas / installments.
- Sin mención a multi-sale por lead.
- Sin mención a leaderboard.
- Sin mención a watchdog virtual + async.
- El calendario de fases sólo aparece cuando `AUDITORIA.md:9.3` habla de "22 métricas por launch" — pero la migración `0011` no está catalogada.

`AUDITORIA.md` sigue congelado en la Fase 2 con la mirada del KPI puro sin CRM/ventas. **Todo este documento es novedad**.

---

## ⚠️ No pude determinar

Estas quedan como consultas al usuario o próxima pasada de código:

1. **Regla de "manual gana" para `team_member_id` vs sync GHL**: hoy el sync pisa el owner si tiene un mapping en `ghl_user_mappings`. ¿Es intencional que el sync mande sobre lo manual? Si no, hay que agregar un flag `assigned_manually` en `leads` para bloquear el update.
2. **`launch-sales/aggregate.ts`**: ¿el kanban revenue se agrega por `lead.launch_id` o `sale.launch_id`? Post-Fase 8 la respuesta correcta es `sale.launch_id`. Confirmar con lectura de las 128 LOC.
3. **`bulk recalculation modal`**: ¿regenera snapshots masivamente o dispara `update_commission_rule` RPC + recalculo? Impacto: si regenera snapshots, las ventas "hoy" cambian; si sólo cambia la regla, sólo las ventas sin snapshot cambian. Distinción crítica para el negocio.
4. **`payments.installment_id` re-linkeo**: la memoria dice "regeneración con re-linkeo". ¿Es 100% manual o el UI ayuda con auto-match por monto + fecha aproximada?
5. **Clasificación cliente bueno/regular/malo**: ¿alguien la lee para decidir algo (bloquear acceso al curso vía GHL, marcar el lead, disparar notificación)? Si nadie la lee todavía, sigue siendo información pasiva.
6. **`evaluateAlertsForLaunch`**: función mencionada por el subagente pero no confirmé archivo. Probablemente `src/lib/alerts/evaluate.ts`.
7. **Comisiones sobre payouts negativos**: el `pending = commissionAccrued - paidOut` puede ser negativo (`aggregate.ts:49-53`). Ninguna alerta hoy. ¿Debería el UI colorear en rojo o disparar notificación?
