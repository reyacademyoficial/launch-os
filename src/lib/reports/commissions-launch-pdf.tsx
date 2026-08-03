import "server-only";

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import type {
  CommissionRuleRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtDate, fmtLaunchWindow } from "@/lib/format";
import { normalizePaymentsForSaleCurrency } from "@/lib/money";
import type { TeamMemberRow } from "@/lib/team/types";

/**
 * PDF de "Comisiones cerradas" para un launch.
 *
 * Vista: ventas del launch agrupadas por team_member (setter/closer). Cada
 * fila resuelve su comisión via `computeCommission` reusando la regla
 * aplicable — la lógica es la misma que el panel de la UI, garantizando
 * consistencia.
 *
 * Permisos del route: `requireCanEditProject` (admin only). El PDF no chequea
 * permisos — confía en el route handler.
 *
 * Brand colors duplicados desde el ejecutivo. Si crecen los reportes,
 * extraer a `lib/reports/brand.ts`.
 */

const COLORS = {
  brand: "#FF006E",
  success: "#00D084",
  error: "#FF5A5F",
  warning: "#FFB800",
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9,
    color: COLORS.fgMuted,
  },
  totalsBar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
    gap: 8,
  },
  totalCell: {
    flex: 1,
  },
  totalLabel: {
    fontSize: 7,
    color: COLORS.fgMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  totalValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
  },
  groupHeader: {
    backgroundColor: COLORS.surface,
    padding: 6,
    borderRadius: 3,
    marginTop: 10,
    marginBottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  groupName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
  groupMeta: {
    fontSize: 8,
    color: COLORS.fgMuted,
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 4,
  },
  thFecha: { width: "12%", fontSize: 7, color: COLORS.fgMuted, textTransform: "uppercase" },
  thModalidad: { width: "20%", fontSize: 7, color: COLORS.fgMuted, textTransform: "uppercase" },
  thRegla: { width: "20%", fontSize: 7, color: COLORS.fgMuted, textTransform: "uppercase" },
  thNum: {
    fontSize: 7,
    color: COLORS.fgMuted,
    textTransform: "uppercase",
    textAlign: "right",
    width: "16%",
  },
  cFecha: { width: "12%", fontSize: 8 },
  cModalidad: { width: "20%", fontSize: 8 },
  cRegla: { width: "20%", fontSize: 8, color: COLORS.fgMuted },
  cNum: {
    fontSize: 8,
    width: "16%",
    textAlign: "right",
  },
  groupTotalsRow: {
    flexDirection: "row",
    paddingTop: 5,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.fgMuted,
  },
  groupTotalLabel: {
    width: "52%",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    paddingRight: 6,
  },
  groupTotalNum: {
    width: "16%",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  grandTotalBox: {
    marginTop: 14,
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.brand,
    backgroundColor: "#FFEBF4",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  grandTotalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLORS.brand,
  },
  grandTotalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: COLORS.brand,
  },
  empty: {
    padding: 32,
    textAlign: "center",
    color: COLORS.fgMuted,
    fontSize: 10,
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

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface CommissionsLaunchInput {
  projectName: string;
  projectBusinessName: string | null;
  launchId: string;
  launchName: string;
  launchDateStart: string | null;
  launchDateEnd: string | null;
  sales: ReadonlyArray<{
    sale: SaleRow;
    payments: ReadonlyArray<PaymentRow>;
  }>;
  rules: ReadonlyArray<CommissionRuleRow>;
  modalities: ReadonlyArray<PaymentModalityRow>;
  teamMembers: ReadonlyArray<TeamMemberRow>;
  /**
   * Atribución por venta. Construido por el route con un fetch de
   * `leads.id, leads.team_member_id` sobre los lead_ids del input. Es la
   * verdad operativa: el dueño del lead manda, NO `sales.team_member_id`.
   */
  leadOwnerBySaleId: ReadonlyMap<string, string | null>;
}

interface GroupedRow {
  member: TeamMemberRow | null;
  sales: Array<{
    sale: SaleRow;
    payments: ReadonlyArray<PaymentRow>;
    modalityName: string;
    formula: string;
    collected: number;
    pledged: number;
    commission: number;
  }>;
  collectedTotal: number;
  pledgedTotal: number;
  commissionTotal: number;
}

// ─── Document ──────────────────────────────────────────────────────────────

export function CommissionsLaunchDocument({
  data,
}: {
  data: CommissionsLaunchInput;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const grouped = groupByMember(data);
  const { totalCollected, totalPledged, totalCommission, totalSales } =
    computeGrandTotals(grouped);

  return (
    <Document title={`Comisiones cerradas — ${data.launchName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        <View style={styles.header}>
          <Text style={styles.eyebrow}>
            {data.projectBusinessName ?? data.projectName} · Comisiones cerradas
          </Text>
          <Text style={styles.title}>{data.launchName}</Text>
          <Text style={styles.subtitle}>
            {fmtLaunchWindow(data.launchDateStart, data.launchDateEnd)}
          </Text>
        </View>

        {/* Totales arriba */}
        <View style={styles.totalsBar}>
          <View style={styles.totalCell}>
            <Text style={styles.totalLabel}>Ventas</Text>
            <Text style={styles.totalValue}>{totalSales}</Text>
          </View>
          <View style={styles.totalCell}>
            <Text style={styles.totalLabel}>Pactado</Text>
            <Text style={styles.totalValue}>{money(totalPledged)}</Text>
          </View>
          <View style={styles.totalCell}>
            <Text style={styles.totalLabel}>Cobrado</Text>
            <Text style={styles.totalValue}>{money(totalCollected)}</Text>
          </View>
          <View style={styles.totalCell}>
            <Text style={styles.totalLabel}>Comisiones</Text>
            <Text style={[styles.totalValue, { color: COLORS.brand }]}>
              {money(totalCommission)}
            </Text>
          </View>
        </View>

        {grouped.length === 0 ? (
          <Text style={styles.empty}>
            Sin ventas cerradas en este lanzamiento.
          </Text>
        ) : (
          grouped.map((g, idx) => <GroupBlock key={idx} group={g} />)
        )}

        <View style={styles.grandTotalBox}>
          <Text style={styles.grandTotalLabel}>Total comisiones a pagar</Text>
          <Text style={styles.grandTotalValue}>{money(totalCommission)}</Text>
        </View>

        <Text style={styles.footer} fixed>
          Generado por Launch OS · {today} · La comisión se calcula sobre lo
          cobrado.
        </Text>
      </Page>
    </Document>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────

function GroupBlock({ group }: { group: GroupedRow }) {
  const memberLabel = group.member?.name ?? "Sin asignar";
  const roleLabel = group.member?.role
    ? roleLabelEs(group.member.role)
    : "—";

  return (
    <View>
      <View style={styles.groupHeader}>
        <Text style={styles.groupName}>{memberLabel}</Text>
        <Text style={styles.groupMeta}>
          {roleLabel} · {group.sales.length} venta{group.sales.length === 1 ? "" : "s"}
        </Text>
      </View>

      <View style={styles.tableHeader}>
        <Text style={styles.thFecha}>Cerrada</Text>
        <Text style={styles.thModalidad}>Modalidad</Text>
        <Text style={styles.thRegla}>Regla</Text>
        <Text style={styles.thNum}>Pactado</Text>
        <Text style={styles.thNum}>Cobrado</Text>
        <Text style={styles.thNum}>Comisión</Text>
      </View>

      {group.sales.map((row) => (
        <View key={row.sale.id} style={styles.tableRow}>
          <Text style={styles.cFecha}>{fmtDate(row.sale.closed_at)}</Text>
          <Text style={styles.cModalidad}>{row.modalityName}</Text>
          <Text style={styles.cRegla}>{row.formula}</Text>
          <Text style={styles.cNum}>{money(row.pledged)}</Text>
          <Text style={styles.cNum}>{money(row.collected)}</Text>
          <Text style={[styles.cNum, { color: COLORS.brand }]}>
            {money(row.commission)}
          </Text>
        </View>
      ))}

      <View style={styles.groupTotalsRow}>
        <Text style={styles.groupTotalLabel}>Subtotal:</Text>
        <Text style={styles.groupTotalNum}>{money(group.pledgedTotal)}</Text>
        <Text style={styles.groupTotalNum}>{money(group.collectedTotal)}</Text>
        <Text style={[styles.groupTotalNum, { color: COLORS.brand }]}>
          {money(group.commissionTotal)}
        </Text>
      </View>
    </View>
  );
}

// ─── Agregación ────────────────────────────────────────────────────────────

function groupByMember(data: CommissionsLaunchInput): GroupedRow[] {
  const modalityById = new Map(data.modalities.map((m) => [m.id, m]));
  const memberById = new Map(data.teamMembers.map((t) => [t.id, t]));
  const groups = new Map<string, GroupedRow>();

  // Ranking marginal: todas las ventas del input pertenecen al mismo launch
  // (filtrado en listSalesByLaunch), así que el bucket es solo dueño_del_lead.
  // Orden: closed_at asc, empate created_at asc.
  const rankBySaleId = computeSaleRanks(
    data.sales.map((s) => s.sale),
    data.leadOwnerBySaleId,
  );

  for (const { sale, payments } of data.sales) {
    // Pasamos el launchId del input para que la override per-launch se
    // considere antes que la default del proyecto.
    const rule = findApplicableRule(
      data.rules,
      sale.payment_modality_id,
      data.launchId,
    );

    const saleRank = rankBySaleId.get(sale.id) ?? 0;
    // Normalizamos payments a la moneda del sale antes del calc.
    // TODO(fx-pdf): este report todavía no recibe FxLookup — sin lookup el
    // helper degrada a passthrough. Si un launch tiene sales mixed-currency
    // la comisión del PDF va a diferir del panel UI hasta que el route
    // handler arme el FxLookup y lo pase por `CommissionsLaunchInput`.
    const { normalized } = normalizePaymentsForSaleCurrency(
      sale,
      payments,
      undefined,
    );
    const computed = computeCommission(sale, normalized, rule, saleRank);

    // Atribución por dueño del lead — NO por `sale.team_member_id`. Si el
    // lead no tiene dueño, va al bucket "Sin asignar".
    const ownerId = data.leadOwnerBySaleId.get(sale.id) ?? null;
    const memberKey = ownerId ?? "__none__";
    let group = groups.get(memberKey);
    if (!group) {
      const member = ownerId ? memberById.get(ownerId) ?? null : null;
      group = {
        member,
        sales: [],
        collectedTotal: 0,
        pledgedTotal: 0,
        commissionTotal: 0,
      };
      groups.set(memberKey, group);
    }

    group.sales.push({
      sale,
      payments,
      modalityName:
        modalityById.get(sale.payment_modality_id)?.name ?? "—",
      formula: computed.formula,
      collected: computed.collected,
      pledged: computed.pledged,
      commission: computed.commission,
    });
    group.collectedTotal += computed.collected;
    group.pledgedTotal += computed.pledged;
    group.commissionTotal += computed.commission;
  }

  // Orden estable: primero los miembros nombrados (alfabético), después
  // "Sin asignar" al final.
  const result = Array.from(groups.values());
  result.sort((a, b) => {
    if (!a.member && b.member) return 1;
    if (a.member && !b.member) return -1;
    if (!a.member && !b.member) return 0;
    return a.member!.name.localeCompare(b.member!.name);
  });
  return result;
}

function computeSaleRanks(
  sales: ReadonlyArray<SaleRow>,
  leadOwnerBySaleId: ReadonlyMap<string, string | null>,
): Map<string, number> {
  // Bucket por dueño del lead. Sales sobre leads sin dueño rankean entre sí
  // bajo la clave "__none__" — la fila "Sin asignar" del PDF las muestra
  // con su comisión teórica.
  const byOwner = new Map<string, SaleRow[]>();
  for (const s of sales) {
    const key = leadOwnerBySaleId.get(s.id) ?? "__none__";
    const arr = byOwner.get(key);
    if (arr) arr.push(s);
    else byOwner.set(key, [s]);
  }
  const ranks = new Map<string, number>();
  for (const arr of byOwner.values()) {
    arr.sort((a, b) => {
      const cmp = a.closed_at.localeCompare(b.closed_at);
      if (cmp !== 0) return cmp;
      return a.created_at.localeCompare(b.created_at);
    });
    arr.forEach((s, i) => ranks.set(s.id, i));
  }
  return ranks;
}

function computeGrandTotals(groups: ReadonlyArray<GroupedRow>) {
  let totalCollected = 0;
  let totalPledged = 0;
  let totalCommission = 0;
  let totalSales = 0;
  for (const g of groups) {
    totalCollected += g.collectedTotal;
    totalPledged += g.pledgedTotal;
    totalCommission += g.commissionTotal;
    totalSales += g.sales.length;
  }
  return { totalCollected, totalPledged, totalCommission, totalSales };
}

// ─── Renderer público ──────────────────────────────────────────────────────

export async function renderCommissionsLaunchPdf(
  input: CommissionsLaunchInput,
): Promise<Buffer> {
  const stream = await pdf(
    <CommissionsLaunchDocument data={input} />,
  ).toBuffer();
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

// ─── helpers ───────────────────────────────────────────────────────────────

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function roleLabelEs(role: string): string {
  switch (role) {
    case "setter":
      return "Setter";
    case "closer":
      return "Closer";
    case "media_buyer":
      return "Media buyer";
    case "manager":
      return "Manager";
    default:
      return "Otro";
  }
}
