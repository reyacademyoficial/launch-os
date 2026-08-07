import "server-only";

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

/**
 * PDF del "Reporte de facturas" — versión imprimible del listado que ya se
 * muestra en /financiero/reportes/facturas.
 *
 * Consume el mismo shape que produce `buildInvoiceReport`. El route handler
 * hidrata y pasa. Header + grid de totales por status × moneda + tabla
 * detallada. La tabla se pagina en 40 filas por página del PDF para no
 * cortar filas a la mitad.
 */

const COLORS = {
  brand: "#FF006E",
  success: "#00D084",
  warning: "#FFB800",
  error: "#EF4444",
  info: "#4078FF",
  fg: "#0F0F12",
  fgMuted: "#52525B",
  fgSubtle: "#A1A1AA",
  border: "#E4E4E7",
  surface: "#FAFAFA",
} as const;

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLORS.fg,
  },
  brandBar: {
    height: 4,
    backgroundColor: COLORS.brand,
    marginBottom: 16,
  },
  header: { marginBottom: 14 },
  eyebrow: {
    fontSize: 8,
    color: COLORS.fgSubtle,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    marginBottom: 2,
  },
  subtitle: { fontSize: 9, color: COLORS.fgMuted },

  bucketsGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  bucketCard: {
    width: "32.5%",
    padding: 8,
    borderRadius: 4,
    borderLeftWidth: 3,
    backgroundColor: COLORS.surface,
  },
  bucketLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  bucketAmount: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    fontVariantNumeric: "tabular-nums",
  },
  bucketMeta: {
    fontSize: 8,
    color: COLORS.fgMuted,
    marginTop: 3,
  },

  sectionTitle: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 4,
    paddingTop: 2,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    paddingVertical: 3,
  },
  th: {
    fontSize: 7,
    color: COLORS.fgMuted,
    textTransform: "uppercase",
  },
  tc: { fontSize: 8 },
  tcNum: {
    fontSize: 8,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },

  colDate: { width: "9%" },
  colNumber: { width: "9%" },
  colProject: { width: "14%" },
  colBuyer: { width: "18%" },
  colStatus: { width: "10%" },
  colCurrency: { width: "6%" },
  colAmount: { width: "12%", textAlign: "right" },
  colFee: { width: "10%", textAlign: "right" },
  colDue: { width: "12%" },

  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 7,
    color: COLORS.fgSubtle,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
});

// ─── Input ────────────────────────────────────────────────────────────────

export type InvoicePdfStatus = "emitida" | "cobrada" | "vencida" | "anulada";

export interface InvoiceReportPdfBucket {
  readonly status: InvoicePdfStatus;
  readonly currency: string;
  readonly count: number;
  readonly amountGross: number;
  readonly gatewayFee: number;
}

export interface InvoiceReportPdfDetailRow {
  readonly invoiceNumber: string | null;
  readonly issueDate: string;
  readonly dueDate: string | null;
  readonly status: InvoicePdfStatus;
  readonly currency: string;
  readonly amountGross: number;
  readonly gatewayFee: number | null;
  readonly projectName: string;
  readonly buyerName: string | null;
}

export interface InvoiceReportPdfInput {
  readonly orgName: string;
  readonly periodLabel: string;
  readonly generatedAt: Date;
  readonly buckets: readonly InvoiceReportPdfBucket[];
  readonly detail: readonly InvoiceReportPdfDetailRow[];
}

// ─── Documento ────────────────────────────────────────────────────────────

export function InvoiceReportDocument({
  data,
}: {
  readonly data: InvoiceReportPdfInput;
}) {
  const orderStatus: Record<InvoicePdfStatus, number> = {
    cobrada: 0,
    emitida: 1,
    vencida: 2,
    anulada: 3,
  };
  const sortedBuckets = [...data.buckets].sort(
    (a, b) =>
      orderStatus[a.status] - orderStatus[b.status] ||
      a.currency.localeCompare(b.currency),
  );

  return (
    <Document title={`Reporte de facturas — ${data.periodLabel}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        <View style={styles.header}>
          <Text style={styles.eyebrow}>Reporte financiero</Text>
          <Text style={styles.title}>Facturas</Text>
          <Text style={styles.subtitle}>
            {data.orgName} · {data.periodLabel} · {data.detail.length}{" "}
            factura{data.detail.length === 1 ? "" : "s"}
          </Text>
        </View>

        {/* Grid de buckets */}
        <Text style={styles.sectionTitle}>Totales por estado y moneda</Text>
        {sortedBuckets.length === 0 ? (
          <Text style={{ ...styles.tc, color: COLORS.fgMuted }}>
            Sin facturas en este rango.
          </Text>
        ) : (
          <View style={styles.bucketsGrid}>
            {sortedBuckets.map((b) => {
              const spec = statusSpec(b.status);
              return (
                <View
                  key={`${b.status}-${b.currency}`}
                  style={{
                    ...styles.bucketCard,
                    borderLeftColor: spec.color,
                  }}
                >
                  <Text
                    style={{ ...styles.bucketLabel, color: spec.color }}
                  >
                    {spec.label} · {b.currency}
                  </Text>
                  <Text style={styles.bucketAmount}>
                    {money(b.amountGross, b.currency)}
                  </Text>
                  <Text style={styles.bucketMeta}>
                    {b.count} factura{b.count === 1 ? "" : "s"}
                    {b.gatewayFee > 0 &&
                      ` · Comisión ${money(b.gatewayFee, b.currency)}`}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Detalle */}
        <Text style={styles.sectionTitle}>Detalle</Text>
        <View style={styles.tableHeader}>
          <Text style={{ ...styles.th, ...styles.colDate }}>Emisión</Text>
          <Text style={{ ...styles.th, ...styles.colNumber }}>Nº</Text>
          <Text style={{ ...styles.th, ...styles.colProject }}>Proyecto</Text>
          <Text style={{ ...styles.th, ...styles.colBuyer }}>Comprador</Text>
          <Text style={{ ...styles.th, ...styles.colStatus }}>Estado</Text>
          <Text style={{ ...styles.th, ...styles.colCurrency }}>Mon.</Text>
          <Text style={{ ...styles.th, ...styles.colAmount }}>Monto</Text>
          <Text style={{ ...styles.th, ...styles.colFee }}>Comis.</Text>
          <Text style={{ ...styles.th, ...styles.colDue }}>Vence</Text>
        </View>
        {data.detail.length === 0 ? (
          <View style={styles.tableRow}>
            <Text
              style={{ ...styles.tc, color: COLORS.fgMuted, padding: 8 }}
            >
              Sin facturas en el rango.
            </Text>
          </View>
        ) : (
          data.detail.map((r, idx) => (
            <View key={idx} style={styles.tableRow} wrap={false}>
              <Text style={{ ...styles.tc, ...styles.colDate }}>
                {fmtDate(r.issueDate)}
              </Text>
              <Text style={{ ...styles.tc, ...styles.colNumber }}>
                {r.invoiceNumber ?? "—"}
              </Text>
              <Text style={{ ...styles.tc, ...styles.colProject }}>
                {truncate(r.projectName, 22)}
              </Text>
              <Text style={{ ...styles.tc, ...styles.colBuyer }}>
                {truncate(r.buyerName ?? "—", 28)}
              </Text>
              <Text
                style={{
                  ...styles.tc,
                  ...styles.colStatus,
                  color: statusSpec(r.status).color,
                  fontFamily: "Helvetica-Bold",
                }}
              >
                {statusSpec(r.status).label}
              </Text>
              <Text style={{ ...styles.tc, ...styles.colCurrency }}>
                {r.currency}
              </Text>
              <Text style={{ ...styles.tcNum, ...styles.colAmount }}>
                {money(r.amountGross, r.currency)}
              </Text>
              <Text
                style={{
                  ...styles.tcNum,
                  ...styles.colFee,
                  color: COLORS.fgMuted,
                }}
              >
                {r.gatewayFee != null ? money(r.gatewayFee, r.currency) : "—"}
              </Text>
              <Text style={{ ...styles.tc, ...styles.colDue }}>
                {r.dueDate ? fmtDate(r.dueDate) : "—"}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.footer} fixed>
          Generado {fmtTimestamp(data.generatedAt)} · {data.orgName}
        </Text>
      </Page>
    </Document>
  );
}

// ─── Renderer público ──────────────────────────────────────────────────────

export async function renderInvoiceReportPdf(
  input: InvoiceReportPdfInput,
): Promise<Buffer> {
  const stream = await pdf(<InvoiceReportDocument data={input} />).toBuffer();
  return streamToBuffer(stream);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ─── helpers ───────────────────────────────────────────────────────────────

function statusSpec(status: InvoicePdfStatus): {
  label: string;
  color: string;
} {
  if (status === "cobrada") return { label: "Cobrada", color: COLORS.success };
  if (status === "vencida") return { label: "Vencida", color: COLORS.warning };
  if (status === "anulada") return { label: "Anulada", color: COLORS.error };
  return { label: "Emitida", color: COLORS.fgMuted };
}

function money(n: number, currency: string): string {
  const prefix =
    currency === "USD" ? "US$ " : currency === "EUR" ? "€ " : "AR$ ";
  return (
    prefix +
    n.toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function fmtTimestamp(d: Date): string {
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
