-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Bancos externos por cliente            │
-- │                                                                          │
-- │ CONTEXTO                                                                  │
-- │   Hay clientes externos (los proyectos que Kingrow gestiona) que cobran   │
-- │   por SUS PROPIOS bancos. Kingrow igual necesita registrar esas ventas y │
-- │   sus cobros: sin registro, no hay comisión, no hay retención, no hay    │
-- │   liquidación. Pero la plata NO entra a los bancos de Kingrow.           │
-- │                                                                          │
-- │ WORKAROUND ACTUAL (a discontinuar)                                        │
-- │   Crear un banco "propio" por cliente + método de pago apuntando ahí.    │
-- │   Consecuencia: catálogo de bancos poluido, saldos runtime falsos si     │
-- │   alguien mueve el modelo, y ambigüedad en conciliación.                 │
-- │                                                                          │
-- │ MODELO POST-0169                                                          │
-- │   Un mismo banco puede ser:                                               │
-- │     · propio (is_external_collector = false, external_project_id = NULL) │
-- │     · marcador de canal externo del cliente                              │
-- │       (is_external_collector = true, external_project_id = <proyecto>)   │
-- │                                                                          │
-- │   Un banco externo:                                                       │
-- │     · SE EXCLUYE del saldo bancario y del cash-flow real (lo enforza el │
-- │       lado TypeScript en `computeBankBalances`/`buildBankReport` — ver  │
-- │       tickets acompañantes al PR de 0169).                              │
-- │     · SIGUE siendo destino válido de `payment_methods.bank_id`. Un cobro │
-- │       cargado con un método que rutea a banco externo queda registrado  │
-- │       como "cobrado por el cliente", no por Kingrow.                    │
-- │     · Alimenta la partición `collected_by_client_external` de           │
-- │       `launch_settlements` (mig 0170) para calcular el neto de          │
-- │       transferencia en la liquidación.                                  │
-- │                                                                          │
-- │ CONSTRAINT DE COHERENCIA                                                  │
-- │   is_external_collector = true  ↔ external_project_id IS NOT NULL       │
-- │   is_external_collector = false ↔ external_project_id IS NULL           │
-- │   (bicondicional — no queremos "medio externos" ni "propios con proyecto│
-- │   fantasma").                                                            │
-- │                                                                          │
-- │ BACKFILL                                                                  │
-- │   Los bancos existentes son todos propios: default false + NULL cubre   │
-- │   sin update. Si mañana se descubre que algún banco actual era en       │
-- │   realidad un canal externo con el workaround viejo, se marca a mano.   │
-- │                                                                          │
-- │ NIVEL DE TENANCY                                                          │
-- │   Sigue siendo ORG (heredado de 0057 / 0101). external_project_id       │
-- │   apunta a un proyecto de la MISMA org — la RLS de banks impide         │
-- │   escribir bancos de otra org, y el FK a projects tiene el mismo scope. │
-- │   No agregamos check adicional org=org: si aparece un caso, el fix va   │
-- │   en la action, no en SQL.                                              │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Columnas nuevas
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.banks
  add column if not exists is_external_collector boolean not null default false,
  add column if not exists external_project_id   uuid
    references public.projects(id) on delete restrict;

comment on column public.banks.is_external_collector is
  'true = el banco NO es una cuenta de Kingrow, sino un marcador del canal por el que cobra un cliente externo. Se excluye de saldos, cash flow y conciliación de bancos propios. Los cobros que rutan acá siguen registrándose como ingresos del cliente para la liquidación.';

comment on column public.banks.external_project_id is
  'Proyecto (cliente externo) al que pertenece este canal de cobro. NOT NULL cuando is_external_collector=true; NULL cuando es banco propio. Usa on delete restrict para no perder el link si alguien intenta borrar el proyecto sin cerrar sus liquidaciones.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) CHECK bicondicional (is_external_collector ↔ external_project_id NOT NULL)
--    Se implementa con un solo predicado equivalente a XNOR:
--      NOT (is_external_collector XOR (external_project_id IS NOT NULL))
--    Postgres no tiene XOR directo — usamos igualdad de booleans, que es lo
--    mismo semánticamente y más legible.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.banks
  drop constraint if exists banks_external_collector_coherence;
alter table public.banks
  add  constraint banks_external_collector_coherence
  check (is_external_collector = (external_project_id is not null));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Índice parcial — lookups por proyecto en bancos externos
--    Uso esperado: `listExternalCollectorBanks(projectId)` en el side TS.
--    Partial index para no crecer con bancos propios (mayoría).
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists banks_external_project_idx
  on public.banks(external_project_id)
  where is_external_collector = true;
