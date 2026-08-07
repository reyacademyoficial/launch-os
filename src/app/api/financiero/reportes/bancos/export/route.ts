import { NextResponse } from "next/server";

import { listBanks, listBankMovements } from "@/lib/banks/list";
import { buildBankReport } from "@/lib/finance/bank-report";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { buildBankReportWorkbook } from "@/lib/finance/xlsx-export";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/financiero/reportes/bancos/export?range=|from=&to=
 *
 * Reporte financiero de bancos en XLSX. Espeja el filtro de rango de la vista
 * /financiero/reportes/bancos. Tres hojas: Resumen, Por banco, Consolidado.
 *
 * RLS es el guard de auth — un cliente no tiene visibilidad sobre bancos y
 * su archivo sale vacío, lo que es lo esperado.
 */
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

interface MovementSlim {
  readonly id: string;
  readonly bank_id: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly organization_id: string;
  readonly occurred_at: string;
  readonly description: string | null;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = parseRange(url.searchParams.get("range"));
  const from = parseYmd(url.searchParams.get("from"));
  const to = parseYmd(url.searchParams.get("to"));

  const isCustom = from != null && to != null;
  const effectiveRange: RangeParam = isCustom ? "custom" : range;
  const period: Period | null =
    effectiveRange === "todo"
      ? null
      : isCustom
        ? resolvePeriod({ from, to })
        : resolvePeriod({ range: effectiveRange });

  const supabase = await createClient();

  const [banks, allMovements] = await Promise.all([
    listBanks(),
    listBankMovements(),
  ]);

  const movementsInPeriod = (allMovements as MovementSlim[]).filter((m) => {
    if (!period) return true;
    const ymd = m.occurred_at.slice(0, 10);
    return ymd >= period.fromYmd && ymd <= period.toYmd;
  });

  const movementIds = movementsInPeriod.map((m) => m.id);
  const [invLinksRes, expLinksRes, payLinksRes, ctLinksRes] = await Promise.all([
    movementIds.length > 0
      ? supabase
          .from("invoice_bank_movements")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
    movementIds.length > 0
      ? supabase
          .from("expense_bank_movements")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
    movementIds.length > 0
      ? supabase
          .from("payroll")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
    movementIds.length > 0
      ? supabase
          .from("client_transfers")
          .select("bank_movement_id")
          .in("bank_movement_id", movementIds)
      : Promise.resolve({ data: [] }),
  ]);
  const linkedIds = new Set<string>();
  for (const r of (invLinksRes.data ?? []) as { bank_movement_id: string }[]) {
    linkedIds.add(r.bank_movement_id);
  }
  for (const r of (expLinksRes.data ?? []) as { bank_movement_id: string }[]) {
    linkedIds.add(r.bank_movement_id);
  }
  for (const r of (payLinksRes.data ?? []) as { bank_movement_id: string | null }[]) {
    if (r.bank_movement_id) linkedIds.add(r.bank_movement_id);
  }
  for (const r of (ctLinksRes.data ?? []) as { bank_movement_id: string | null }[]) {
    if (r.bank_movement_id) linkedIds.add(r.bank_movement_id);
  }

  const report = buildBankReport(banks, movementsInPeriod, linkedIds);
  const periodLabel = period
    ? `${period.fromYmd} → ${period.toYmd}`
    : "Todo el histórico";

  const buffer = await buildBankReportWorkbook(
    report.byBank,
    report.consolidated,
    periodLabel,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporte-bancos-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseRange(v: string | null): RangeParam {
  const allowed: RangeParam[] = [
    "todo",
    "mes-actual",
    "mes-anterior",
    "90d",
    "custom",
  ];
  return (allowed as string[]).includes(v ?? "") ? (v as RangeParam) : "todo";
}
function parseYmd(v: string | null): string | null {
  if (v == null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
