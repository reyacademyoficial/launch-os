import type { ProductBreakdownRow } from "@/lib/leaderboard/product-breakdown";
import { fmtMoney, fmtNumber } from "@/lib/format";

/**
 * Tabla debajo del leaderboard principal: fila por combinación
 * (vendedor, producto). Muestra Ventas / Pactado / Cobrado / Comisión.
 * Insertamos filas de subtotal cada vez que cambia el vendedor, y una
 * fila de Total al final.
 *
 * Read-only, sin filtros propios — hereda los del leaderboard.
 */
export function ProductBreakdownTable({
  rows,
}: {
  readonly rows: ReadonlyArray<ProductBreakdownRow>;
}) {
  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-fg">Ventas por producto</h2>
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-fg-muted">
          Sin ventas en el rango filtrado.
        </p>
      </section>
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

  // Detectar el último índice de cada vendedor para saber dónde inyectar
  // subtotales. Como `rows` ya está ordenado por vendedor, alcanza con
  // recorrer una vez y armar los límites.
  const memberKey = (r: ProductBreakdownRow): string =>
    r.teamMember?.id ?? "__unassigned__";

  interface Group {
    key: string;
    memberName: string;
    startIdx: number; // inclusive
    endIdx: number; // inclusive
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

  // Solo mostramos subtotales si hay más de un vendedor (evita ruido cuando
  // hay solo uno y coincide con el total).
  const showSubtotals = groups.length > 1;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-fg">Ventas por producto</h2>
      <p className="text-xs text-fg-subtle">
        Desglose por vendedor y producto sobre el mismo universo filtrado del
        leaderboard.
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium">
                Vendedor
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Producto
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                Ventas
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                Pactado
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                Cobrado
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                Comisión
              </th>
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
          <tfoot className="border-t-2 border-border bg-surface/60 text-sm">
            <tr>
              <td className="px-3 py-3 font-semibold text-fg" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                {fmtNumber(grandSales)}
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                {fmtMoney(grandPledged)}
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                {fmtMoney(grandCollected)}
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-accent">
                {fmtMoney(grandCommission)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
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
          className="border-t border-border hover:bg-surface"
        >
          <td className="px-3 py-3 text-fg">
            {i === 0 ? group.memberName : ""}
          </td>
          <td className="px-3 py-3 text-fg-muted">{r.product.name}</td>
          <td className="px-3 py-3 text-right tabular-nums text-fg">
            {fmtNumber(r.salesCount)}
          </td>
          <td className="px-3 py-3 text-right tabular-nums text-fg">
            {fmtMoney(r.pledged)}
          </td>
          <td className="px-3 py-3 text-right tabular-nums text-fg">
            {fmtMoney(r.collected)}
          </td>
          <td className="px-3 py-3 text-right tabular-nums text-accent">
            {fmtMoney(r.commissionAccrued)}
          </td>
        </tr>
      ))}
      {showSubtotal && slice.length > 1 && (
        <tr className="border-t border-border bg-surface/30 text-xs">
          <td className="px-3 py-2 font-semibold text-fg-subtle" colSpan={2}>
            Subtotal {group.memberName}
          </td>
          <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg-subtle">
            {fmtNumber(group.sales)}
          </td>
          <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg-subtle">
            {fmtMoney(group.pledged)}
          </td>
          <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg-subtle">
            {fmtMoney(group.collected)}
          </td>
          <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg-subtle">
            {fmtMoney(group.commission)}
          </td>
        </tr>
      )}
    </>
  );
}
