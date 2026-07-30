"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type PaymentMethodActionState =
  | { ok: true }
  | { error: string }
  | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Parsea `bank_id` del form: "" (Sin banco) → null; UUID → validado contra la
 * DB para asegurar que exista. Post 0101 los bancos son org-scope; RLS ya
 * bloquea references a bancos de otras orgs. El adelanto es solo para dar
 * mejor mensaje UX.
 */
async function parseBankId(
  _projectId: string,
  formData: FormData,
): Promise<{ bankId: string | null } | { error: string }> {
  const raw = str(formData, "bank_id");
  if (raw === "") return { bankId: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from("banks")
    .select("id")
    .eq("id", raw)
    .maybeSingle();
  if (!data) return { error: "Banco inexistente." };
  return { bankId: raw };
}

/**
 * Mismo shape que createProduct — admin-only, unique por (project_id, name).
 * Métodos "transferencia", "Stripe", "efectivo"… son project-scoped porque
 * la política contable es del proyecto entero.
 */
export async function createPaymentMethod(
  projectId: string,
  _prev: PaymentMethodActionState,
  formData: FormData,
): Promise<PaymentMethodActionState> {
  await requireCanEditProject(projectId);
  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const bankParsed = await parseBankId(projectId, formData);
  if ("error" in bankParsed) return bankParsed;

  const supabase = await createClient();
  const payload = {
    project_id: projectId,
    name,
    bank_id: bankParsed.bankId,
    active: true,
  } as never;
  const { error } = await supabase.from("payment_methods").insert(payload);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe un método con ese nombre en el proyecto." };
    }
    return { error: error.message };
  }

  revalidateForProject(projectId);
  return { ok: true };
}

export async function updatePaymentMethod(
  projectId: string,
  methodId: string,
  _prev: PaymentMethodActionState,
  formData: FormData,
): Promise<PaymentMethodActionState> {
  await requireCanEditProject(projectId);
  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };
  const active = formData.get("active") !== null;

  const bankParsed = await parseBankId(projectId, formData);
  if ("error" in bankParsed) return bankParsed;

  const supabase = await createClient();
  const payload = { name, active, bank_id: bankParsed.bankId } as never;
  const { error } = await supabase
    .from("payment_methods")
    .update(payload)
    .eq("id", methodId)
    .eq("project_id", projectId);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe otro método con ese nombre." };
    }
    return { error: error.message };
  }

  revalidateForProject(projectId);
  return { ok: true };
}

/**
 * Intenta borrar el método. La FK `payments.payment_method_id` tiene
 * `on delete restrict` — si el método tiene cobros asociados, se sugiere
 * desactivarlo en lugar de borrarlo.
 */
export async function deletePaymentMethod(
  projectId: string,
  methodId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditProject(projectId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_methods")
    .delete()
    .eq("id", methodId)
    .eq("project_id", projectId);
  if (error) {
    if (error.code === "23503") {
      return {
        error:
          "El método tiene cobros asociados. Desactivalo en vez de borrarlo para preservar el histórico.",
      };
    }
    return { error: error.message };
  }
  revalidateForProject(projectId);
  return { ok: true };
}

function revalidateForProject(projectId: string): void {
  revalidatePath(`/proyectos/${projectId}/metodos-pago`);
  revalidatePath(`/proyectos/${projectId}/leads`);
  revalidatePath(`/proyectos/${projectId}/launches`, "layout");
}
