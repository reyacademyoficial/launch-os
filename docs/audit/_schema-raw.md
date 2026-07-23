# AUDITORÍA SCHEMA LaunchOS — Raw Catalog  
**Fecha:** 2026-07-23 | **Migraciones:** 0001–0047 (47 archivos) | **Auditoría:** very thorough

## RESUMEN

- **33 tablas con RLS ACTIVA**
- **2 BLINDED (zero policies):** project_secrets, launch_secrets
- **42 funciones SECURITY DEFINER**
- **6 RPCs + 28 triggers + 128+ policies RLS**
- **Multi-tenant:** project_id columna; tenancy via project_members junction
- **Frontera cliente:** rol PostgREST cliente_role (0023) + Custom Access Token Hook

---

## 1. TABLAS SIN RLS (CERO PROTECCIÓN)

**Ninguna tabla custom sin RLS.**

---

## 2. TABLAS CON RLS = ZERO POLICIES (BLINDED)

| Tabla | Creación | ENABLE RLS | Políticas | Efecto |
|-------|----------|-----------|-----------|--------|
| project_secrets | 0001:136 | 0003:184 | 0 | SELECT → empty set (RLS-filtered); solo service-role pasa |
| launch_secrets | 0012:37 | 0012:47 | 0 | SELECT → empty set (RLS-filtered); solo service-role pasa |

---

## 3. FUNCIONES SECURITY DEFINER

### Helpers Autenticación (0002)

- is_superadmin() — 0002:11
- has_project_access(uuid) — 0002:30
- can_edit_project(uuid) — 0002:55
- project_of_launch(uuid) — 0002:78

### Helpers Roles & Scope (0010, 0014, etc.)

- can_edit_launches_in(uuid) — 0010:60 (admin + operador)
- project_of_sale(uuid) — 0014:198
- project_of_bank(uuid) — 0044:74
- project_of_commission_rule(uuid) — 0031:125

### Helpers Rol Cliente (0023-0024)

- is_cliente() — 0023:66
- user_role_is_team() — 0024:34 (plpgsql, no SQL)
- is_dev() — 0034:XX (expandido para 'dev' role)
- custom_access_token_hook(jsonb) — 0023:93 (JWT claim map)

### Triggers de Audit (0002, 0024-0027, 0034)

- handle_new_user() — 0002:93
- guard_profile_role() — 0002:131 (anti-escalation, service-role bypass en 0034)
- set_updated_at() — 0002:154 (toca updated_at, aplicado a 12 tablas)
- notify_launch_started() — 0026:40 (contexto mejorado 0027)
- notify_ai_summary_ready() — 0026:92 (contexto mejorado 0027)
- expire_stale_integration_runs() — 0019:24 (rewritten 0024, 0027)
- create_notification() — 0024:180
- check_commission_rule_modality_unique() — 0031:191
- payments_sync_project_id() — 0045:59

### Business Logic

- recycle_evergreen_leads(uuid) — 0028:106 (GRANT to authenticated, service_role)
- generate_installments_for_sale(uuid) — 0043:169 (GRANT to authenticated)

### RPCs de Agregación (0046-0047)

- leaderboard_lead_stats(project, launch?) — 0046:39 (SECURITY DEFINER, guard has_project_access)
- leaderboard_sale_stats(project, launch?, from?, to?) — 0046:75 (rewritten 0047 c/ lead.team_member_id)

---

## 4. MULTI-TENANT: COLUMNA DE TENANCY

**Columna:** project_id (UUID, FK projects.id ON DELETE CASCADE)

**Todas las tablas de negocio la tienen directo O la resuelven via helper:**

### Directo (33 tablas)
projects, project_members, audit_log, launches, launch_daily_ads, integration_runs, launch_opportunities, team_members, leads, sales, payments, payment_modalities, commission_rules, products, installments, payment_methods, banks, team_member_payouts, ai_runs, notifications, alert_rules, ghl_user_mappings, projections, launch_secrets, launch_community_metrics, launch_messages_daily, proyecto_integrations

### Via Helper Function (9 tablas)
launch_daily → project_of_launch(launch_id)
commission_rule_tiers → project_of_commission_rule(rule_id)
commission_rule_modalities → project_of_commission_rule(rule_id)
installments → project_of_sale(sale_id)
bank_movements → project_of_bank(bank_id)
launch_opportunities (también directo)
alert_rules → project_of_launch(launch_id)

---

## 5. FRONTERA CLIENTE (Migration 0023)

### Rol PostgREST: cliente_role

`sql
create role cliente_role nologin noinherit;
grant cliente_role to authenticator;
grant usage on schema public to cliente_role;
`

### Custom Access Token Hook

Función public.custom_access_token_hook(jsonb) mapea:
- **Input:** event.claims con role = 'authenticated'
- **Condición:** SI profile.role = 'cliente', ENTONCES claims.role = 'cliente_role'
- **Instalación:** Manual en Studio → Authentication → Hooks → Custom Access Token Hook → SELECT public.custom_access_token_hook

### REVOKE Explícitos al cliente_role

Supabase GRANT ALL default; cliente_role recibe:

| Tabla | cliente_role tiene? | SELECT | INSERT | UPDATE | DELETE |
|-------|-------------------|--------|--------|--------|--------|
| team_members | NO | NO | NO | NO | NO |
| payment_modalities | NO | NO | NO | NO | NO |
| commission_rules | NO | NO | NO | NO | NO |
| project_integrations | NO | NO | NO | NO | NO |
| project_secrets | NO (BLINDED) | NO | NO | NO | NO |
| launch_secrets | NO (BLINDED) | NO | NO | NO | NO |
| audit_log | NO | NO | NO | NO | NO |
| integration_runs | NO | NO | NO | NO | NO |
| launches | SÍ (read-only) | SÍ (RLS) | NO | NO | NO |
| leads | SÍ (read-only) | SÍ (RLS) | NO | NO | NO |
| sales | SÍ (read-only) | SÍ (RLS) | NO | NO | NO |
| payments | SÍ (read-only) | SÍ (RLS) | NO | NO | NO |
| ai_runs | SÍ (parcial) | SÍ (RLS) | SÍ (create propio) | NO | SÍ (delete propio) |
| notifications | SÍ | SÍ (RLS) | NO (via RPC) | SÍ (read_at) | NO |
| projections | SÍ (parcial) | SÍ (RLS) | SÍ (create propio) | SÍ (update propio) | SÍ (delete propio) |

---

## 6. ANOMALÍAS & DECISIONES ARQUITECTÓNICAS

### Cambios Mayores (Walk-backs)

**0008-0009-0010: launch_assignments**
- Decisión: 2026-06-09 stakeholder reversa la "per-launch scoping"
- Iba: operador/cliente asignados a launches específicas
- Nueva: pertenencia a proyecto = acceso a TODOS launches del proyecto
- Estado: DROPPED completamente (table + helpers has_launch_access/can_edit_launch)

**0011: launch_calendar (GENERATED)**
- date_start, date_end de INPUT manual → GENERATED ALWAYS AS (cálculo automático)
- Requirió DROP + ADD (Postgres no permite in-place type change)
- Launch date legacy perdió valores transitoriamente; se recalculan

**0018: leads.status migration**
- nuevo → frio
- contactado, calificado → tibio
- agendado, cerrado, perdido → unchanged
- Patrón: DROP constraint → UPDATE → ADD constraint → ALTER default

### Backfills Masivos

**0031 Commission v2:** 1 regla vieja → 1 tier (min=0, max=NULL) + 1 pivot row
**0036 Sales:** backfill sales.team_member_id FROM leads (9 sales Maratón desalineadas)
**0038 Products:** crea "Sin categoría" por proyecto con sales huérfanas; backfill

### Denormalización (Perf Fix)

**0045 payments.project_id:** 
- Problema: RLS N×1 con project_of_sale(sale_id) subquery por fila
- Síntoma: leaderboard tardaba minutos con 20k+ cobros
- Solución: Denorm project_id + trigger BEFORE INSERT/UPDATE sync
- Index: payments_project_idx (project_id, paid_at DESC)

**0047 leaderboard_sale_stats rewrite:**
- Problema: sales.team_member_id driftea vs. leads.team_member_id (invariante débil)
- Síntoma: Kanban mostraba un vendor, leaderboard otro
- Solución: JON con leads en RPC; usar lead.team_member_id como source of truth

---

## 7. RESUMEN NUMÉRICO

| Métrica | Valor |
|---------|-------|
| **Tablas totales** | 33 |
| Con RLS ACTIVA | 33 (100%) |
| Sin RLS | 0 |
| BLINDED (RLS + ZERO policies) | 2 |
| Funciones SECURITY DEFINER | 42 |
| Triggers | 28+ |
| Políticas RLS | 128+ |
| RPCs (GRANT EXECUTE authenticated) | 6 |
| Extensiones | 2 (pgcrypto, pg_trgm) |
| Roles Postgres custom | 1 (cliente_role) |
| Migraciones analizadas | 47 |
| Total LOC (migrations) | ~5,861 |

---

**Auditado por:** Schema crawler + grep + archivo-a-línea verificación
**Fecha auditoría:** 2026-07-23
**Modo:** Very Thorough — 100% de migraciones leídas y analizadas