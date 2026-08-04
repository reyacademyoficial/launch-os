import { NextResponse } from "next/server";

import { listBanks } from "@/lib/banks/list";
import {
  buildMovementsWorkbook,
  type MovementExportRow,
} from "@/lib/finance/xlsx-export";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/financiero/movimientos/export?kind=&range=
 *
 * Espeja los filtros de /financiero/movimientos. RLS es el guard de auth —
 * un cliente no tiene visibilidad sobre bank_movements y su archivo saldría
 * vacío, lo que además es lo esperado en ese rol.
 */
type KindParam = "todos" | "in" | "out";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

interface MovementDbRow {
  readonly id: string;
  readonly bank_id: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly occurred_at: string;
  readonly description: string | null;
}

interface BankRow {
  readonly id: string;
  readonly name: string;
  readonly project_id: string | null;
}

interface ProjectNameRow {
  readonly id: string;
  readonly name: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = parseKind(url.searchParams.get("kind"));
  const range = parseRange(url.searchParams.get("range"));
  const period: Period | null = range === "todo" ? null : resolvePeriod({ range });

  const supabase = await createClient();

  let query = supabase
    .from("bank_movements")
    .select("id, bank_id, kind, amount, occurred_at, description")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (kind !== "todos") query = query.eq("kind", kind);
  if (period) {
    query = query
      .gte("occurred_at", period.fromYmd)
      .lte("occurred_at", period.toYmd);
  }
  const res = await query;
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const movements = (res.data ?? []) as unknown as MovementDbRow[];

  const banks = (await listBanks()) as unknown as BankRow[];
  const bankById = new Map<string, BankRow>(banks.map((b) => [b.id, b]));

  const projectIds = Array.from(
    new Set(
      banks.map((b) => b.project_id).filter((id): id is string => id != null),
    ),
  );
  const projectNameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    for (const p of (data ?? []) as ProjectNameRow[]) {
      projectNameById.set(p.id, p.name);
    }
  }

  const rows: MovementExportRow[] = movements.map((m) => {
    const bank = bankById.get(m.bank_id);
    return {
      date: m.occurred_at,
      bankName: bank?.name ?? "—",
      projectName: bank?.project_id
        ? projectNameById.get(bank.project_id) ?? "—"
        : "—",
      kind: m.kind,
      amount: Number(m.amount),
      description: m.description ?? "",
    };
  });

  const buffer = await buildMovementsWorkbook(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="movimientos-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseKind(v: string | null): KindParam {
  if (v === "in" || v === "out") return v;
  return "todos";
}
function parseRange(v: string | null): RangeParam {
  const allowed: RangeParam[] = ["todo", "mes-actual", "mes-anterior", "90d"];
  return (allowed as string[]).includes(v ?? "") ? (v as RangeParam) : "todo";
}
