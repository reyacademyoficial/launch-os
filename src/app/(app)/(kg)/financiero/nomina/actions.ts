"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno — patrón discriminated union del resto del módulo
// ═══════════════════════════════════════════════════════════════════════════

export type CreatePayrollState =
  | { ok: true; payrollId: string }
  | { error: string }
  | null;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function isYmd(s: string): boolean {
  return YMD_RX.test(s);
}

/**
 * Parsea el jsonb `extras` que envía el drawer como string. Formato aceptado:
 * `[{ label: "Aguinaldo", amount: 5000 }, { label: "Descuento", amount: -800 }]`.
 * Convierte a `{ [label]: amount }` — el shape sugerido por la doc de 0066
 * (aguinaldo, bonus_produccion, retencion_ganancias, etc.). Si viene malformado
 * devuelve `{}` (sin extras) para no romper el flujo por un typo.
 */
function parseExtras(raw: string): Record<string, number> {
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const label = String(
        (item as { label?: unknown }).label ?? "",
      ).trim();
      const amount = Number((item as { amount?: unknown }).amount);
      if (label.length === 0 || !Number.isFinite(amount)) continue;
      // Colapsa labels repetidos sumando — el humano puede querer dos filas
      // "Bonos" (una +1000, otra +500) y contablemente son la misma partida.
      out[label] = (out[label] ?? 0) + amount;
    }
    return out;
  } catch {
    return {};
  }
}

function sumExtras(extras: Record<string, number>): number {
  return Object.values(extras).reduce((acc, n) => acc + n, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// createPayroll
// ═══════════════════════════════════════════════════════════════════════════

export async function createPayroll(
  _prev: CreatePayrollState,
  formData: FormData,
): Promise<CreatePayrollState> {
  const personId = String(formData.get("person_id") ?? "").trim();
  if (personId.length === 0) {
    return { error: "Elegí una persona." };
  }

  const periodStart = String(formData.get("period_start") ?? "").trim();
  const periodEnd = String(formData.get("period_end") ?? "").trim();
  if (!isYmd(periodStart) || !isYmd(periodEnd)) {
    return { error: "El período tiene que tener fecha de inicio y fin válidas." };
  }
  if (periodEnd < periodStart) {
    return { error: "El fin del período no puede ser anterior al inicio." };
  }

  const baseSalary = Number(formData.get("base_salary"));
  if (!Number.isFinite(baseSalary) || baseSalary < 0) {
    return { error: "El sueldo base tiene que ser un número positivo o cero." };
  }

  const extras = parseExtras(String(formData.get("extras") ?? ""));
  const totalAmount = baseSalary + sumExtras(extras);
  if (totalAmount < 0) {
    return {
      error:
        "El total neto no puede quedar negativo. Revisá los descuentos vs. el sueldo base.",
    };
  }

  const currency = String(formData.get("currency") ?? "ARS").trim() === "USD"
    ? "USD"
    : "ARS";

  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const dueDate = dueDateRaw.length === 0 ? null : dueDateRaw;
  if (dueDate != null && !isYmd(dueDate)) {
    return { error: "La fecha de vencimiento no es válida." };
  }

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length === 0 ? null : notesRaw;

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createClient();
  const payload = {
    organization_id: organizationId,
    person_id: personId,
    period_start: periodStart,
    period_end: periodEnd,
    base_salary: baseSalary,
    extras,
    total_amount: totalAmount,
    currency,
    due_date: dueDate,
    notes,
  } as never;

  const { data, error } = await supabase
    .from("payroll")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    // Unique (person_id, period_start, period_end) — evita cargar dos veces
    // la misma liquidación por error.
    if (error.code === "23505") {
      return {
        error:
          "Ya existe una liquidación de esta persona para ese mismo período. Editá la existente en vez de crear una nueva.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero");
  return { ok: true, payrollId: created.id };
}
