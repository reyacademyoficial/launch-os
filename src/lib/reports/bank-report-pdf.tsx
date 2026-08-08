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
 * PDF del "Reporte de bancos" — versión imprimible del listado que ya se
 * muestra en /financiero/reportes/bancos.
 *
 * Consume el mismo shape (`byBank`, `consolidated`) que produce
 * `buildBankReport` — el route handler hidrata y pasa. Tablas server-side
 * ordenadas por banco, consolidado por moneda al final.
 */

const COLORS = {
  brand: "#FF006E",
  success: "#00D084",
  warning: "#FFB800",
  error: "#EF4444",
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

  totalsBar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
    gap: 8,
  },
  totalCell: { flex: 1 },
  totalLabel: {
    fontSize: 7,
    color: COLORS.fgMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  totalValue: { fontSize: 12, fontFamily: "Helvetica-Bold" },

  sectionTitle: {
    marginTop: 12,
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

  colBank: { width: "22%" },
  colCurrency: { width: "8%" },
  colOpening: { width: "13%", textAlign: "right" },
  colIn: { width: "13%", textAlign: "right" },
  colOut: { width: "13%", textAlign: "right" },
  colNet: { width: "13%", textAlign: "right" },
  colClosing: { width: "13%", textAlign: "right" },
  colConcil: { width: "10%", textAlign: "right" },

  // Consolidado
  consBox: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.brand,
    borderRadius: 4,
    backgroundColor: "#FFEBF4",
  },
  consLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand,
    marginBottom: 6,
  },
  consRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  consK: { fontSize: 9, color: COLORS.fgMuted },
  consV: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand,
    fontVariantNumeric: "tabular-nums",
  },

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

export interface BankReportPdfBucket {
  readonly bankName: string;
  readonly currency: "ARS" | "USD";
  readonly opening: number;
  readonly movementsIn: number;
  readonly movementsOut: number;
  readonly net: number;
  readonly closing: number;
  readonly movementCount: number;
  readonly linkedCount: number;
  readonly unconciledCount: number;
}

export interface BankReportPdfConsolidated {
  readonly currency: "ARS" | "USD";
  readonly opening: number;
  readonly movementsIn: number;
  readonly movementsOut: number;
  readonly net: number;
  readonly closing: number;
  readonly movementCount: number;
  readonly linkedCount: number;
}

export interface BankReportPdfInput {
  readonly orgName: string;
  readonly periodLabel: string;
  readonly generatedAt: Date;
  readonly byBank: readonly BankReportPdfBucket[];
  readonly consolidated: readonly BankReportPdfConsolidated[];
}

// ─── Documento ─────────────────────────────────────────────────────────────

export function BankReportDocument({
  data,
}: {
  readonly data: BankReportPdfInput;
}) {
  const totalMovements = data.byBank.reduce((a, b) => a + b.movementCount, 0);
  const totalUnconciled = data.byBank.reduce(
    (a, b) => a + b.unconciledCount,
    0,
  );

  return (
    <Document title={`Reporte de bancos — ${data.periodLabel}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        <View style={styles.header}>
          <Text style={styles.eyebrow}>Reporte financiero</Text>
          <Text style={styles.title}>Bancos</Text>
          <Text style={styles.subtitle}>
            {data.orgName} · {data.periodLabel}
          </Text>
        </View>

        <View style={styles.totalsBar}>
          <View style={styles.totalCell}>
            <Text style={styles.totalLabel}>Bancos</Text>
            <Text style={styles.totalValue}>{data.byBank.length}</Text>
          </View>
          <View style={styles.totalCell}>
            <Text style={styles.totalLabel}>Movimientos</Text>
            <Text style={styles.totalValue}>{totalMovements}</Text>
          </View>
          <View style={styles.totalCell}>
            <Text style={styles.totalLabel}>Sin conciliar</Text>
            <Text
              style={{
                ...styles.totalValue,
                color: totalUnconciled > 0 ? COLORS.warning : COLORS.fg,
              }}
            >
              {totalUnconciled}
            </Text>
          </View>
        </View>

        {/* Tabla por banco */}
        <Text style={styles.sectionTitle}>Por banco</Text>
        <View style={styles.tableHeader}>
          <Text style={{ ...styles.th, ...styles.colBank }}>Banco</Text>
          <Text style={{ ...styles.th, ...styles.colCurrency }}>Mon.</Text>
          <Text style={{ ...styles.th, ...styles.colOpening }}>Apertura</Text>
          <Text style={{ ...styles.th, ...styles.colIn }}>Ingresos</Text>
          <Text style={{ ...styles.th, ...styles.colOut }}>Egresos</Text>
          <Text style={{ ...styles.th, ...styles.colNet }}>Neto</Text>
          <Text style={{ ...styles.th, ...styles.colClosing }}>Cierre</Text>
          <Text style={{ ...styles.th, ...styles.colConcil }}>Concil.</Text>
        </View>
        {data.byBank.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={{ ...styles.tc, color: COLORS.fgMuted, padding: 8 }}>
              Sin bancos cargados.
            </Text>
          </View>
        ) : (
          data.byBank.map((b, idx) => (
            <View key={idx} style={styles.tableRow} wrap={false}>
              <Text style={{ ...styles.tc, ...styles.colBank }}>
                {b.bankName}
              </Text>
              <Text style={{ ...styles.tc, ...styles.colCurrency }}>
                {b.currency}
              </Text>
              <Text style={{ ...styles.tcNum, ...styles.colOpening }}>
                {money(b.opening, b.currency)}
              </Text>
              <Text style={{ ...styles.tcNum, ...styles.colIn }}>
                {money(b.movementsIn, b.currency)}
              </Text>
              <Text style={{ ...styles.tcNum, ...styles.colOut }}>
                {money(-b.movementsOut, b.currency)}
              </Text>
              <Text
                style={{
                  ...styles.tcNum,
                  ...styles.colNet,
                  color: b.net >= 0 ? COLORS.success : COLORS.error,
                }}
              >
                {money(b.net, b.currency)}
              </Text>
              <Text
                style={{
                  ...styles.tcNum,
                  ...styles.colClosing,
                  fontFamily: "Helvetica-Bold",
                }}
              >
                {money(b.closing, b.currency)}
              </Text>
              <Text
                style={{
                  ...styles.tcNum,
                  ...styles.colConcil,
                  color:
                    b.unconciledCount > 0 ? COLORS.warning : COLORS.fgMuted,
                }}
              >
                {b.movementCount > 0
                  ? `${b.linkedCount}/${b.movementCount}`
                  : "—"}
              </Text>
            </View>
          ))
        )}

        {/* Consolidado */}
        {data.consolidated.length > 0 && (
          <View style={styles.consBox} wrap={false}>
            <Text style={styles.consLabel}>Consolidado por moneda</Text>
            {data.consolidated.map((c) => (
              <View key={c.currency} style={{ marginBottom: 6 }}>
                <View style={styles.consRow}>
                  <Text
                    style={{
                      ...styles.consK,
                      fontFamily: "Helvetica-Bold",
                      color: COLORS.brand,
                    }}
                  >
                    {c.currency}
                  </Text>
                  <Text style={styles.consV}>
                    Cierre {money(c.closing, c.currency)}
                  </Text>
                </View>
                <View style={styles.consRow}>
                  <Text style={styles.consK}>Apertura</Text>
                  <Text style={{ ...styles.consK, color: COLORS.fg }}>
                    {money(c.opening, c.currency)}
                  </Text>
                </View>
                <View style={styles.consRow}>
                  <Text style={styles.consK}>Ingresos</Text>
                  <Text style={{ ...styles.consK, color: COLORS.success }}>
                    {money(c.movementsIn, c.currency)}
                  </Text>
                </View>
                <View style={styles.consRow}>
                  <Text style={styles.consK}>Egresos</Text>
                  <Text style={{ ...styles.consK, color: COLORS.error }}>
                    {money(-c.movementsOut, c.currency)}
                  </Text>
                </View>
                <View style={styles.consRow}>
                  <Text style={styles.consK}>Neto</Text>
                  <Text
                    style={{
                      ...styles.consK,
                      color: c.net >= 0 ? COLORS.success : COLORS.error,
                    }}
                  >
                    {money(c.net, c.currency)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer} fixed>
          Generado {fmtTimestamp(data.generatedAt)} · {data.orgName}
        </Text>
      </Page>
    </Document>
  );
}

// ─── Renderer público ──────────────────────────────────────────────────────

export async function renderBankReportPdf(
  input: BankReportPdfInput,
): Promise<Buffer> {
  const stream = await pdf(<BankReportDocument data={input} />).toBuffer();
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

function fmtTimestamp(d: Date): string {
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
