import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { computeBankBalances } from "@/lib/banks/balance";
import { listBanks, listBankMovements } from "@/lib/banks/list";
import { fCount } from "@/lib/finance/format";
import { fmtArs, fmtUsd, loadLatestOrgFxRate } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import { BancosView, type BankRowData } from "./bancos-view";

export const metadata: Metadata = { title: "Bancos · Financiero" };

// Bancos son estructura, no eventos — sin filtro de período. Filtro por
// estado (activos/inactivos/todos) como assets/pasivos.
type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

export default async function BancosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);

  const supabase = await createClient();

  // ─── Fetch en paralelo ─────────────────────────────────────────────────
  //
  // Post refactor 2026-08: los cobros (`payments`) NO alimentan el balance
  // del banco. La única fuente que mueve el saldo son los `bank_movements`.
  // Los cobros por método siguen visibles en /financiero/metodos-pago como
  // métrica de trazabilidad.
  const [banks, movements, latestFx] = await Promise.all([
    listBanks(),
    listBankMovements(),
    loadLatestOrgFxRate(supabase),
  ]);

  const filteredBanks =
    activeParam === "activos"
      ? banks.filter((b) => b.active)
      : activeParam === "inactivos"
        ? banks.filter((b) => !b.active)
        : banks;

  const balances = computeBankBalances(filteredBanks, movements);

  const rows: BankRowData[] = filteredBanks.map((b) => {
    const bal = balances.get(b.id);
    const total = bal?.total ?? Number(b.opening_balance);
    const totalUsd =
      b.currency === "USD"
        ? total
        : latestFx
          ? total / latestFx.rate
          : null;
    return {
      id: b.id,
      name: b.name,
      currency: b.currency,
      openingBalance: bal?.opening ?? Number(b.opening_balance),
      movementsIn: bal?.movementsIn ?? 0,
      movementsOut: bal?.movementsOut ?? 0,
      total,
      totalUsd,
      active: b.active,
    };
  });

  const totalCount = rows.length;
  // Sumamos separado por moneda: sumar ARS + USD en la misma numérica no tiene
  // sentido físico. El total consolidado en USD sale en el dashboard financiero
  // aplicando la conversión con las tasas del proyecto (task #9).
  const activeRows = rows.filter((r) => r.active);
  const totalActivoARS = activeRows
    .filter((r) => r.currency === "ARS")
    .reduce((acc, r) => acc + r.total, 0);
  const totalActivoUSD = activeRows
    .filter((r) => r.currency === "USD")
    .reduce((acc, r) => acc + r.total, 0);
  // Total consolidado en USD: bancos USD + ARS convertidos con la última tasa.
  const totalConsolidadoUsd = latestFx
    ? totalActivoUSD + totalActivoARS / latestFx.rate
    : null;

  function buildHref(state: ActiveParam): string {
    if (state === "activos") return "/financiero/bancos";
    return `/financiero/bancos?state=${state}`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Bancos"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Saldo ARS (activos)", v: fmtArs(totalActivoARS) },
          { l: "Saldo USD (activos)", v: fmtUsd(totalActivoUSD) },
          ...(totalConsolidadoUsd !== null
            ? [
                {
                  l: `Total USD (tasa ${latestFx!.month})`,
                  v: fmtUsd(totalConsolidadoUsd),
                },
              ]
            : []),
        ]}
      />

      <div style={{ display: "flex", gap: 10 }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={ACTIVE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref(o.value),
            active: activeParam === o.value,
          }))}
        />
      </div>

      <Panel title="Bancos de Kingrow" pad={false}>
        <BancosView rows={rows} totalCount={totalCount} />
      </Panel>
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}
