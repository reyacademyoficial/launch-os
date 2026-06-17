import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import type { ChannelsData } from "@/lib/analytics/channels";

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
 */
export function ChannelsTables({ data }: { readonly data: ChannelsData }) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header>
          <h2 className="text-base font-semibold text-fg">Canales pagos</h2>
          <p className="text-xs text-fg-subtle">
            Inversión y leads provenientes del ad spend por plataforma. La
            conversión a venta no se atribuye al canal pago en el modelo
            actual.
          </p>
        </header>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-3 font-medium">Canal</th>
                <th className="px-3 py-3 text-right font-medium">Leads</th>
                <th className="px-3 py-3 text-right font-medium">Inversión</th>
                <th className="px-3 py-3 text-right font-medium">CPL</th>
              </tr>
            </thead>
            <tbody>
              {data.paid.map((row) => (
                <tr key={row.channel} className="border-t border-border">
                  <td className="px-3 py-3 font-medium text-fg">{row.channel}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-fg">
                    {fmtNumber(row.leads)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-fg">
                    {fmtMoney(row.spend)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                    {row.leads > 0 ? fmtMoney(row.cpl) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <header>
          <h2 className="text-base font-semibold text-fg">
            Origen del lead
          </h2>
          <p className="text-xs text-fg-subtle">
            Leads, ventas y conversión por source. &ldquo;Reciclados&rdquo;
            agrupa los leads con traza de evergreen — cuenta también en su
            source original.
          </p>
        </header>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-3 font-medium">Origen</th>
                <th className="px-3 py-3 text-right font-medium">Leads</th>
                <th className="px-3 py-3 text-right font-medium">Ventas</th>
                <th className="px-3 py-3 text-right font-medium">Revenue</th>
                <th className="px-3 py-3 text-right font-medium">Conversión</th>
              </tr>
            </thead>
            <tbody>
              {data.bySource.map((row) => (
                <tr
                  key={row.source}
                  className={
                    "border-t border-border " +
                    (row.source === "reciclados"
                      ? "bg-accent/5 italic"
                      : "")
                  }
                >
                  <td className="px-3 py-3 font-medium text-fg">
                    {SOURCE_LABELS[row.source] ?? row.source}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-fg">
                    {fmtNumber(row.leads)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-fg">
                    {fmtNumber(row.sales)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-fg">
                    {fmtMoney(row.revenue)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                    {row.leads > 0 ? fmtPercent(row.conversion) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
