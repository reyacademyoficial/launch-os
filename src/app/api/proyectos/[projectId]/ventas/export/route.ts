import { NextResponse } from "next/server";

import { buildProjectSalesWorkbook } from "@/lib/launch-sales/export";
import type {
  ExportCollectionStatus,
  ExportCurrency,
  SaleExportRow,
  SalesExportMeta,
} from "@/lib/launch-sales/export-types";
import { getSessionProfile, userCanEditLaunchesIn } from "@/lib/supabase/auth";

/**
 * POST /api/proyectos/[projectId]/ventas/export
 *
 * Devuelve el xlsx de la tabla de Ventas project-wide. Es POST y no GET porque
 * las filas viajan en el body: los filtros de esa tabla viven en React state
 * (no en la URL) y las columnas derivadas ya están calculadas en el cliente.
 * Ver la nota larga en `lib/launch-sales/export.ts`.
 *
 * Permisos: `can_edit_launches_in` — admin / operador / closer miembro /
 * superadmin. Cliente y coordinador no exportan, consistente con el export de
 * leads y el de daily. Se responde JSON 401/403 en vez de redirect porque el
 * caller es un `fetch`, no una navegación.
 */

/** Cap defensivo: la tabla no paginea, pero el body no puede ser infinito. */
const MAX_ROWS = 20_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!(await userCanEditLaunchesIn(projectId))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = parsePayload(payload);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // El closer nunca ve comisión, la pida o no: el flag del body es una
  // preferencia de la UI, el rol es la fuente de verdad.
  const meta: SalesExportMeta = {
    ...parsed.meta,
    hideCommission: parsed.meta.hideCommission || profile.role === "closer",
  };

  const buffer = await buildProjectSalesWorkbook(parsed.rows, meta);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ventas-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// ─── Validación del payload ────────────────────────────────────────────────

const CURRENCIES: ReadonlyArray<string> = ["ARS", "USD"];
const STATUSES: ReadonlyArray<string> = ["paid", "partial", "unpaid"];

type ParseResult =
  | { rows: SaleExportRow[]; meta: SalesExportMeta }
  | { error: string };

function parsePayload(payload: unknown): ParseResult {
  if (!isRecord(payload)) return { error: "Body inválido" };

  const rawRows = payload.rows;
  if (!Array.isArray(rawRows)) return { error: "Faltan las filas a exportar" };
  if (rawRows.length === 0) return { error: "No hay ventas para exportar" };
  if (rawRows.length > MAX_ROWS) {
    return { error: `Demasiadas filas (máximo ${MAX_ROWS})` };
  }

  const rows: SaleExportRow[] = [];
  for (const raw of rawRows) {
    if (!isRecord(raw)) return { error: "Fila inválida" };
    const currency = literal(raw.currency, CURRENCIES) as ExportCurrency | null;
    const collectedCurrency = literal(
      raw.collectedCurrency,
      CURRENCIES,
    ) as ExportCurrency | null;
    const commissionCurrency = literal(
      raw.commissionCurrency,
      CURRENCIES,
    ) as ExportCurrency | null;
    const status = literal(
      raw.status,
      STATUSES,
    ) as ExportCollectionStatus | null;
    if (!currency || !collectedCurrency || !commissionCurrency || !status) {
      return { error: "Fila inválida" };
    }

    rows.push({
      student: text(raw.student),
      email: text(raw.email),
      phone: text(raw.phone),
      contact: text(raw.contact),
      product: text(raw.product),
      launch: text(raw.launch),
      seller: text(raw.seller),
      method: text(raw.method),
      currency,
      pledged: num(raw.pledged),
      collected: num(raw.collected),
      collectedCurrency,
      mixedCurrency: raw.mixedCurrency === true,
      commission: num(raw.commission),
      commissionCurrency,
      status,
      pledgedUsd: numOrNull(raw.pledgedUsd),
      collectedUsd: numOrNull(raw.collectedUsd),
      paymentCount: num(raw.paymentCount),
      installmentCount: num(raw.installmentCount),
      closedAt: text(raw.closedAt),
    });
  }

  const rawMeta = isRecord(payload.meta) ? payload.meta : {};
  const filters = Array.isArray(rawMeta.filters)
    ? rawMeta.filters.slice(0, 20).map((f) => text(f).slice(0, 200))
    : [];

  return {
    rows,
    meta: {
      projectName: rawMeta.projectName ? text(rawMeta.projectName) : undefined,
      filters,
      hideCommission: rawMeta.hideCommission === true,
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trunca a 500 chars: los nombres vienen de la DB pero el body es del cliente. */
function text(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 500) : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function literal(v: unknown, allowed: ReadonlyArray<string>): string | null {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}
