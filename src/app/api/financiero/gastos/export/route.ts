import { NextResponse } from "next/server";

import {
  buildExpensesWorkbook,
  type ExpenseExportRow,
} from "@/lib/finance/xlsx-export";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

type PaidParam = "todos" | "pagado" | "impago";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

interface ExpenseDbRow {
  readonly id: string;
  readonly description: string;
  readonly category: string | null;
  readonly supplier_id: string | null;
  readonly amount_gross: number;
  readonly tax_amount: number;
  readonly currency: string | null;
  readonly expense_date: string;
  readonly due_date: string | null;
  readonly paid_at: string | null;
  readonly notes: string | null;
}
interface SupplierRow {
  readonly id: string;
  readonly name: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const paid = parsePaid(url.searchParams.get("paid"));
  const range = parseRange(url.searchParams.get("range"));
  const period: Period | null = range === "todo" ? null : resolvePeriod({ range });

  const supabase = await createClient();
  let query = supabase
    .from("expenses")
    .select(
      "id, description, category, supplier_id, amount_gross, tax_amount, currency, expense_date, due_date, paid_at, notes",
    )
    .order("expense_date", { ascending: false });
  if (paid === "pagado") query = query.not("paid_at", "is", null);
  else if (paid === "impago") query = query.is("paid_at", null);
  if (period) {
    query = query
      .gte("expense_date", period.fromYmd)
      .lte("expense_date", period.toYmd);
  }
  const res = await query;
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const expenses = (res.data ?? []) as unknown as ExpenseDbRow[];

  const supplierIds = Array.from(
    new Set(
      expenses.map((e) => e.supplier_id).filter((id): id is string => id != null),
    ),
  );
  const supplierNameById = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data } = await supabase
      .from("suppliers")
      .select("id, name")
      .in("id", supplierIds);
    for (const s of (data ?? []) as SupplierRow[]) {
      supplierNameById.set(s.id, s.name);
    }
  }

  const rows: ExpenseExportRow[] = expenses.map((e) => ({
    expenseDate: e.expense_date,
    description: e.description,
    category: e.category,
    supplier: e.supplier_id ? supplierNameById.get(e.supplier_id) ?? "—" : "—",
    amountGross: Number(e.amount_gross),
    taxAmount: Number(e.tax_amount),
    amountNet: Number(e.amount_gross) - Number(e.tax_amount),
    currency: e.currency ?? "ARS",
    dueDate: e.due_date,
    paidAt: e.paid_at,
    notes: e.notes,
  }));

  const buffer = await buildExpensesWorkbook(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="gastos-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

function parsePaid(v: string | null): PaidParam {
  if (v === "pagado" || v === "impago") return v;
  return "todos";
}
function parseRange(v: string | null): RangeParam {
  const allowed: RangeParam[] = ["todo", "mes-actual", "mes-anterior", "90d"];
  return (allowed as string[]).includes(v ?? "") ? (v as RangeParam) : "todo";
}
