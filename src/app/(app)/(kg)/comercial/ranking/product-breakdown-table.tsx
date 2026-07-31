import { EmptyState } from "@/components/kg/empty-state";
import type { ProductBreakdownRow } from "@/lib/leaderboard/product-breakdown";
import { fmtMoney, fmtNumber } from "@/lib/format";

/**
 * Desglose por (vendedor, producto). Filas de subtotal por vendedor cuando
 * hay más de uno + fila total al final.
 *
 * Read-only, sin filtros propios — hereda los del leaderboard.
 * Estilo KG: usa var(--kg-*) y kg-num. La única marca de acento es la
 * columna Comisión (KPI destacado).
 */
export function ProductBreakdownTable({
  rows,
}: {
  readonly rows: ReadonlyArray<ProductBreakdownRow>;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin ventas en el rango filtrado"
        hint="Ajustá los filtros del ranking para ver el desglose por producto."
      />
    );
  }

  // Total general.
  let grandSales = 0;
  let grandPledged = 0;
  let grandCollected = 0;
  let grandCommission = 0;
  for (const r of rows) {
    grandSales += r.salesCount;
    grandPledged += r.pledged;
    grandCollected += r.collected;
    grandCommission += r.commissionAccrued;
  }

  const memberKey = (r: ProductBreakdownRow): string =>
    r.teamMember?.id ?? "__unassigned__";

  interface Group {
    key: string;
    memberName: string;
    startIdx: number;
    endIdx: number;
    sales: number;
    pledged: number;
    collected: number;
    commission: number;
  }
  const groups: Group[] = [];
  let current: Group | null = null;
  rows.forEach((r, i) => {
    const key = memberKey(r);
    if (!current || current.key !== key) {
      if (current) groups.push(current);
      current = {
        key,
        memberName: r.teamMember?.name ?? "Sin asignar",
        startIdx: i,
        endIdx: i,
        sales: 0,
        pledged: 0,
        collected: 0,
        commission: 0,
      };
    }
    current.endIdx = i;
    current.sales += r.salesCount;
    current.pledged += r.pledged;
    current.collected += r.collected;
    current.commission += r.commissionAccrued;
  });
  if (current) groups.push(current);

  const showSubtotals = groups.length > 1;

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          minWidth: 720,
          borderCollapse: "collapse",
          fontSize: 12.5,
        }}
      >
        <thead>
          <tr>
            <TH>Vendedor</TH>
            <TH>Producto</TH>
            <TH align="right">Ventas</TH>
            <TH align="right">Pactado</TH>
            <TH align="right">Cobrado</TH>
            <TH align="right">Comisión</TH>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows
              key={g.key}
              group={g}
              rows={rows}
              showSubtotal={showSubtotals}
            />
          ))}
        </tbody>
        <tfoot>
          <tr
            style={{
              borderTop: "2px solid var(--kg-border-subtle)",
              background: "var(--kg-surface-2-solid)",
            }}
          >
            <TD colSpan={2} style={{ fontWeight: 700 }}>
              Total
            </TD>
            <TD align="right" numeric bold>
              {fmtNumber(grandSales)}
            </TD>
            <TD align="right" numeric bold>
              {fmtMoney(grandPledged)}
            </TD>
            <TD align="right" numeric bold>
              {fmtMoney(grandCollected)}
            </TD>
            <TD align="right" numeric bold accent>
              {fmtMoney(grandCommission)}
            </TD>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GroupRows({
  group,
  rows,
  showSubtotal,
}: {
  readonly group: {
    key: string;
    memberName: string;
    startIdx: number;
    endIdx: number;
    sales: number;
    pledged: number;
    collected: number;
    commission: number;
  };
  readonly rows: ReadonlyArray<ProductBreakdownRow>;
  readonly showSubtotal: boolean;
}) {
  const slice = rows.slice(group.startIdx, group.endIdx + 1);
  return (
    <>
      {slice.map((r, i) => (
        <tr
          key={`${group.key}-${r.product.id}`}
          className="kg-row"
          style={{ borderTop: "1px solid var(--kg-border-subtle)" }}
        >
          <TD>{i === 0 ? group.memberName : ""}</TD>
          <TD muted>{r.product.name}</TD>
          <TD align="right" numeric>
            {fmtNumber(r.salesCount)}
          </TD>
          <TD align="right" numeric>
            {fmtMoney(r.pledged)}
          </TD>
          <TD align="right" numeric>
            {fmtMoney(r.collected)}
          </TD>
          <TD align="right" numeric accent>
            {fmtMoney(r.commissionAccrued)}
          </TD>
        </tr>
      ))}
      {showSubtotal && slice.length > 1 && (
        <tr
          style={{
            borderTop: "1px solid var(--kg-border-subtle)",
            background: "var(--kg-surface-2-solid)",
          }}
        >
          <TD
            colSpan={2}
            small
            style={{ fontWeight: 700, color: "var(--kg-text-3)" }}
          >
            Subtotal {group.memberName}
          </TD>
          <TD align="right" numeric bold small muted>
            {fmtNumber(group.sales)}
          </TD>
          <TD align="right" numeric bold small muted>
            {fmtMoney(group.pledged)}
          </TD>
          <TD align="right" numeric bold small muted>
            {fmtMoney(group.collected)}
          </TD>
          <TD align="right" numeric bold small muted>
            {fmtMoney(group.commission)}
          </TD>
        </tr>
      )}
    </>
  );
}

// ─── TH/TD helpers ────────────────────────────────────────────────────────

function TH({
  children,
  align,
}: {
  readonly children?: React.ReactNode;
  readonly align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      style={{
        textAlign: align ?? "left",
        padding: "10px 12px",
        borderBottom: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-3)",
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: 0.2,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        background: "transparent",
      }}
    >
      {children}
    </th>
  );
}

function TD({
  children,
  align,
  numeric,
  muted,
  bold,
  accent,
  small,
  colSpan,
  style,
}: {
  readonly children?: React.ReactNode;
  readonly align?: "left" | "right";
  readonly numeric?: boolean;
  readonly muted?: boolean;
  readonly bold?: boolean;
  readonly accent?: boolean;
  readonly small?: boolean;
  readonly colSpan?: number;
  readonly style?: React.CSSProperties;
}) {
  const color = accent
    ? "var(--kg-accent-text)"
    : muted
      ? "var(--kg-text-3)"
      : "var(--kg-text-1)";
  return (
    <td
      colSpan={colSpan}
      className={numeric ? "kg-num" : undefined}
      style={{
        textAlign: align ?? "left",
        padding: small ? "8px 12px" : "10px 12px",
        color,
        fontVariantNumeric: numeric ? "tabular-nums" : undefined,
        fontWeight: bold ? 700 : undefined,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
