import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Upsells · Clientes" };

/**
 * Upsells globales del módulo Clientes — placeholder de andamio.
 *
 * En el commit siguiente: tabla de upsells con filtros por status y
 * cliente + drawer. Alimentado por la tabla `upsells` (migración 0084).
 * Invariantes iguales a renewals pero con `closed_at` en vez de
 * `collected_at`.
 *
 * Upsell = venta ADICIONAL a un cliente existente (nuevo producto,
 * expansión, segundo launch). Distinto de renewal (contrato periódico) y
 * de invoices (fee suelto). Solo las cobradas cuentan en el LTV.
 */
export default function UpsellsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Upsells"
        stats={[
          { l: "Cerrados", v: fCount(0) },
          { l: "Cobrados", v: fMoney(0) },
          { l: "En pipeline", v: fMoney(0) },
        ]}
      />
      <Panel title="Upsells">
        <EmptyState
          icon={<IconCli size={22} />}
          title="Sin upsells cargados"
          hint="Un upsell es una venta adicional sobre un cliente que ya está en el portfolio: gestión de comunidad, segundo lanzamiento, consultoría extra. Se registra con título, monto, moneda y estado del ciclo comercial."
        />
      </Panel>
    </div>
  );
}
