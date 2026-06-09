# Integraciones Meta Ads — Estado de validación (Fase 3a)

> Estado al cierre del código de Fase 3a, antes de la corrida contra cuenta real.

## Lo que está validado con mock (vitest, fixtures basados en doc Meta v25)

- **Parsing de la respuesta happy path**: `data[]` con `spend`/`impressions`/`clicks`/`actions[]`/`date_start`/`date_stop` (string + numérico). Verifica el mapeo de leads sumando los `action_type` "lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen.other".
- **Respuesta vacía** (`data: []`) → status `success`, `rows_written = 0`.
- **Token inválido** (code 190, subcode 463) → status `token_invalid`, surfaceado en UI con badge rojo "Reconectar Meta".
- **Rate limit** (code 17, subcode 2446079) → status `rate_limited`. Parseo del header `X-Business-Use-Case-Usage` para `retryAfterSeconds`.
- **Shape inesperado** (body sin `data` array, body no-objeto, HTTP 5xx sin error estructurado) → status `error` con `detail.cause` específico.
- **Items malformados** (sin `date_start` válido) saltados sin romper los demás. Si todos están mal, status `error` schema_mismatch.
- **Idempotencia del upsert**: garantizada por el `UNIQUE (launch_id, date, provider)` + `upsert onConflict`. Pendiente test e2e en DB pero el constraint lo cubre.
- **Ventana de fechas**: el orchestrator filtra defensivamente `r.date >= date_start && r.date <= date_end` antes de upsert.
- **Launch cerrado**: el orchestrator devuelve `config_missing` cuando `closed_at IS NOT NULL`. El botón Sync también está disabled en la UI.
- **Config faltante**: `config_missing` cuando falta `ad_account_id`, `campaign_ids` (lista vacía) o el token en `launch_secrets`.
- **RLS de las 3 tablas nuevas**: probado en `rls_smoke_test.sql` (tests 18-21).

## Lo que NECESITA cuenta real para cerrar 3a

Estos puntos NO se pueden validar sin el System User token de Elbio:

### 1. Heurística de `action_type` para leads
**Riesgo: alto.** El `action_type` correcto depende de cómo esté armada la campaña. La lista actual cubre los 4 más comunes documentados por Meta, pero un cliente puede usar:
- Custom Conversions con nombres específicos (`offsite_conversion.custom.XXXX`).
- Pixel events distintos a Lead (Purchase, CompleteRegistration).
- On-Facebook Lead Forms con otro action_type.

**Cómo validar**: correr un sync con un launch real, comparar el `leads` que devuelve el adapter con el que se ve en Meta Ads Manager para la misma campaña/rango. Si no coincide, ver el `raw jsonb` en `launch_daily_ads` y mirar qué `action_type` está produciendo los leads → agregarlos a `LEAD_ACTION_TYPES` en `src/lib/integrations/meta.ts`.

### 2. Filtering por `campaign.id IN [...]`
**Riesgo: medio.** Meta acepta el filtering, pero hay que confirmar que con `level=campaign` agrupa por campaña y no por ad/adset (que multiplicaría las filas).

**Cómo validar**: correr el sync apuntando a una campaña con varios anuncios. Esperar 1 fila por (campaign, día). Si vienen muchas más → ajustar `level` o agregar `breakdowns=campaign_id` explícito.

### 3. `time_increment=1` con rangos largos
**Riesgo: bajo.** La doc dice que `time_increment=1` devuelve una fila por día dentro del `time_range`. Verificar con un rango de 30+ días que efectivamente vengan 30 filas y no una sola agregada.

### 4. Headers de rate limit reales
**Riesgo: bajo.** El parseo de `X-Business-Use-Case-Usage` se hace defensivo (any node con `estimated_time_to_regain_access`). Si Meta cambia el shape de los headers, el `retryAfterSeconds` puede salir null sin tirar excepción — el sync igual marca `rate_limited` pero sin tiempo sugerido. Validar con un caso real de throttling (más de 200 calls/hora).

### 5. Latencia del response
**Riesgo: bajo.** El brief no impone SLA; en 3a el sync es manual (el usuario espera). Si en producción se vuelve cron (3c), medir si los queries típicos tardan >30s para considerar paginación.

## Cómo correr la validación con cuenta real

1. Aplicar todas las migraciones (la última de Fase 3a es `0012_launch_integrations.sql`).
2. Crear (o usar existente) un launch en Launch OS con `launch_date` definida y al menos 7 días de ventana.
3. Entrar al detalle del launch → sección Integraciones → click "Conectar" en Meta.
4. Pegar el System User token de Elbio en el primer paso, "Guardar token".
5. Cargar el `ad_account_id` (`act_XXXX`) + 1 o más `campaign_ids` reales (del periodo del launch). "Guardar config".
6. Click "Sincronizar".
7. Esperar el spinner. Verificar:
   - El estado del run pasa a "success" con `rows_written > 0`.
   - El gráfico de Datos diarios muestra las nuevas filas.
   - La tabla `launch_daily_ads` en Studio tiene rows con spend > 0, leads > 0.
   - El `raw` jsonb contiene el item completo de Meta para esa fecha.
8. Comparar los `leads` por día con los de Ads Manager para validar la heurística.
9. Marcá puntos en este checklist conforme valides.

## Lo que NO entra en 3a (queda para 3c)

- Cron de sincronización automática (Vercel Cron).
- Webhooks de Meta para push notifications.
- Retry con backoff exponencial.
- Dead-letter queue para fallos persistentes.
- Paginación cuando el response excede 500 items.
