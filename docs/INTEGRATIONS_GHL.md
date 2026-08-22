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

---

# Tag sync para Academia (Fase C — Máquina del Éxito)

Sync separado del sync de leads descrito arriba. Objetivo: marcar módulos de curso como completados cuando el alumno recibe una tag en GHL. Vive en `src/lib/integrations/ghl-tag-sync.ts`.

## Approach: PULL, no webhook inbound

El cron diario `/api/cron/academia-daily` (schedule `0 3 * * *`) invoca `syncAllGhlTrackedCourses()` al terminar el barrido de expiraciones. La UI de curso también expone un botón **Sincronizar ahora** que dispara `syncTagProgressForCourse(courseId)` de la corrida manual.

**Por qué pull y no webhook**:
- Un webhook inbound requiere endpoint público expuesto + auth por header + tolerancia a duplicados. Con volumen bajo (típicamente <100 completions/día por curso) el costo operativo no justifica la complejidad.
- Idempotente por diseño: `unique(enrollment_id, course_module_id)` + upsert en `student_module_progress`.

## Datos y credenciales

- `projects.ghl_location_id text` (agregado en migración 0142) — el location del cliente en GHL.
- `launch_secrets.provider='ghl'` — se reutiliza el PIT de cualquier launch del proyecto (todos apuntan a la misma location). El helper busca el más reciente por `updated_at`.
- `module_ghl_tag_mappings` (migración 0147) — puente `course_module ↔ ghl_tag`, unique por `(project_id, ghl_tag)`.
- `student_module_progress` (migración 0148) — progreso por `(enrollment_id, course_module_id)`.

Si falta el `ghl_location_id` o no hay ningún PIT en el proyecto, la sync se saltea el curso y retorna `skippedReason` en el resumen — no rompe el cron.

## Endpoint y filtros

Por cada tag mapeada de un curso trackeado:

```
POST https://services.leadconnectorhq.com/contacts/search
Headers:
  Authorization: Bearer <PIT>
  Version: 2021-04-15
Body:
  {
    "locationId": "<projects.ghl_location_id>",
    "pageLimit": 100,
    "filters": [
      { "field": "tags", "operator": "contains", "value": "<tag>" }
    ],
    "searchAfter": <cursor opcional, ver abajo>
  }
```

**Paginación**: cursor `searchAfter` devuelto en la respuesta (variantes: top-level, dentro de `meta`, o expuesto en el último contact). Corta cuando la página trae menos que `pageLimit` o cuando no aparecen contactos nuevos entre páginas (dedup por `contact.id`).

**Techo defensivo**: `MAX_PAGES_PER_TAG = 100` (~10k contactos por tag). Locations con más de 10k contactos con la misma tag exceden lo esperado; si aparece, hay que rediseñar el approach (webhooks + cursor persistido).

## Match student por email

- Los contactos devueltos se matchean contra `students.email` del proyecto (case-insensitive, trim). El schema tiene unique parcial `(project_id, lower(email))` así que el match es 1-1.
- Solo se upsertea si el student tiene un enrollment `status='active'` a alguna cohort del curso. Enrollments completados/expirados no reciben actualizaciones.
- Al upsert: `completed_at=now()`, `source='ghl_tag'`, `source_ref=<tag>`.

## Resumen del sync

`syncTagProgressForCourse` retorna:

```ts
{
  tagsChecked: number;      // mappings consultados
  contactsMatched: number;  // contacts con email que matchean students
  progressUpserted: number; // filas upsertedas en student_module_progress
  skippedReason?: 'missing_location_id' | 'missing_token' | 'no_mappings'
                | 'no_students' | 'no_active_enrollments' | 'course_not_found';
}
```

El botón "Sincronizar ahora" muestra estos contadores en la UI.

## Idempotencia

- Volver a correr el sync con las mismas tags → mismos matches → mismos upserts → 0 progresos nuevos. `updated_at` avanza pero `completed_at` original se preserva (la unique constraint + upsert onConflict evita duplicar).
- Un module_progress se puede reasignar a `source='manual'` manualmente desde la UI del alumno; el próximo sync GHL lo pisa si la tag sigue presente (source `ghl_tag` es "última fuente autoritativa").

## Tests

`src/lib/integrations/ghl-tag-sync.test.ts` cubre:

- `fetchContactsByTag`: página única, paginación con `searchAfter`, dedup entre páginas, respuesta 4xx.
- `syncTagProgressForCourse`: match happy path, no match, contact sin email, case-insensitive, sin location_id, sin token, sin mappings, sin students, sin enrollments activos, paginación real.

Todos los tests mockean el `global.fetch` + un `SupabaseLike` stub. No corren contra GHL ni Supabase reales.
