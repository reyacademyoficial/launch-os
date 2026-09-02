import { KgDataTable } from "@/components/kg/data-table";
import { Panel } from "@/components/kg/panel";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import type {
  ChannelsData,
  LeadSourceRow,
  PaidChannelRow,
} from "@/lib/analytics/channels";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  import: "Importado",
  meta: "Meta (ads)",
  ghl: "GHL",
  whatsapp: "WhatsApp",
  otro: "Otro",
  reciclados: "Reciclados (de evergreens)",
};

/**
 * Dos tablas en el tab Canales:
 *
 *   1. Top — por canal pago. Solo Meta/Google/TikTok. Spend/leads/CPL del
 *      daily aggregate. Sin ventas/conversion (no hay atribución
 *      sale → canal pago en el modelo).
 *   2. Bottom — por source del lead + "reciclados" sintético. Leads, ventas
 *      atribuibles (sales JOIN leads), revenue, conversion. "Reciclados"
 *      cuenta DOBLE (también aparece en su source original).
 *
 * ── Qué cambió al migrar al KG System ─────────────────────────────────────
 * Las dos `<table>` escritas a mano (`bg-surface` en el thead, `border-t
 * border-border` por fila, `text-fg` / `text-fg-muted` en las celdas, el
 * `overflow-x-auto rounded-md` a mano) pasan a `KgDataTable`, y el
 * `<section><header><h2>+<p>` que las titulaba pasa a `Panel` con título de
 * dos líneas — el mismo molde de `kpi/page.tsx`. El scroll horizontal ahora
 * lo maneja la tabla dentro de su propio contenedor: el body de la página no
 * scrollea de costado ni en 390px.
 *
 * `numeric: true` en las columnas de números activa `kg-num` + tabular-nums,
 * que es lo que hacía el `tabular-nums` suelto de antes, pero derivado de la
 * definición de la columna (así el header, la celda y el total no pueden
 * desalinearse entre sí).
 *
 * El archivo se queda como SERVER component: `data-table.tsx` no lleva
 * "use client" ni un solo hook justamente para esto, y acá no hay nada
 * interactivo. Cero JS de cliente para dos tablas de lectura.
 *
 * `Panel` NO usa `fillHeight` y las tablas tampoco: son dos tablas apiladas
 * en una página que scrollea entera. Con `fillHeight` la segunda quedaría
 * fuera del viewport y sin altura que repartir.
 */
export function ChannelsTables({ data }: { readonly data: ChannelsData }) {
  // Totales del bloque de canales pagos. Meta/Google/TikTok son disjuntos:
  // ningún lead ni peso se cuenta dos veces, así que la suma significa algo.
  // El CPL total NO es el promedio de los tres CPL — es spend/leads agregado,
  // que es la única lectura correcta cuando los volúmenes son distintos.
  const paidLeads = data.paid.reduce((sum, r) => sum + r.leads, 0);
  const paidSpend = data.paid.reduce((sum, r) => sum + r.spend, 0);

  return (
    <div className="flex flex-col gap-5">
      <Panel
        pad={false}
        title={
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>Canales pagos</span>
            <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
              Inversión y leads provenientes del ad spend por plataforma. La
              conversión a venta no se atribuye al canal pago en el modelo
              actual.
            </span>
          </span>
        }
      >
        <KgDataTable<PaidChannelRow>
          rows={data.paid}
          rowKey={(r) => r.channel}
          emptyTitle="Sin canales pagos en el filtro"
          emptyHint="Cuando los lanzamientos elegidos tengan inversión cargada (manual o por API), acá aparecen Meta, Google y TikTok."
          columns={[
            {
              key: "channel",
              label: "Canal",
              render: (r) => r.channel,
            },
            {
              key: "leads",
              label: "Leads",
              align: "right",
              numeric: true,
              render: (r) => fmtNumber(r.leads),
            },
            {
              key: "spend",
              label: "Inversión",
              align: "right",
              numeric: true,
              render: (r) => fmtMoney(r.spend),
            },
            {
              key: "cpl",
              label: "CPL",
              align: "right",
              numeric: true,
              // Sin leads no hay CPL: "—" y no "$0". Un cero acá se leería
              // como "salió gratis".
              render: (r) => (r.leads > 0 ? fmtMoney(r.cpl) : "—"),
            },
          ]}
          totalsRow={{
            label: "Total",
            cells: {
              leads: fmtNumber(paidLeads),
              spend: fmtMoney(paidSpend),
              cpl: paidLeads > 0 ? fmtMoney(paidSpend / paidLeads) : "—",
            },
          }}
        />
      </Panel>

      <Panel
        pad={false}
        title={
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>Origen del lead</span>
            <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
              Leads, ventas y conversión por source. &ldquo;Reciclados&rdquo;
              agrupa los leads con traza de evergreen — cuenta también en su
              source original.
            </span>
          </span>
        }
      >
        {/*
          Esta tabla NO lleva `totalsRow`, a diferencia de la de arriba: los
          buckets no son disjuntos. "Reciclados" es una dimensión sintética
          que suma los mismos leads que ya se contaron en su source de origen,
          así que un total de columna daría un número más grande que la
          realidad. Antes la fila se marcaba tiñéndola (`bg-accent/5 italic`);
          ahora el caveat viaja como texto en la propia celda, que es
          accesible y no depende de percibir un tinte del 5%.
        */}
        <KgDataTable<LeadSourceRow>
          rows={data.bySource}
          rowKey={(r) => r.source}
          emptyTitle="Sin leads en el filtro"
          emptyHint="Ajustá el rango de fechas o los lanzamientos seleccionados para ver el desglose por origen."
          columns={[
            {
              key: "source",
              label: "Origen",
              render: (r) => (
                <span
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span>{SOURCE_LABELS[r.source] ?? r.source}</span>
                  {r.source === "reciclados" && (
                    <span
                      className="kg-t7"
                      style={{ color: "var(--kg-text-3)" }}
                    >
                      Cuenta también en su origen — no sumar con el resto
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "leads",
              label: "Leads",
              align: "right",
              numeric: true,
              render: (r) => fmtNumber(r.leads),
            },
            {
              key: "sales",
              label: "Ventas",
              align: "right",
              numeric: true,
              render: (r) => fmtNumber(r.sales),
            },
            {
              key: "revenue",
              label: "Revenue",
              align: "right",
              numeric: true,
              render: (r) => fmtMoney(r.revenue),
            },
            {
              key: "conversion",
              label: "Conversión",
              align: "right",
              numeric: true,
              // `conversion` viene en escala 0-100 desde `safePercent`, que es
              // lo que espera `fmtPercent` (NO `fPct`, que espera [0,1]).
              render: (r) => (r.leads > 0 ? fmtPercent(r.conversion) : "—"),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
