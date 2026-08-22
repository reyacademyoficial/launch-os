"use server";

import { revalidatePath } from "next/cache";

import {
  setParameterValue,
  type ParameterType,
  type ParameterValueInput,
} from "@/lib/academia/parameters";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para student_parameter_values (Fase B · 0146).
//
// La UI llama estas actions después de que el usuario tildó/escribió el
// valor. El servidor arma el ParameterValueInput discriminado por type y
// delega en el helper. RLS gatea la escritura (can_edit_project).
// ═══════════════════════════════════════════════════════════════════════════

export type SetParameterValueResult = { ok: true } | { error: string };

function coerceValue(
  type: ParameterType,
  raw: unknown,
): ParameterValueInput | string {
  if (type === "boolean") {
    if (typeof raw === "boolean") return { type, value: raw };
    if (typeof raw === "string") {
      const lower = raw.trim().toLowerCase();
      if (lower === "true" || lower === "on" || lower === "1") {
        return { type, value: true };
      }
      if (lower === "false" || lower === "off" || lower === "0" || lower === "") {
        return { type, value: false };
      }
    }
    return "El valor debe ser boolean.";
  }
  if (type === "integer") {
    let num: number | null = null;
    if (typeof raw === "number") num = raw;
    else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return "El valor entero es requerido.";
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) num = parsed;
    }
    if (num === null || !Number.isInteger(num)) {
      return "El valor debe ser un entero.";
    }
    return { type, value: num };
  }
  // text
  if (typeof raw === "string") return { type, value: raw };
  if (raw == null) return { type, value: "" };
  return "El valor debe ser texto.";
}

export async function setParameterValueAction(input: {
  readonly enrollmentId: string;
  readonly parameterId: string;
  readonly studentId: string;
  readonly type: ParameterType;
  readonly value: boolean | number | string | null;
}): Promise<SetParameterValueResult> {
  if (!input.enrollmentId) return { error: "Falta el id de la inscripción." };
  if (!input.parameterId) return { error: "Falta el id del parámetro." };
  if (!input.studentId) return { error: "Falta el id del estudiante." };

  const coerced = coerceValue(input.type, input.value);
  if (typeof coerced === "string") return { error: coerced };

  try {
    await setParameterValue(input.enrollmentId, input.parameterId, coerced);
    revalidatePath(`/academia/estudiantes/${input.studentId}`);
    revalidatePath("/academia/estudiantes");
    revalidatePath("/academia");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { error: message };
  }
}
