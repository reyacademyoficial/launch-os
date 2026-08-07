import { NextResponse } from "next/server";

import {
  buildInvoiceReport,
  type InvoiceInput,
} from "@/lib/finance/invoice-report";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import {
  renderInvoiceReportPdf,
  type InvoiceReportPdfDetailRow,
  type InvoiceReportPdfInput,
} from "@/lib/reports/invoice-report-pdf";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/financiero/reportes/facturas/export-pdf
 *   ?status=&project=&range=|from=&to=
 *
 * Versión PDF del reporte de facturas. Espeja el fetch del export XLSX y
 * llama al renderer PDF.
 */
type StatusFilter = "todos" | "emitida" | "cobrada" | "vencida" | "anulada";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d" | "custom";

interface InvoiceDbRow {
  readonly id: string;
  readonly status: "emitida" | "cobrada" | "vencida" | "anulada";
  readonly issue_date: string;
  readonly due_date: string | null;
  readonly amount_gross: number;
  readonly currency: string | null;
  readonly project_id: string | null;
  readonly invoice_number: string | null;
  readonly buyer_name: string | null;
  readonly description: string;
}

interface BridgeSlim {
  readonly invoice_id: string;
  readonly bank_movements: { amount: number; kind: "in" | "out" } | null;
}

interface ProjectRow {
  readonly id: string;
  readonly name: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));
  const project = url.searchParams.get("project");
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

  let query = supabase
    .from("invoices")
    .select(
      "id, status, issue_date, due_date, amount_gross, currency, project_id, invoice_number, buyer_name, description",
    )
    .order("issue_date", { ascending: false });
  if (period) {
    query = query
      .gte("issue_date", period.fromYmd)
      .lte("issue_date", period.toYmd);
  }
  if (project) query = query.eq("project_id", project);

  const res = await query;
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const raw = (res.data ?? []) as unknown as InvoiceDbRow[];

  const invoiceIds = raw.map((i) => i.id);
  const principalSum = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const bridgeRes = await supabase
      .from("invoice_bank_movements")
      .select("invoice_id, bank_movements!inner(amount, kind)")
      .eq("role", "principal")
      .in("invoice_id", invoiceIds);
    const bridgeRows = (bridgeRes.data ?? []) as unknown as BridgeSlim[];
    for (const b of bridgeRows) {
      if (!b.bank_movements || b.bank_movements.kind !== "in") continue;
      principalSum.set(
        b.invoice_id,
        (principalSum.get(b.invoice_id) ?? 0) + Number(b.bank_movements.amount),
      );
    }
  }

  const projectIds = Array.from(
    new Set(raw.map((r) => r.project_id).filter((id): id is string => id != null)),
  );
  const projectNameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const projRes = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    for (const p of (projRes.data ?? []) as ProjectRow[]) {
      projectNameById.set(p.id, p.name);
    }
  }

  const normalized: InvoiceInput[] = raw.map((i) => ({
    id: i.id,
    status: i.status,
    issue_date: i.issue_date,
    due_date: i.due_date,
    amount_gross: Number(i.amount_gross),
    currency: i.currency ?? "ARS",
    project_id: i.project_id,
    invoice_number: i.invoice_number,
    buyer_name: i.buyer_name,
    description: i.description,
  }));

  const todayYmd = new Date().toISOString().slice(0, 10);
  const report = buildInvoiceReport(normalized, principalSum, todayYmd);

  const filteredDetail =
    status === "todos"
      ? report.detail
      : report.detail.filter((r) => r.status === status);

  const detail: InvoiceReportPdfDetailRow[] = filteredDetail.map((r) => ({
    invoiceNumber: r.invoiceNumber,
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    status: r.status,
    currency: r.currency,
    amountGross: r.amountGross,
    gatewayFee: r.gatewayFee,
    projectName: r.projectId
      ? projectNameById.get(r.projectId) ?? "—"
      : "Sin proyecto",
    buyerName: r.buyerName,
  }));

  // Nombre de la organización.
  let orgName = "—";
  const orgId = await resolveCurrentOrganizationId();
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

  const input: InvoiceReportPdfInput = {
    orgName,
    periodLabel,
    generatedAt: new Date(),
    buckets: report.buckets,
    detail,
  };

  let buffer: Buffer;
  try {
    buffer = await renderInvoiceReportPdf(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "render_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="reporte-facturas-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseStatus(v: string | null): StatusFilter {
  const allowed: StatusFilter[] = [
    "todos",
    "emitida",
    "cobrada",
    "vencida",
    "anulada",
  ];
  return (allowed as string[]).includes(v ?? "") ? (v as StatusFilter) : "todos";
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
