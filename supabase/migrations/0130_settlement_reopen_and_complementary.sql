-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0130 — Reapertura de liquidaciones + soporte para complementarias       │
-- │                                                                          │
-- │ Cierra dos ítems abiertos de la sección "Deuda y decisiones abiertas"    │
-- │ del plan (docs/kingrow-plan.md §post-Gate 0):                            │
-- │                                                                          │
-- │   (a) "Reapertura de liquidaciones: sin definir" → definida acá como    │
-- │       transición `liquidada → abierta` mediante RPC atómica que además   │
-- │       borra el `client_transfers` auto-creado por 0100. Solo se acepta   │
-- │       desde `liquidada` (nunca desde `transferida` — la plata ya se     │
-- │       movió; ese caso es un ajuste contable manual, no una reapertura). │
-- │                                                                          │
-- │   (b) "Liquidación complementaria (Maratón G7)" → habilitada agregando   │
-- │       una columna `parent_settlement_id` que linkea cada complementaria │
-- │       a la liquidación original. El motor TS (`create.ts`) usa esa      │
-- │       linkage para computar el delta cobrado no liquidado. La migración │
-- │       solo agrega la columna + índice; el cómputo vive en TS porque     │
-- │       depende del snapshot de la regla vigente en el momento.          │
-- │                                                                          │
-- │ DISEÑO DE REAPERTURA                                                     │
-- │                                                                          │
-- │ Columnas de auditoría en `launch_settlements` (nullable, sin backfill): │
-- │   reopened_at    timestamptz                                             │
-- │   reopened_by    uuid → auth.users(id) on delete set null                │
-- │   reopen_reason  text (motivo obligatorio, forzado por la RPC)           │
-- │                                                                          │
-- │ Se preserva historial en la misma fila; NO se crea tabla de log         │
-- │ separada. Motivo: reapertura es un evento raro (típicamente 1 por       │
-- │ liquidación, si sucede). Múltiples reaperturas sobre la misma fila      │
-- │ pisan las columnas — el uso repetido es señal de un problema mayor      │
-- │ (una fila que se abre y cierra muchas veces es un smell de flujo mal   │
-- │ definido, no de tabla mal diseñada).                                    │
-- │                                                                          │
-- │ RPC `reopen_launch_settlement(id, reason)`:                             │
-- │   - `security invoker` — corre bajo el rol del llamante, RLS aplica.    │
-- │   - Guard 1: motivo no vacío (validado antes de tocar DB).              │
-- │   - Guard 2: fila existe (`for update` para lockear).                   │
-- │   - Guard 3: `status = 'liquidada'`. No aceptamos 'abierta' (no hay    │
-- │     nada que reabrir) ni 'transferida' (la plata ya salió; reabrir     │
-- │     dejaría un `client_transfers` fantasma que ya está pagado).        │
-- │   - Guard 4: si existe un `client_transfers` con `bank_movement_id`    │
-- │     NOT NULL para este settlement, RAISE. Es defensa en profundidad:   │
-- │     status='liquidada' NO debería tener un bm_id linkeado (la RPC 0102 │
-- │     mueve el status a 'transferida' al linkearlo), pero blindamos ante │
-- │     escrituras manuales por SQL directo.                                │
-- │   - UPDATE: `status='abierta'`, `closed_at=null`, popula reopened_*.   │
-- │   - DELETE: borra los `client_transfers` auto-creados con              │
-- │     `direction='a_favor_cliente' AND bank_movement_id IS NULL` para    │
-- │     este settlement. Los que tienen bm_id NOT NULL ya rebotaron en el  │
-- │     guard anterior; los de otras direcciones (si existen manuales) NO  │
-- │     se tocan por seguridad — el operador los decide.                   │
-- │                                                                          │
-- │ El CHECK 0099 (closed_at ↔ status) ya anticipa este flujo: acepta       │
-- │ pasar de (liquidada, closed_at=X) a (abierta, closed_at=NULL). Ver     │
-- │ nota "NO IMPIDE REAPERTURA" en 0099.                                    │
-- │                                                                          │
-- │ ROL — la RPC no chequea rol explícitamente; se apoya en la RLS          │
-- │ (`can_edit_organization`) + el gate de UI (`requireRole` en la server   │
-- │ action). El escenario en el que la RLS no alcanza es "usuario admin de │
-- │ la org que no debería reabrir" — el gate de la UI cubre eso. Añadir un │
-- │ chequeo de profiles.role acá duplicaría lógica de auth en SQL.         │
-- │                                                                          │
-- │ DISEÑO DE COMPLEMENTARIA                                                 │
-- │                                                                          │
-- │ Columna nueva en `launch_settlements`:                                   │
-- │   parent_settlement_id  uuid → launch_settlements(id) on delete set null│
-- │                                                                          │
-- │ Semántica: una complementaria es una liquidación adicional sobre el     │
-- │ mismo launch que agarra los pagos posteriores al cierre de la primera. │
-- │ El motor TS computa `newlyCollected = totalPayments - Σ prev.collected` │
-- │ y arma un snapshot derivado de la regla vigente:                        │
-- │                                                                          │
-- │   snapshot_complementaria = {                                            │
-- │     ...rule_actual,                                                      │
-- │     fixed_fee_per_launch: 0,   -- ya se cobró en la original            │
-- │     fixed_fee_per_sale:   0,   -- las sales viejas ya se cobraron       │
-- │     min_guarantee:        null -- una complementaria no garantiza piso  │
-- │   }                                                                      │
-- │                                                                          │
-- │ Solo `percent_of_collected` aplica sobre el delta. Esto matchea el      │
-- │ mundo real: "de la plata que entró tarde, Kingrow se queda con el X%". │
-- │ El snapshot se congela en la fila igual que en la original (0055).      │
-- │                                                                          │
-- │ FKs y borrado: `on delete set null` en parent — si alguien elimina la  │
-- │ original, las complementarias sobreviven como huérfanas trazables. El   │
-- │ dashboard puede mostrar "complementaria de liquidación eliminada".      │
-- │ Nunca cascade — perder complementarias por accidente sería peor.        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Columnas de auditoría de reapertura + link a padre para complementarias
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launch_settlements
  add column if not exists reopened_at   timestamptz,
  add column if not exists reopened_by   uuid
    references auth.users(id) on delete set null,
  add column if not exists reopen_reason text,
  add column if not exists parent_settlement_id uuid
    references public.launch_settlements(id) on delete set null;

comment on column public.launch_settlements.reopened_at is
  'Momento en que se reabrió esta liquidación (liquidada → abierta). '
  'NULL para filas que nunca se reabrieron.';

comment on column public.launch_settlements.reopened_by is
  'Usuario que ejecutó la reapertura. NULL para filas nunca reabiertas. '
  'on delete set null: si el usuario se elimina, la reapertura sigue trazable '
  'por reopened_at + reopen_reason.';

comment on column public.launch_settlements.reopen_reason is
  'Motivo textual obligatorio al reabrir. NULL para filas nunca reabiertas.';

comment on column public.launch_settlements.parent_settlement_id is
  'Link a la liquidación original si esta fila es una complementaria. '
  'NULL para liquidaciones originales.';

create index if not exists launch_settlements_parent_idx
  on public.launch_settlements(parent_settlement_id)
  where parent_settlement_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) RPC reopen_launch_settlement
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.reopen_launch_settlement(
  p_settlement_id  uuid,
  p_reason         text
)
returns public.launch_settlements
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_settlement       public.launch_settlements;
  v_transferred_rows int;
begin
  -- ─── Guard 1: motivo obligatorio ─────────────────────────────────────
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo de reapertura es obligatorio.'
      using errcode = 'check_violation', detail = 'reopen-reason-required';
  end if;

  -- ─── Guard 2: fila existe + lock ─────────────────────────────────────
  select *
    into v_settlement
    from public.launch_settlements
   where id = p_settlement_id
   for update;

  if not found then
    raise exception 'No existe la liquidación indicada.'
      using errcode = 'no_data_found', detail = 'settlement-not-found';
  end if;

  -- ─── Guard 3: status debe ser 'liquidada' ────────────────────────────
  if v_settlement.status <> 'liquidada' then
    raise exception 'Solo se pueden reabrir liquidaciones en estado liquidada (actual: %).',
      v_settlement.status
      using errcode = 'check_violation', detail = 'settlement-not-liquidada';
  end if;

  -- ─── Guard 4: no debe haber client_transfers con bank_movement ───────
  -- Defensa en profundidad. status='liquidada' NO debería tener bm_id
  -- linkeado (0102 mueve a transferida al linkear), pero si alguien
  -- escribió por SQL directo, bloqueamos la reapertura porque la plata
  -- ya salió y borrar el a_favor_cliente sería inconsistente.
  select count(*)
    into v_transferred_rows
    from public.client_transfers
   where launch_settlement_id = v_settlement.id
     and bank_movement_id is not null;

  if v_transferred_rows > 0 then
    raise exception
      'La liquidación tiene movimientos bancarios linkeados (% filas). No se puede reabrir sin desvincularlos primero.',
      v_transferred_rows
      using errcode = 'check_violation', detail = 'settlement-has-bank-movements';
  end if;

  -- ─── UPDATE: liquidada → abierta + auditoría ─────────────────────────
  update public.launch_settlements
     set status         = 'abierta',
         closed_at      = null,
         reopened_at    = now(),
         reopened_by    = auth.uid(),
         reopen_reason  = btrim(p_reason)
   where id = v_settlement.id
  returning * into v_settlement;

  -- ─── DELETE: borrar client_transfers auto-creados por 0100 ───────────
  -- Solo los a_favor_cliente sin bank_movement (el auto-creado por
  -- close_launch_settlement). Los que un operador cargó manualmente con
  -- otra dirección o con bm_id linkeado quedan intactos.
  delete from public.client_transfers
   where launch_settlement_id = v_settlement.id
     and direction            = 'a_favor_cliente'
     and bank_movement_id is null;

  return v_settlement;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants — mismo patrón que 0100 y 0102
-- ═══════════════════════════════════════════════════════════════════════════
revoke execute on function public.reopen_launch_settlement(uuid, text)
  from public;

revoke execute on function public.reopen_launch_settlement(uuid, text)
  from cliente_role;

grant execute on function public.reopen_launch_settlement(uuid, text)
  to authenticated;
