-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 6d-D (Kingrow) — RPC atómica: transfer_to_client                  │
-- │                                                                          │
-- │ CONTEXTO                                                                 │
-- │ Cuando cerrás una liquidación de un proyecto EXTERNO con saldo a favor   │
-- │ del cliente, la RPC `close_launch_settlement` (0100) genera              │
-- │ automáticamente un `client_transfers` con direction='a_favor_cliente'.   │
-- │ Ese devengo aparece en cuentas por pagar del dashboard financiero —      │
-- │ Kingrow le debe esa plata al cliente.                                    │
-- │                                                                          │
-- │ Cuando efectivamente le transferimos la plata al cliente, hay que        │
-- │ registrar DOS escrituras coordinadas:                                    │
-- │   1. bank_movement con kind='out' que sale del banco elegido.            │
-- │   2. client_transfers con direction='transferido' que apunta a ese       │
-- │      movimiento vía bank_movement_id.                                    │
-- │                                                                          │
-- │ Además, si con esta transferencia se cancela toda la deuda pendiente     │
-- │ del settlement, la liquidación pasa a status='transferida' (estado       │
-- │ final del ciclo definido en 0055).                                       │
-- │                                                                          │
-- │ Sin transacción, si el UPDATE del status falla después de los INSERT, la │
-- │ contabilidad queda coherente (el saldo de client_transfers se recalcula) │
-- │ PERO el status del settlement no refleja la realidad. Peor: si el        │
-- │ INSERT del client_transfers falla después del bank_movement, tenemos     │
-- │ plata que salió del banco sin trazabilidad hacia el cliente. Estado      │
-- │ malo. Por eso la operación va toda dentro del mismo cuerpo de función.  │
-- │                                                                          │
-- │ QUÉ VALIDA (adicional a RLS y los CHECK/FK del schema)                  │
-- │   1. Settlement existe.                                                  │
-- │   2. Settlement en status='liquidada'. No aceptamos 'abierta' (no está  │
-- │      cerrada) ni 'transferida' (ya se transfirió todo, no queda nada).  │
-- │   3. Proyecto del settlement es 'externa'. Los proyectos propios no     │
-- │      generan client_transfers (owed_to_client es para propietaria       │
-- │      interna); esta RPC no aplica.                                       │
-- │   4. Saldo pendiente > 0. El pendiente se calcula como                   │
-- │      Σ a_favor_cliente − Σ transferido para este settlement. Si es 0    │
-- │      o negativo, no hay nada para transferir.                            │
-- │   5. Bank existe y pertenece a la misma organización que el settlement. │
-- │      El schema post-0101 tiene banks org-scope; esta validación blinda  │
-- │      contra un payload manipulado que apunte a un banco de otra org.    │
-- │                                                                          │
-- │ DECISIÓN: transferencia TOTAL, no parcial                                │
-- │ Esta RPC transfiere TODO el saldo pendiente en una sola operación. Es la │
-- │ semántica más simple y cubre el 95% de casos ("le transfiero al cliente │
-- │ lo que le debo"). Transferencias parciales requieren otro flujo —        │
-- │ probable UX: cargar bank_movement manual + link con client_transfer      │
-- │ manual. Bloque futuro si aparece el caso.                                │
-- │                                                                          │
-- │ POST-CONDICIÓN                                                           │
-- │ Después de esta RPC, el status del settlement es SIEMPRE 'transferida'  │
-- │ (porque transferimos todo el saldo pendiente y no queda nada). Esto     │
-- │ cumple el invariante 0099 (transferida → closed_at IS NOT NULL, que ya  │
-- │ era true post-liquidada).                                               │
-- │                                                                          │
-- │ SEGURIDAD                                                                │
-- │   - security invoker: RLS del llamante se aplica a los inserts/update.  │
-- │   - set search_path = public, pg_temp: práctica estándar del linter.    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.transfer_to_client(
  p_launch_settlement_id  uuid,
  p_bank_id               uuid,
  p_transferred_at        timestamptz default now()
)
returns public.launch_settlements
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_settlement    public.launch_settlements;
  v_ownership     text;
  v_pending       numeric;
  v_bank_org      uuid;
  v_bank_movement_id uuid;
begin
  -- ─── Lock + fetch de la fila del settlement ────────────────────────────
  -- for update bloquea que dos transferencias simultáneas ganen las dos.
  select *
    into v_settlement
    from public.launch_settlements
   where id = p_launch_settlement_id
   for update;

  if not found then
    raise exception 'No existe la liquidación indicada.'
      using errcode = 'no_data_found', detail = 'settlement-not-found';
  end if;

  -- ─── Guard: settlement en 'liquidada' ──────────────────────────────────
  if v_settlement.status <> 'liquidada' then
    raise exception 'Esta liquidación no está en estado liquidada.'
      using errcode = 'check_violation', detail = 'settlement-not-liquidada';
  end if;

  -- ─── Guard: proyecto externo (los propios no generan client_transfers) ─
  select ownership
    into v_ownership
    from public.projects
   where id = v_settlement.project_id;

  if v_ownership <> 'externa' then
    raise exception 'La liquidación es de un proyecto propio, no requiere transferencia.'
      using errcode = 'check_violation', detail = 'project-not-external';
  end if;

  -- ─── Guard: saldo pendiente > 0 ────────────────────────────────────────
  -- Pendiente = Σ a_favor_cliente − Σ transferido para este settlement.
  -- Al cerrar la liquidación (0100), se insertó un a_favor_cliente por
  -- owed_to_client. Si nunca se transfirió antes, el pendiente es igual a
  -- owed_to_client. Si hubo transferencias parciales fuera de esta RPC
  -- (ajustes manuales), acá quedaría el remanente.
  select coalesce(sum(
    case
      when direction = 'a_favor_cliente' then amount
      when direction = 'transferido'     then -amount
      else 0
    end
  ), 0)
    into v_pending
    from public.client_transfers
   where launch_settlement_id = v_settlement.id;

  if v_pending <= 0 then
    raise exception 'No hay saldo pendiente de transferir para esta liquidación.'
      using errcode = 'check_violation', detail = 'no-pending-balance';
  end if;

  -- ─── Guard: bank pertenece a la misma organización ─────────────────────
  select organization_id
    into v_bank_org
    from public.banks
   where id = p_bank_id;

  if not found then
    raise exception 'El banco elegido no existe.'
      using errcode = 'no_data_found', detail = 'bank-not-found';
  end if;

  if v_bank_org <> v_settlement.organization_id then
    raise exception 'El banco elegido no pertenece a la organización del settlement.'
      using errcode = 'check_violation', detail = 'bank-org-mismatch';
  end if;

  -- ─── Escritura 1/3: bank_movement OUT ──────────────────────────────────
  insert into public.bank_movements (
    bank_id,
    organization_id,
    kind,
    amount,
    occurred_at,
    description
  ) values (
    p_bank_id,
    v_settlement.organization_id,
    'out',
    v_pending,
    p_transferred_at::date,
    'Transferencia a cliente por cierre de liquidación'
  )
  returning id into v_bank_movement_id;

  -- ─── Escritura 2/3: client_transfers 'transferido' ─────────────────────
  insert into public.client_transfers (
    organization_id,
    project_id,
    launch_settlement_id,
    bank_movement_id,
    amount,
    direction,
    date,
    notes
  ) values (
    v_settlement.organization_id,
    v_settlement.project_id,
    v_settlement.id,
    v_bank_movement_id,
    v_pending,
    'transferido',
    p_transferred_at::date,
    'Transferencia generada por transfer_to_client'
  );

  -- ─── Escritura 3/3: settlement pasa a 'transferida' ────────────────────
  -- Post-condición: SIEMPRE queda 'transferida' porque transferimos TODO
  -- el pendiente. Si mañana implementamos transferencias parciales, el
  -- UPDATE del status va condicional a "el nuevo pendiente = 0".
  update public.launch_settlements
     set status = 'transferida'
   where id = v_settlement.id
  returning * into v_settlement;

  return v_settlement;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants — mismo patrón que 0100 (close_launch_settlement)
-- ═══════════════════════════════════════════════════════════════════════════
revoke execute on function public.transfer_to_client(uuid, uuid, timestamptz)
  from public;

revoke execute on function public.transfer_to_client(uuid, uuid, timestamptz)
  from cliente_role;

grant execute on function public.transfer_to_client(uuid, uuid, timestamptz)
  to authenticated;
