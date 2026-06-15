# Integraciones Go High Level — Estado de validación (Fase 3b)

> Estado al cierre del código de Fase 3b. Mismo formato que `INTEGRATIONS_META.md`.

## Alcance del sync

Un solo botón "Sincronizar" en la sección Integraciones del lanzamiento. Trae:

- **Contactos** del location, filtrados por `dateUpdated ∈ [date_start, date_end]` del launch (cortocircuito incremental por `lastSuccessAt`).
- **Appointments** de TODOS los calendars y users del location, filtrados por `startTime ∈ [date_start, date_end]`.
- **Conversaciones por contactId** — UNA por cada contact del fetch incremental, para detectar `lastInboundWhatsappMessageDate` y clasificar tibio.

Una corrida = una fila en `integration_runs` con `stage='all'`.

## Reglas de clasificación

| Señal | Estado resultante |
| --- | --- |
| Appointment confirmado (status ≠ cancelled/noshow/invalid) | `agendado` + pinned |
| Tag `cliente` en el contact | `cerrado` + pinned |
| `lastInboundWhatsappMessageDate ∈ [compra.start, cierre.end]` | `tibio` + pinned |
| Nada de lo anterior | `frio` (NO pinned al kanban; va a la tabla) |

**Regla "no degradar"**: el matcher nunca baja status. Un lead `agendado` no vuelve a `tibio` aunque la próxima corrida solo traiga señal de mensaje inbound. Un lead `cerrado`/`perdido` queda noop (solo refresca `team_member_id` si vino del mapping).

## Regla "un inbound = tibio" — imprecisión asumida

**Decisión de negocio**: cualquier mensaje entrante del lead dentro de la ventana compra+cierre lo califica como tibio. Sin importar si respondió 1 vez o 50, sin importar si después conversó más o se calló. Es **impreciso a propósito**:

- ❌ No distingue "respondió 1 vez por curiosidad" vs "respondió 10 veces y está caliente".
- ❌ No usa el tag manual `tibio` (la automatización en GHL no existe ni se va a hacer).
- ❌ No cuenta mensajes (contar requiere paginar conversación por conversación = inviable a 20k+).
- ✅ Escalable: 1 query por contact, no se cae con volumen.
- ✅ Determinístico: el campo `lastInboundWhatsappMessageDate` de GHL es autoritativo, no depende de orden de paginación.
- ✅ Barato: incremental diario (~1k contacts) tarda ~20s extra para clasificar tibio.

## Vendedor asignado

`contact.assignedTo` (GHL userId) → traducido via tabla `ghl_user_mappings(project_id, ghl_user_id, team_member_id)` → seteado en `leads.team_member_id`. El mapping se configura desde el modal "Mapear vendedores" en la sección Integraciones del launch (vale para todos los launches del proyecto).

Si un `assignedTo` no está mapeado, el lead queda sin vendedor y se puede asignar manualmente desde la tabla de leads.

## Idempotencia

Garantizada por:

1. **Unique parcial** `(project_id, source, external_id) WHERE external_id IS NOT NULL` (migración 0017).
2. **Locate por phone** como fallback cuando un lead manual/import no tiene external_id pero sí teléfono.
3. **23505 fallback** en `applyAction`: si un bulk insert choca por race, se ignora silenciosamente.

Re-correr el sync N veces deja el mismo estado final. La auditoría confirma `skipped: ~95%` en corridas repetidas.

## Performance

| Volumen | Tiempo esperado |
| --- | --- |
| Sync incremental diario (~1k contacts) | <30 s |
| Primera corrida masiva (20k contacts) | 5-7 min (cap defensivo de 2000 conversation lookups por corrida — ver "Limitación: clasificación tibio en primera corrida masiva" abajo) |
| Cualquier corrida sin contactos nuevos | <5 s |

**Cuellos optimizados**:
- Bulk locate por `external_id IN (...)` y `phone_normalized IN (...)` → 2 queries en lugar de N×2.
- Bulk insert por batches de 500.
- Updates individuales en paralelo (concurrency 10), salteando no-ops.
- Conversation lookup por contactId en paralelo (concurrency 10).

## Limitaciones conocidas

### 1. Aislamiento entre lanzamientos del mismo location

**Si dos launches activos comparten location de GHL y sus ventanas de fechas se solapan**, un contact modificado durante el solape puede entrar a ambos. El `launch_id` del lead se lo queda el launch que sincronizó último — **no hay aislamiento real**.

**Por qué no se resuelve**: la solución natural es taggear cada contact con un tag por launch (ej. `launch-2026-junio`), pero requiere config manual del cliente en GHL y no escala a operaciones con muchos lanzamientos. La decisión de producto es convivir con la limitación.

**Cómo detectarlo en producción**: si ves leads que aparecen en el launch "equivocado", es esto. Workaround manual: reasignar el `launch_id` del lead desde la UI o vía SQL.

### 2. Clasificación tibio en primera corrida masiva

El conversation lookup por contactId tiene un cap defensivo de 2000 contactos por corrida. Si la corrida supera ese cap (típicamente la primera vez que se sincroniza un launch grande), los contactos sobrantes **no se clasifican como tibio** en esa corrida — quedan `frio`.

Las siguientes corridas incrementales (mucho más chicas) los van a clasificar bien en el próximo paso por `dateUpdated`.

### 3. "Un inbound = tibio" no captura matices

Ver sección "Regla 'un inbound = tibio'" arriba. Es una decisión consciente del negocio. El kanban refleja "tuvo actividad" más que "está caliente para cerrar".

## Lo que está validado

- ✅ **Sync atómico** (1 botón) probado contra cuenta real con 70k contactos / 20k en ventana.
- ✅ **Watchdog** marca como `error` los runs colgados >15 min.
- ✅ **Bulk locate + bulk insert + filtro no-op**: 8 min → <1 min entre primera corrida y segunda incremental.
- ✅ **Tag `cliente` → cerrado**: cableado y testeado en unit tests.
- ✅ **Vendedor asignado**: `mappings_applied: 7` en corrida real (7 leads recibieron `team_member_id` correctamente).
- ✅ **Appointments cancelados/noshow → noop**: testeado.

## Lo que NECESITA validación con cuenta real (bloqueante para cerrar 3b)

### Tag `cliente` end-to-end

Hasta el momento `with_client_tag: 0` en todas las corridas observadas. Hay que:

1. Tomar un contact real en GHL.
2. Taggearlo como `cliente`.
3. Disparar sync.
4. Verificar que aparece en el kanban con status `cerrado` y su `team_member_id` correcto.
5. Si falla, debug. Si pasa, marcar este punto como validado.

### Clasificación tibio por inbound real

Hasta el momento `warm_orphan_promotions: 0`. Hay que:

1. Identificar un contact que tenga `lastInboundWhatsappMessageDate` dentro de compra+cierre del launch.
2. Disparar sync.
3. Verificar `warm_orphan_promotions > 0` (si el contact no entró al fetch incremental) o `warm_signals_applied_to_fetched > 0`.
4. Verificar que el lead aparezca con status `tibio` en el kanban.

## Lo que NO entra en 3b (queda para 3c)

- Cron de sincronización automática.
- Webhooks GHL para push notifications de cambios.
- Retry con backoff exponencial.
- Dead-letter queue para fallos persistentes.
- Aislamiento entre launches del mismo location (decisión: convivir con la limitación).
- Eliminación del cap de 2000 en conversation lookups (requiere cola de background jobs).
