"use client";

import { HeroKpi } from "@/components/kg/hero-kpi";
import { SupportKpi } from "@/components/kg/support-kpi";
import { fmtNumber } from "@/lib/format";
import { fmtUsd } from "@/lib/money";

/**
 * Bento de KPIs de Cobros del proyecto.
 *
 * ¿Por qué un componente client y no JSX dentro de `cobros/page.tsx`?
 * `HeroKpi` y `SupportKpi` reciben `format` como FUNCIÓN, y las funciones no
 * cruzan el boundary RSC — una page server no se las puede pasar. Mismo corte
 * que `overview-kpis.tsx` y `kpi-grid.tsx`: la page (server) calcula y este
 * componente (client) elige el formateador y compone.
 *
 * Nada de lógica de negocio acá: los agregados en USD los arma
 * `buildSalesFxContext` en el server. Este archivo recibe números crudos.
 *
 * REPARTO CON EL CONTEXTBAR (por qué estos KPIs y no otros)
 * La barra sticky de la page ya NO repite estas cifras: se quedó con
 * "Pendiente" y "Avance" — las dos lecturas del saldo abierto que el operador
 * quiere pinneadas mientras scrollea 64 filas de cobros. Acá arriba vive la
 * foto que se lee una vez al entrar: cuánto se pactó, cuánto entró y el
 * volumen que hay detrás. Cero solapamiento entre las dos zonas.
 *
 * LA PLATA NO SE PINTA: todos los KPIs van en tono neutral. Financiar en
 * cuotas es lo normal en este negocio — un saldo abierto no es una alarma, y
 * teñir el monto de rojo/verde sería un semáforo falso. Ver `tone.ts`.
 */
export interface CobrosKpisData {
  /** Σ de `total_amount` de las ventas cerradas, convertida a USD. */
  readonly pledgedRevenue: number;
  /** Σ de los cobros registrados en esas ventas, convertida a USD. */
  readonly collectedRevenue: number;
  readonly salesCount: number;
  readonly paymentsCount: number;
}

export function CobrosKpis({ data }: { readonly data: CobrosKpisData }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Fila 1 · las dos cifras que se miran primero ── */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <HeroKpi
          label="Pactado"
          value={data.pledgedRevenue}
          format={fmtUsd}
          featured
          help="Suma de los montos pactados de las ventas cuyo lead está en la columna cerrado, convertida a USD con el contexto FX del proyecto."
        />
        <HeroKpi
          label="Cobrado"
          value={data.collectedRevenue}
          format={fmtUsd}
          help="Suma de los cobros registrados en esas ventas, convertida a USD con el contexto FX del proyecto."
        />
      </div>

      {/* ── Fila 2 · el volumen detrás de los montos ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SupportKpi
          label="Ventas cerradas"
          value={data.salesCount}
          format={fmtNumber}
          help="Ventas cuyo lead está en la columna cerrado del kanban. Es la misma definición que usa el KPI de revenue."
        />
        <SupportKpi
          label="Cobros cargados"
          value={data.paymentsCount}
          format={fmtNumber}
          help="Cantidad de pagos registrados contra esas ventas — no confundir con la cantidad de cuotas del plan."
        />
      </div>
    </div>
  );
}
