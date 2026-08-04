import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Renovaciones · Clientes" };

/**
 * Renovaciones globales del módulo Clientes — placeholder de andamio.
 *
 * En el commit siguiente: tabla de renewals con filtros por status y
 * cliente + drawer. Alimentado por la tabla `renewals` (migración 0083).
 * Invariantes que enforza la DB y el drawer:
 *   - period_start ≤ period_end
 *   - status='cobrada' ↔ collected_at IS NOT NULL
 *   - loss_reason IS NULL unless status='perdida'
 *
 * La renewal es el contrato PERIÓDICO Kingrow→cliente (MRR/ARR). Distinta
 * de `invoices` (fee suelto) y de `client_transfers` (plata devuelta al
 * externo del split).
 */
export default function RenovacionesPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Renovaciones"
        stats={[
          { l: "Activas", v: fCount(0) },
          { l: "Cobradas", v: fMoney(0) },
          { l: "En pipeline", v: fMoney(0) },
        ]}
      />
      <Panel title="Renovaciones">
        <EmptyState
          icon={<IconCli size={22} />}
          title="Sin renovaciones cargadas"
          hint="Una renovación es un contrato periódico que el cliente paga por gestionarlo (mensual, trimestral, anual). Se carga con período, monto, moneda y estado — solo las cobradas cuentan en el LTV."
        />
      </Panel>
    </div>
  );
}
