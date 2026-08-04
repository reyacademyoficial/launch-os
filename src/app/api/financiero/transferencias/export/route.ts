import { NextResponse } from "next/server";

import {
  buildTransfersWorkbook,
  type TransferExportRow,
} from "@/lib/finance/xlsx-export";
import { resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

type DirectionParam = "todos" | "a_favor_cliente" | "transferido";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

interface TransferDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly launch_settlement_id: string | null;
  readonly bank_movement_id: string | null;
  readonly amount: number;
  readonly direction: "a_favor_cliente" | "transferido";
  readonly date: string;
  readonly notes: string | null;
}
interface ProjectNameRow {
  readonly id: string;
  readonly name: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const direction = parseDirection(url.searchParams.get("direction"));
  const range = parseRange(url.searchParams.get("range"));
  const period: Period | null = range === "todo" ? null : resolvePeriod({ range });

  const supabase = await createClient();
  let query = supabase
    .from("client_transfers")
    .select(
      "id, project_id, launch_settlement_id, bank_movement_id, amount, direction, date, notes",
    )
    .order("date", { ascending: false });
  if (direction !== "todos") query = query.eq("direction", direction);
  if (period) query = query.gte("date", period.fromYmd).lte("date", period.toYmd);

  const res = await query;
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const transfers = (res.data ?? []) as unknown as TransferDbRow[];

  const projectIds = Array.from(new Set(transfers.map((t) => t.project_id)));
  const projectsRes =
    projectIds.length > 0
      ? await supabase.from("projects").select("id, name").in("id", projectIds)
      : { data: [] as ProjectNameRow[] };
  const projectNameById = new Map<string, string>(
    ((projectsRes.data ?? []) as ProjectNameRow[]).map((p) => [p.id, p.name]),
  );

  const rows: TransferExportRow[] = transfers.map((t) => ({
    date: t.date,
    projectName: projectNameById.get(t.project_id) ?? "—",
    direction: t.direction,
    amount: Number(t.amount),
    hasSettlement: t.launch_settlement_id != null,
    hasBankMovement: t.bank_movement_id != null,
    notes: t.notes ?? "",
  }));

  const buffer = await buildTransfersWorkbook(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="transferencias-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseDirection(v: string | null): DirectionParam {
  if (v === "a_favor_cliente" || v === "transferido") return v;
  return "todos";
}
function parseRange(v: string | null): RangeParam {
  const allowed: RangeParam[] = ["todo", "mes-actual", "mes-anterior", "90d"];
  return (allowed as string[]).includes(v ?? "") ? (v as RangeParam) : "todo";
}
