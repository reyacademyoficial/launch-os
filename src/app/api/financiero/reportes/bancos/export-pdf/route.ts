import { NextResponse } from "next/server";

import { listBanks, listBankMovements } from "@/lib/banks/list";
import { buildBankReport } from "@/lib/finance/bank-report";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import {
  renderBankReportPdf,
  type BankReportPdfInput,
} from "@/lib/reports/bank-report-pdf";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/financiero/reportes/bancos/export-pdf?range=|from=&to=
 *
 * Versión PDF del reporte de bancos. Espeja la lógica de fetch del export
 * XLSX (mismo set de linkedIds sobre las 4 tablas satélite: invoice_bank
 * _movements, expense_bank_movements, payroll, client_transfers). Le
 * agrega el nombre de la organización en el header.
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

  const [banks, allMovements, orgId] = await Promise.all([
    listBanks(),
    listBankMovements(),
    resolveCurrentOrganizationId(),
  ]);

  const movementsInPeriod = (allMovements as MovementSlim[]).filter((m) => {
    if (!period) return true;
    const ymd = m.occurred_at.slice(0, 10);
    return ymd >= period.fromYmd && ymd <= period.toYmd;
  });

  // Set de conciliados en las 4 tablas satélite (igual que export XLSX).
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

  // Nombre de la organización para el header del PDF.
  let orgName = "—";
  if (orgId) {
    const orgRes = await supabase
      .from("organization")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    const org = orgRes.data as { name: string } | null;
    if (org) orgName = org.name;
  }

  const periodLabel = period
    ? `${period.fromYmd} → ${period.toYmd}`
    : "Todo el histórico";

  const input: BankReportPdfInput = {
    orgName,
    periodLabel,
    generatedAt: new Date(),
    byBank: report.byBank,
    consolidated: report.consolidated,
  };

  let buffer: Buffer;
  try {
    buffer = await renderBankReportPdf(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "render_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="reporte-bancos-${stamp}.pdf"`,
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
