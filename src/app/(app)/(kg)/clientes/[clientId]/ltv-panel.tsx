import { Panel } from "@/components/kg/panel";
import type { LtvBreakdown } from "@/lib/clients/ltv";
import { fMoney } from "@/lib/finance/format";

// ═══════════════════════════════════════════════════════════════════════════
// Panel de LTV del cliente. Server component puro.
//
// Regla del plan §1.3 (ver src/lib/clients/ltv.ts):
//   LTV = Σ settlements.kingrow_retained (liquidada|transferida)
//       + Σ (invoices.amount_gross - tax_amount) (cobrada, project_id!=null)
//       + Σ renewals.amount (cobrada)
//       + Σ upsells.amount (cobrada)
//
// Como settlements, invoices, renewals y upsells pueden vivir en ARS o USD
// (excepto launch_settlements, que hoy se asume ARS — no tiene columna
// currency), el LTV se muestra separado por moneda. Sin FX cross-currency
// para no meter ruido: el operador que quiera consolidar usa las tasas del
// módulo Financiero.
//
// Si el cliente solo tiene ARS, se muestra una columna. Idem si solo USD.
// ═══════════════════════════════════════════════════════════════════════════

export function LtvPanel({
  ltvArs,
  ltvUsd,
}: {
  readonly ltvArs: LtvBreakdown;
  readonly ltvUsd: LtvBreakdown;
}) {
  const hasArs = ltvArs.total > 0;
  const hasUsd = ltvUsd.total > 0;
  // Si no hay nada cobrado en ninguna moneda, mostramos ARS igual (será $0)
  // para dar visibilidad de que existe la métrica.
  const showArs = hasArs || !hasUsd;
  const showUsd = hasUsd;

  return (
    <Panel title="LTV del cliente">
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            gap: 32,
            flexWrap: "wrap",
            alignItems: "baseline",
          }}
        >
          {showArs && (
            <TotalBlock
              label="LTV en ARS"
              value={ltvArs.total}
              currency="ARS"
            />
          )}
          {showUsd && (
            <TotalBlock
              label="LTV en USD"
              value={ltvUsd.total}
              currency="USD"
            />
          )}
        </div>

        <div>
          <div
            className="kg-t7"
            style={{
              color: "var(--kg-text-3)",
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Desglose por fuente
          </div>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Fuente</th>
                {showArs && (
                  <th style={{ ...thStyle, textAlign: "right" }}>ARS</th>
                )}
                {showUsd && (
                  <th style={{ ...thStyle, textAlign: "right" }}>USD</th>
                )}
              </tr>
            </thead>
            <tbody>
              <BreakdownRow
                label="Liquidaciones (Kingrow retenido)"
                hint="Solo status liquidada o transferida."
                arsValue={showArs ? ltvArs.fromSettlements : null}
                usdValue={showUsd ? ltvUsd.fromSettlements : null}
              />
              <BreakdownRow
                label="Facturas cobradas"
                hint="Neto de IVA. Solo cobradas con project atado."
                arsValue={showArs ? ltvArs.fromInvoices : null}
                usdValue={showUsd ? ltvUsd.fromInvoices : null}
              />
              <BreakdownRow
                label="Renovaciones cobradas"
                hint="Contrato periódico de gestión."
                arsValue={showArs ? ltvArs.fromRenewals : null}
                usdValue={showUsd ? ltvUsd.fromRenewals : null}
              />
              <BreakdownRow
                label="Upsells cobrados"
                hint="Ventas adicionales al cliente."
                arsValue={showArs ? ltvArs.fromUpsells : null}
                usdValue={showUsd ? ltvUsd.fromUpsells : null}
              />
              <tr>
                <td
                  style={{
                    ...tdStyle,
                    borderTop: "1px solid var(--kg-border-subtle)",
                    fontWeight: 700,
                    color: "var(--kg-text-1)",
                  }}
                >
                  Total
                </td>
                {showArs && (
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "right",
                      borderTop: "1px solid var(--kg-border-subtle)",
                      fontWeight: 700,
                      color: "var(--kg-text-1)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatMoney(ltvArs.total, "ARS")}
                  </td>
                )}
                {showUsd && (
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "right",
                      borderTop: "1px solid var(--kg-border-subtle)",
                      fontWeight: 700,
                      color: "var(--kg-text-1)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatMoney(ltvUsd.total, "USD")}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function TotalBlock({
  label,
  value,
  currency,
}: {
  readonly label: string;
  readonly value: number;
  readonly currency: "ARS" | "USD";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 28,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatMoney(value, currency)}
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  hint,
  arsValue,
  usdValue,
}: {
  readonly label: string;
  readonly hint: string;
  readonly arsValue: number | null;
  readonly usdValue: number | null;
}) {
  return (
    <tr>
      <td style={tdStyle}>
        <div style={{ color: "var(--kg-text-2)" }}>{label}</div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginTop: 2 }}
        >
          {hint}
        </div>
      </td>
      {arsValue !== null && (
        <td
          style={{
            ...tdStyle,
            textAlign: "right",
            color: arsValue === 0 ? "var(--kg-text-3)" : "var(--kg-text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatMoney(arsValue, "ARS")}
        </td>
      )}
      {usdValue !== null && (
        <td
          style={{
            ...tdStyle,
            textAlign: "right",
            color: usdValue === 0 ? "var(--kg-text-3)" : "var(--kg-text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatMoney(usdValue, "USD")}
        </td>
      )}
    </tr>
  );
}

function formatMoney(amount: number, currency: "ARS" | "USD"): string {
  const raw = fMoney(amount);
  const prefix = currency === "USD" ? "US$" : "AR$";
  return raw.replace(/^(-?)\$/, `$1${prefix} `);
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px 8px 0",
  textAlign: "left",
  color: "var(--kg-text-3)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  borderBottom: "1px solid var(--kg-border-subtle)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px 10px 0",
  color: "var(--kg-text-2)",
  fontSize: 12,
  verticalAlign: "top",
};
