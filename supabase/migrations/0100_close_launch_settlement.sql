-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 6c-c (Kingrow) — RPC atómica: close_launch_settlement             │
-- │                                                                          │
-- │ Cerrar una liquidación es de una sola operación semántica, pero de dos │
-- │ escrituras: (1) UPDATE del launch_settlement a `liquidada` y (2) INSERT│
-- │ en client_transfers con direction='a_favor_cliente' cuando el proyecto │
-- │ es externo y quedó saldo a favor del cliente.                          │
-- │                                                                          │
-- │ Sin transacción cliente, si el INSERT falla después del UPDATE, la     │
-- │ liquidación queda cerrada pero la obligación NO queda registrada. El   │
-- │ dashboard financiero muestra que Kingrow debe menos de lo que debe     │
-- │ — porque `computeAccountsPayable` lee `client_transfers`. Estado malo.  │
-- │                                                                          │
-- │ Esta RPC hace las dos escrituras dentro del mismo cuerpo (todo cuerpo  │
-- │ de función es atómico) y expone la operación al server action.         │
-- │                                                                          │
-- │ QUÉ VALIDA (adicional al CHECK 0099 y a las policies de RLS)            │
-- │   1. La fila existe (rebote temprano con mensaje útil).                 │
-- │   2. `status = 'abierta'`. Sin esto, un doble-click podría cerrar dos  │
-- │      veces o cerrar una fila que ya está `transferida`. El mensaje va  │
-- │      con detalle=`settlement-not-open` para que el server action lo    │
-- │      traduzca a copy específico.                                        │
-- │   3. `p_closed_at IS NOT NULL`. El CHECK 0099 también lo enforza, pero │
-- │      erroramos acá para que el mensaje sea entendible antes de que la │
-- │      violación de constraint devuelva un texto genérico de Postgres.   │
-- │   Nada de esto reemplaza la RLS ni el CHECK — es la primera línea de   │
-- │   defensa con mensajes en castellano.                                   │
-- │                                                                          │
-- │ TRANSICIÓN transferida — NO IMPLEMENTADA                                │
-- │   Esta RPC solo cubre `abierta → liquidada`. El paso a `transferida`   │
-- │   requiere linkear un `bank_movements.id` real (el movimiento que      │
-- │   materializa la transferencia al cliente), y eso implica un bloque    │
-- │   aparte con su propio server action y validaciones. Cuando exista,    │
-- │   será una nueva RPC `transfer_launch_settlement(uuid, uuid)` (id del  │
-- │   settlement + id del bank_movement). Este archivo no la contempla a   │
-- │   propósito — mejor no ofrecer una transición que no está definida.   │
-- │                                                                          │
-- │ REABRIR — NO IMPLEMENTADO Y NO PLANEADO                                 │
-- │   Ninguna RPC de este módulo escribe la transición inversa. Si una     │
-- │   liquidación quedó mal, la decisión de negocio es anularla y crear    │
-- │   otra (bloque aparte). Ver nota en 0099.                               │
-- │                                                                          │
-- │ CLIENT TRANSFER AUTO-GENERADO                                            │
-- │   Se inserta SOLO si:                                                    │
-- │     · owed_to_client > 0 (algo hay para devolver), Y                    │
-- │     · projects.ownership = 'externa'.                                    │
-- │   Rey Academy, Growins y Kingrow son 'propia' → no se genera nada; el │
-- │   `owed_to_client` de esas liquidaciones es interno (Kingrow le pasa   │
-- │   plata a "sí misma" como propietaria del proyecto propio, no hay      │
-- │   deuda con un tercero).                                                │
-- │                                                                          │
-- │ SEGURIDAD                                                                │
-- │   - security invoker: mismas policies de launch_settlements y          │
-- │     client_transfers (can_edit_organization) al UPDATE y al INSERT.    │
-- │     Sin bypass de RLS.                                                  │
-- │   - set search_path = public, pg_temp: práctica estándar del linter.  │
-- │                                                                          │
-- │ CONCURRENCIA                                                             │
-- │   `select ... for update` sobre la fila del settlement bloquea que dos │
-- │   cierres simultáneos ganen los dos. El segundo entra al lock, espera, │
-- │   y cuando lee vuelve a ver `status = 'liquidada'` — cae en el guard   │
-- │   de "settlement-not-open" y rebota con mensaje claro.                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.close_launch_settlement(
  p_launch_settlement_id  uuid,
  p_closed_at             timestamptz
)
returns public.launch_settlements
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_settlement    public.launch_settlements;
  v_ownership     text;
begin
  -- ─── Guard: closed_at obligatorio ────────────────────────────────────
  if p_closed_at is null then
    raise exception 'La fecha de cierre es obligatoria.'
      using errcode = 'check_violation', detail = 'closed-at-required';
  end if;

  -- ─── Lock + fetch de la fila ──────────────────────────────────────────
  -- `for update` toma el lock a nivel fila. Un segundo cierre simultáneo
  -- espera acá y al continuar ve status='liquidada' → falla el guard de
  -- abajo con mensaje entendible en vez de con carrera silenciosa.
  select *
    into v_settlement
    from public.launch_settlements
   where id = p_launch_settlement_id
   for update;

  if not found then
    raise exception 'No existe la liquidación indicada.'
      using errcode = 'no_data_found', detail = 'settlement-not-found';
  end if;

  -- ─── Guard: solo se cierra desde 'abierta' ───────────────────────────
  -- No aceptamos 'liquidada' (nada que hacer) ni 'transferida' (el paso
  -- a transferida es otra transición, otra RPC — cuando exista).
  if v_settlement.status <> 'abierta' then
    raise exception 'Esta liquidación no está abierta.'
      using errcode = 'check_violation', detail = 'settlement-not-open';
  end if;

  -- ─── UPDATE: abierta → liquidada ─────────────────────────────────────
  -- El CHECK 0099 (closed_at ↔ status) valida la combinación en DB.
  update public.launch_settlements
     set status     = 'liquidada',
         closed_at  = p_closed_at
   where id = v_settlement.id
  returning * into v_settlement;

  -- ─── Devengo automático a favor del cliente (si aplica) ──────────────
  -- Ownership del proyecto lee de public.projects. RLS del select se
  -- aplica al llamante — un usuario con permisos de org sobre el
  -- settlement necesariamente tiene visibilidad del project (misma org).
  select ownership
    into v_ownership
    from public.projects
   where id = v_settlement.project_id;

  if v_settlement.owed_to_client > 0
     and v_ownership = 'externa'
  then
    insert into public.client_transfers (
      organization_id,
      project_id,
      launch_settlement_id,
      bank_movement_id,   -- NULL a propósito: aún no hay movimiento
      amount,
      direction,
      date,
      notes
    ) values (
      v_settlement.organization_id,
      v_settlement.project_id,
      v_settlement.id,
      null,
      v_settlement.owed_to_client,
      'a_favor_cliente',
      p_closed_at::date,
      'Devengo automático al cerrar la liquidación'
    );
  end if;

  return v_settlement;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants — mismo patrón que 0097 (rotate_settlement_rule)
-- ═══════════════════════════════════════════════════════════════════════════
revoke execute on function public.close_launch_settlement(uuid, timestamptz)
  from public;

revoke execute on function public.close_launch_settlement(uuid, timestamptz)
  from cliente_role;

grant execute on function public.close_launch_settlement(uuid, timestamptz)
  to authenticated;
