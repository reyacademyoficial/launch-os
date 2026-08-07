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
 * PDF "Remito de venta". Se emite desde /financiero/facturas y se envía al
 * comprador. Palabra "factura" NUNCA aparece en el documento — internamente
 * el registro sí es una `invoices` fila, pero externamente decimos "remito"
 * (regla cerrada con Finanzas: los remitos son documentos no-fiscales que
 * confirman la venta, sirven de comprobante al alumno sin implicar factura
 * fiscal, que la emitiría el ente contable aparte).
 *
 * Muestra: nº comprobante, fechas (emisión, compra, vencimiento, pago),
 * producto, comprador (nombre + email + documento opcionales), vendedor
 * (razón social de la organización), monto (bruto/IVA/neto), Nº transacción
 * si existe, notas.
 *
 * El PDF asume que el status ya está calculado por el trigger de 0117 —
 * lo muestra como badge ("Pagado" / "Pendiente" / "Anulado") sin recomputar.
 *
 * `renderInvoiceRemitoPdf` es el entry-point público. El route handler
 * hidrata el input y lo llama.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Estilos — mismo look que commissions-launch-pdf.
// ═══════════════════════════════════════════════════════════════════════════

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
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLORS.fg,
  },
  brandBar: {
    height: 4,
    backgroundColor: COLORS.brand,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "flex-end" },
  eyebrow: {
    fontSize: 8,
    color: COLORS.fgSubtle,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    marginBottom: 4,
  },
  sellerName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
  },
  sellerHint: {
    fontSize: 8,
    color: COLORS.fgMuted,
    marginTop: 2,
  },
  numberBox: {
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.brand,
    borderRadius: 4,
    minWidth: 130,
    alignItems: "flex-end",
  },
  numberLabel: {
    fontSize: 7,
    color: COLORS.fgMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  numberValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand,
    fontVariantNumeric: "tabular-nums",
  },
  statusBadge: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },

  section: {
    marginTop: 14,
  },
  sectionTitle: {
    fontSize: 8,
    color: COLORS.fgSubtle,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  twoCol: {
    flexDirection: "row",
    gap: 20,
  },
  colBox: {
    flex: 1,
    padding: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 4,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 8,
    color: COLORS.fgMuted,
  },
  fieldValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  productBox: {
    marginTop: 14,
    padding: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.brand,
  },
  productLabel: {
    fontSize: 8,
    color: COLORS.fgSubtle,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  productName: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },
  productDescription: {
    fontSize: 9,
    color: COLORS.fgMuted,
    marginTop: 4,
  },

  totalsBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalLabel: { fontSize: 9, color: COLORS.fgMuted },
  totalValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 6,
  },
  grandLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand,
  },
  grandValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand,
    fontVariantNumeric: "tabular-nums",
  },

  metaRow: {
    marginTop: 16,
    padding: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 4,
  },
  metaLine: {
    fontSize: 8,
    color: COLORS.fgMuted,
    marginBottom: 3,
  },
  notesBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
  },
  notesLabel: {
    fontSize: 8,
    color: COLORS.fgSubtle,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  notesBody: { fontSize: 9, color: COLORS.fgMuted, lineHeight: 1.4 },

  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7,
    color: COLORS.fgSubtle,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Input shape
// ═══════════════════════════════════════════════════════════════════════════

export interface InvoiceRemitoInput {
  readonly invoiceNumber: string;
  readonly status: "emitida" | "cobrada" | "vencida" | "anulada";
  readonly issueDate: string; // YYYY-MM-DD
  readonly purchaseDate: string | null;
  readonly dueDate: string | null;
  readonly paymentDate: string | null;
  readonly currency: string;
  readonly amountGross: number;
  readonly taxAmount: number;
  readonly buyer: {
    readonly name: string | null;
    readonly email: string | null;
    readonly document: string | null;
  };
  readonly seller: {
    readonly name: string;
    readonly businessName: string | null;
    readonly document: string | null;
  };
  readonly product: {
    readonly name: string | null;
    readonly description: string | null;
  };
  readonly transactionNumber: string | null;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Documento
// ═══════════════════════════════════════════════════════════════════════════

export function InvoiceRemitoDocument({
  data,
}: {
  readonly data: InvoiceRemitoInput;
}) {
  const amountNet = data.amountGross - data.taxAmount;
  const statusSpec = statusPill(data.status);
  return (
    <Document title={`Remito ${data.invoiceNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.eyebrow}>Remito de venta</Text>
            <Text style={styles.title}>Comprobante</Text>
            <Text style={styles.sellerName}>
              {data.seller.businessName ?? data.seller.name}
            </Text>
            {data.seller.document && (
              <Text style={styles.sellerHint}>
                CUIT / Doc: {data.seller.document}
              </Text>
            )}
          </View>
          <View style={styles.headerRight}>
            <View style={styles.numberBox}>
              <Text style={styles.numberLabel}>Nº</Text>
              <Text style={styles.numberValue}>{data.invoiceNumber}</Text>
            </View>
            <Text
              style={{
                ...styles.statusBadge,
                backgroundColor: statusSpec.bg,
                color: statusSpec.fg,
              }}
            >
              {statusSpec.label}
            </Text>
          </View>
        </View>

        {/* Comprador + vendedor + fechas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Datos del comprobante</Text>
          <View style={styles.twoCol}>
            <View style={styles.colBox}>
              <Text style={styles.sectionTitle}>Comprador</Text>
              {data.buyer.name ? (
                <Text style={{ ...styles.fieldValue, fontSize: 10 }}>
                  {data.buyer.name}
                </Text>
              ) : (
                <Text style={styles.fieldLabel}>— sin nombre —</Text>
              )}
              {data.buyer.email && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <Text style={styles.fieldValue}>{data.buyer.email}</Text>
                </View>
              )}
              {data.buyer.document && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Documento</Text>
                  <Text style={styles.fieldValue}>{data.buyer.document}</Text>
                </View>
              )}
            </View>
            <View style={styles.colBox}>
              <Text style={styles.sectionTitle}>Fechas</Text>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Emisión</Text>
                <Text style={styles.fieldValue}>{fmtDate(data.issueDate)}</Text>
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Compra</Text>
                <Text style={styles.fieldValue}>
                  {fmtDate(data.purchaseDate)}
                </Text>
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Vencimiento</Text>
                <Text style={styles.fieldValue}>{fmtDate(data.dueDate)}</Text>
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Pago efectivo</Text>
                <Text style={styles.fieldValue}>
                  {fmtDate(data.paymentDate)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Producto */}
        <View style={styles.productBox}>
          <Text style={styles.productLabel}>Producto</Text>
          <Text style={styles.productName}>
            {data.product.name ?? "— sin producto —"}
          </Text>
          {data.product.description && (
            <Text style={styles.productDescription}>
              {data.product.description}
            </Text>
          )}
        </View>

        {/* Totales */}
        <View style={styles.totalsBox}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Bruto</Text>
            <Text style={styles.totalValue}>
              {money(data.amountGross, data.currency)}
            </Text>
          </View>
          {data.taxAmount > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>IVA</Text>
                <Text style={styles.totalValue}>
                  {money(data.taxAmount, data.currency)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Neto</Text>
                <Text style={styles.totalValue}>
                  {money(amountNet, data.currency)}
                </Text>
              </View>
            </>
          )}
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Total a pagar</Text>
            <Text style={styles.grandValue}>
              {money(data.amountGross, data.currency)}
            </Text>
          </View>
        </View>

        {/* Nº transacción */}
        {data.transactionNumber && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLine}>
              Nº de transacción: {data.transactionNumber}
            </Text>
          </View>
        )}

        {/* Notas */}
        {data.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notas</Text>
            <Text style={styles.notesBody}>{data.notes}</Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          Documento no fiscal. Consultá con tu contador si necesitás factura
          formal.
        </Text>
      </Page>
    </Document>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Renderer público
// ═══════════════════════════════════════════════════════════════════════════

export async function renderInvoiceRemitoPdf(
  input: InvoiceRemitoInput,
): Promise<Buffer> {
  const stream = await pdf(<InvoiceRemitoDocument data={input} />).toBuffer();
  return await streamToBuffer(stream);
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

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function money(n: number, currency: string): string {
  const prefix =
    currency === "USD"
      ? "US$ "
      : currency === "EUR"
        ? "€ "
        : "AR$ ";
  return prefix + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusPill(status: InvoiceRemitoInput["status"]): {
  label: string;
  bg: string;
  fg: string;
} {
  if (status === "cobrada") {
    return { label: "Pagado", bg: "#E8F9F1", fg: COLORS.success };
  }
  if (status === "vencida") {
    return { label: "Vencido", bg: "#FFF7E6", fg: COLORS.warning };
  }
  if (status === "anulada") {
    return { label: "Anulado", bg: "#FDECEC", fg: COLORS.error };
  }
  return { label: "Pendiente", bg: "#F4F4F5", fg: COLORS.fgMuted };
}
