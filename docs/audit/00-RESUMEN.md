# 00 · Resumen ejecutivo

Auditoría del repo `launch-os` a `main@b0136f1` (2026-07-23). Solo lectura. Detalles en los archivos 01–08.

---

## 1. Qué es LaunchOS hoy, en 5 líneas

Es un CRM operativo de lanzamientos de marketing digital sobre Next.js 16 (App Router) + Supabase (Postgres 17 + Auth + RLS) + Vercel. Multi-tenant por `projects` con 6 roles reales en DB (`dev / superadmin / admin / operador / analista / cliente`). 34 tablas activas, ~130 policies RLS montadas sobre helpers `SECURITY DEFINER`, 47 migraciones aplicadas. Integra Meta Ads, GoHighLevel y SendFlow con sync manual (sin cron) y OpenAI para resúmenes ejecutivos. El portal de cliente final ya existe como route group `(cliente)/portal` con frontera dura por rol Postgres `cliente_role` y grants column-level — la barrera de datos vive en DB, no en UI. Todo el código productivo está en `src/` (356 archivos, 51 643 LOC) más `supabase/` (48 archivos, 7 214 LOC).

---

## 2. Los 5 hallazgos más importantes

1. **`docs/AUDITORIA.md` y el roadmap en memoria están 12 fases desactualizados.** El repo tiene features de Fase 8 (multi-venta por lead), Fase 9 (revenue split), Fase 10 (rol dev + audit), Fase 11 (cuotas + métodos de pago + bancos) y Fase 12 (leaderboard RPCs perf) que no figuraban en `project_launchos_roadmap_v2`. El código habla; los documentos se quedaron.
2. **La frontera del rol cliente vive en DB, columna a columna (`0023_cliente_role_frontier.sql`)**, no en UI. Es defensa correcta y portable a subdominio — pero **requiere un hook manual activo en Supabase Studio** que hoy no puedo verificar remotamente. Sin ese hook prendido, el cliente entra como `authenticated` y puede leer `team_members`, `commission_rules`, etc. via PostgREST aunque el UI las oculte. **Es el bloqueante #1 antes de exponer el portal a clientes finales**.
3. **La reconciliación de revenue y las comisiones sobre cobrado se volvieron más caras con multi-venta por lead (Fase 8) + cuotas (Fase 11).** Un lead puede tener N ventas en M launches; cada venta puede tener N cuotas y M pagos; el ranking para tiers se calcula por `(sale.team_member_id, sale.launch_id)` **pero** la atribución de comisión usa `lead.team_member_id`. Si esos dos divergen (drift documentado en `sales.team_member_id` denorm) el mismo sale se atribuye a A y se rankea como si fuera B. La RPC 0047 lo corrige leyendo `lead.team_member_id` en ambas cosas; el path JS legacy no. Detalle en `05-negocio.md § 5.2.5, § 5.3.6-7`.
4. **Cero cron activo en el repo** (`vercel.json` no existe, `/api/cron/*` no existe, `pg_cron` no aparece en migraciones). Todos los syncs se disparan a mano, el watchdog corre fire-and-forget al abrir la UI, `purge_audit_old` nunca se ejecuta y el `audit_log` crece sin techo. Es la "Fase 3c" nunca empezada.
5. **La cookie de sesión (`@supabase/ssr`) se setea sin `Domain` explícito** (`middleware.ts:47-48`). Para SSO cross-subdominio (`admin.growins.com` ↔ `launch.growins.com`) hay que cambiar 4 líneas más una env `NEXT_PUBLIC_COOKIE_DOMAIN=.growins.com`. Bajo esfuerzo, alto impacto — sin este cambio el subdominio pide login separado.

---

## 3. Los 5 bloqueantes más grandes para modularizar y pasar a subdominio

1. **Verificación de la frontera del rol `cliente` en el Supabase remoto**. Sin el hook activo la RLS es la única barrera y los grants a `authenticated` incluyen tablas que el cliente no debería leer. Bloque de queries SQL para correr manualmente en `03-datos.md § 3.12`.
2. **Cookie domain para SSO**. Ver hallazgo #5. Es un cambio quirúrgico, pero sin él, cada subdominio pide login.
3. **`redirect("/")` como "home del sistema"** aparece 6+ veces (`07-modularizacion.md § 7.5.1`). Bajo impacto si LaunchOS queda en `launch.growins.com/`, alto si va bajo `basePath="/launch"` o microfrontend. Decisión estratégica pendiente.
4. **`launches`, `crm/leads`, `sales/commissions` son un hub tri-nodal indivisible**. La lógica de negocio (`kpis.ts`, `calc.ts`, `leaderboard/aggregate.ts`) toca los tres. No conviene partirlos en packages separados. Sí conviene **agrupar como "módulo LaunchOS"** dentro de la plataforma más grande.
5. **Guard de `/dev/auditoria`** (`page.tsx:67`) sólo llama a `requireSessionProfile`, no `requireRole('dev')`. Si dentro de las 375 LOC no filtra por rol al armar la query, cualquier `authenticated` lee el audit del sistema entero. Verificar antes de exponer el portal a clientes finales (aunque no comparten route group, comparten proxy y Supabase).

---

## 4. Orden de extracción recomendado (menor a mayor riesgo)

Ver `07-modularizacion.md § 7.7`.

1. **`shared`** (`format`, `kpis`, `calculator`) y **`core`** (auth, supabase clients, permisos, layout base, design system, notifications). Cero riesgo funcional.
2. **`ai`**. Provider abstraction en 1 archivo (`ai/client.ts`), tabla siloed (`ai_runs`). Fácil de mover — o portable a Vercel AI Gateway.
3. **`client-portal`** como subdominio o microfrontend. Superficie chica (1 463 LOC entre rutas + componentes + lib) y frontera DB clara.
4. **`community`** (SendFlow). Bajo acoplamiento, sólo `launch_community_metrics`.
5. **`integrations`**: separar adapters (`meta`, `ghl`, `sendflow`) de orchestrator (`sync.ts`, `sync-ghl.ts`). Ganancia: adapters testeables y reemplazables.
6. **`launches` + `ads`** juntos. Son el núcleo — no se parten.
7. **`crm` + `sales`** juntos. La lógica de atribución y reconciliación de revenue no se puede partir sin duplicar cálculos.

Complementario: para el subdominio conviene también, **antes del split**:

- Setear cookie domain (bloqueante #2).
- Verificar hook cliente (bloqueante #1).
- Agregar `error.tsx` y `not-found.tsx` con branding.
- Envolver `sale-modal.tsx` en `dynamic()` para reducir bundle inicial de `/leads`, `/cobros`, `/ventas`.

---

## 5. Preguntas abiertas para el usuario

Necesito estas respuestas antes de armar el plan de migración concreto:

1. **Estrategia de despliegue del subdominio**: ¿`launch.growins.com/` dedicado, `platform.growins.com/launch/…` con `basePath`, o microfrontend con `@vercel/microfrontends`? Cada opción cambia el tamaño y el orden del refactor.
2. **¿Toda la plataforma va a usar el mismo Supabase?** Si es sí, la migración es de código; si es no, hay que rehacer auth desde cero.
3. **¿Cuál es el rol de `admin/proyectos` y `admin/usuarios`?** ¿Se quedan con LaunchOS o suben a la plataforma general (gestionan usuarios que van a usar admin, finance, etc., no sólo launch)?
4. **`sales.total_amount` y `payments.amount` visibles al cliente final**: ¿lo aceptamos o hay clientes que no deben ver revenue? Cambio de column-level revoke si es lo segundo.
5. **`launch_opportunities`**: se sigue poblando por el sync GHL pero desde Fase 9 (dec. 2.a) `kpis.ts` no la lee más. ¿Dropeamos la tabla y desactivamos el sync, o mantenemos el histórico?
6. **`sales.team_member_id`**: la columna es denorm que puede driftear con `lead.team_member_id`. ¿La dropeamos y forzamos a todos los lectores a joinear leads (como hace la RPC 0047), o la mantenemos con backfill periódico?
7. **Bulk recalculation modal de comisiones (`ccc3ca2`)**: ¿regenera snapshots masivamente (cambia historial) o sólo dispara `update_commission_rule` (deja histórico intacto)? Impacto radicalmente distinto en el negocio.
8. **Portal cliente — ¿qué más quiere ver el cliente?** Hoy: overview + launches (con IA) + leads. NO ve: comisiones, cobros, ventas del equipo, integraciones, bancos, métodos de pago, alertas. Confirma o extendemos la frontera.
9. **Auth cross-domain**: ¿los clientes finales del portal comparten sesión con el equipo interno de Growins, o van con Auth separada (¿SSO externo? ¿provider distinto?)?
10. **Cron**: ¿está OK abrir Vercel Pro para 3+ cron jobs, o consolidamos en un endpoint dispatcher? Impacto en `purge_audit_old`, watchdog, syncs periódicos.

---

**Los documentos completos**: `01-estructura.md`, `02-rutas.md`, `03-datos.md` (con bloque de SELECTs de verificación al final), `04-integraciones.md`, `05-negocio.md`, `06-frontend-performance.md`, `07-modularizacion.md`, `08-riesgos.md`, más el material intermedio `_schema-raw.md` (referencia del agente de esquema — no borrar, ayuda a cruzar contra la DB en vivo).

Puedo entrar en cualquiera de los 10 puntos con más profundidad cuando lo pidas.
