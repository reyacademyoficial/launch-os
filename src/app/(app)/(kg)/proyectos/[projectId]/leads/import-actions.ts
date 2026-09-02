"use server";

import { revalidatePath } from "next/cache";

import { autoMap, previewWorkbook, processWorkbookStream } from "@/lib/leads/import";
import type { ImportMapping, ImportPreview } from "@/lib/leads/import-config";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import type { CountryCode } from "libphonenumber-js";

interface ValidationContext {
  projectId: string;
  launchId: string | null;
  defaultCountry: CountryCode;
  mapping: ImportMapping;
}

/**
 * Server actions del wizard de import xlsx.
 *
 * Diseño en 3 pasos:
 *   1. previewImport — recibe el file y devuelve headers + sample rows + un
 *      mapping inicial (heurístico) para que el usuario lo edite. NO inserta.
 *   2. validateImport — parsea el archivo entero con el mapping aprobado y
 *      devuelve cuántas filas son válidas, cuántas tienen error y por qué.
 *      NO inserta. El usuario ve el reporte antes de comprometerse.
 *   3. confirmImport — re-parsea + batchea los insert con onConflict para
 *      skip de duplicados. Devuelve el resultado final.
 *
 * Por qué el archivo se sube hasta 3 veces:
 *   - Server actions de Next no mantienen state binario entre llamadas.
 *     Persistir temp en disco o storage para guardar el archivo entre pasos
 *     agrega complejidad sin valor para archivos de pocos MB.
 *   - El navegador ya tiene el File en memoria; resubirlo es trivial a esta
 *     escala. Si crece a archivos enormes, mover a un endpoint de upload con
 *     un fileId persistente.
 */

const BATCH_SIZE = 500;

export type PreviewResult =
  | { ok: true; preview: ImportPreview; suggestedMapping: Partial<ImportMapping> }
  | { ok: false; error: string };

export async function previewImport(
  projectId: string,
  _prev: PreviewResult | null,
  formData: FormData,
): Promise<PreviewResult> {
  await requireCanEditLaunchesIn(projectId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Seleccioná un archivo .xlsx" };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "El archivo tiene que ser .xlsx" };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await previewWorkbook(buffer, 5);
    if (preview.headers.length === 0) {
      return {
        ok: false,
        error: "No detecté headers en la primera fila. Revisá el archivo.",
      };
    }
    return {
      ok: true,
      preview,
      suggestedMapping: autoMap(preview.headers),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error parseando el xlsx";
    return { ok: false, error: message };
  }
}

/**
 * Tipo común para los errores reportados al usuario en cualquier etapa del
 * wizard. `rowNumber` es 1-indexed y respeta el número que ve el usuario en
 * Excel (la fila 1 es header, datos arrancan en 2).
 */
export interface ImportRowError {
  rowNumber: number;
  reason: string;
}

export type ValidateResult =
  | {
      ok: true;
      validCount: number;
      withErrors: number;
      duplicatesInFile: number;
      errors: ReadonlyArray<ImportRowError>;
    }
  | { ok: false; error: string };

/**
 * Parsea el archivo entero con el mapping del paso 2 y devuelve el reporte
 * SIN insertar. El usuario lo ve y decide si confirma o vuelve a corregir
 * el archivo. Acá se detectan los problemas que el wizard puede mostrar antes
 * del insert: filas sin nombre, números totales, duplicados internos al
 * archivo (mismo teléfono en dos filas distintas).
 *
 * Los duplicados CONTRA la DB no se ven acá — esos los reporta el insert.
 */
export async function validateImport(
  projectId: string,
  _prev: ValidateResult | null,
  formData: FormData,
): Promise<ValidateResult> {
  await requireCanEditLaunchesIn(projectId);

  const ctx = readContext(projectId, formData);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { file, context } = ctx;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { payloads, errors } = await processWorkbookStream(
      buffer,
      context.mapping,
      {
        projectId: context.projectId,
        launchId: context.launchId,
        defaultCountry: context.defaultCountry,
      },
    );

    // Duplicados internos al archivo: mismo phone_normalized aparece > 1 vez.
    // No los reporto como error (igual entran via upsert ignore-duplicates) pero
    // sí los cuento para que el usuario sepa.
    const seen = new Set<string>();
    let duplicatesInFile = 0;
    for (const p of payloads) {
      if (!p.phone_normalized) continue;
      if (seen.has(p.phone_normalized)) duplicatesInFile++;
      else seen.add(p.phone_normalized);
    }

    return {
      ok: true,
      validCount: payloads.length,
      withErrors: errors.length,
      duplicatesInFile,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error parseando el xlsx";
    return { ok: false, error: message };
  }
}

export type ConfirmResult =
  | {
      ok: true;
      imported: number;
      skippedDuplicates: number;
      errors: ReadonlyArray<ImportRowError>;
    }
  | { ok: false; error: string };

export async function confirmImport(
  projectId: string,
  _prev: ConfirmResult | null,
  formData: FormData,
): Promise<ConfirmResult> {
  await requireCanEditLaunchesIn(projectId);

  const ctx = readContext(projectId, formData);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { file, context } = ctx;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { payloads, errors } = await processWorkbookStream(buffer, context.mapping, {
      projectId: context.projectId,
      launchId: context.launchId,
      defaultCountry: context.defaultCountry,
    });

    // Dedup INTERNO del archivo: si el mismo phone_normalized viene 2 veces,
    // nos quedamos con la primera ocurrencia. Las siguientes cuentan como
    // duplicados pero no van al INSERT.
    let skippedDuplicates = 0;
    const seenInFile = new Set<string>();
    const dedupedPayloads: Array<(typeof payloads)[number]> = [];
    for (const p of payloads) {
      if (p.phone_normalized) {
        if (seenInFile.has(p.phone_normalized)) {
          skippedDuplicates++;
          continue;
        }
        seenInFile.add(p.phone_normalized);
      }
      dedupedPayloads.push(p);
    }

    const supabase = await createClient();
    let imported = 0;
    const insertErrors: ImportRowError[] = [];

    // No usamos `upsert(..., { onConflict, ignoreDuplicates: true })` porque
    // postgrest no le pasa a postgres el predicate del unique index parcial
    // (`WHERE phone_normalized IS NOT NULL`), y postgres rechaza el ON CONFLICT
    // con "no unique or exclusion constraint matching". En lugar de eso,
    // hacemos dedup explícito contra la DB con un SELECT previo por batch +
    // INSERT plano.
    for (let i = 0; i < dedupedPayloads.length; i += BATCH_SIZE) {
      const batch = dedupedPayloads.slice(i, i + BATCH_SIZE);

      // 1) Identificar phones del batch que YA existen en la DB para este
      //    proyecto y descartarlos.
      const batchPhones = batch
        .map((p) => p.phone_normalized)
        .filter((p): p is string => typeof p === "string" && p !== "");
      let existingPhones = new Set<string>();
      if (batchPhones.length > 0) {
        const existingRes = await supabase
          .from("leads")
          .select("phone_normalized")
          .eq("project_id", projectId)
          .in("phone_normalized", batchPhones);

        if (existingRes.error) {
          insertErrors.push({
            rowNumber: i + 2,
            reason: `Dedup falló: ${existingRes.error.message}`,
          });
          continue;
        }
        existingPhones = new Set(
          (existingRes.data ?? [])
            .map((r: { phone_normalized: string | null }) => r.phone_normalized)
            .filter((p): p is string => typeof p === "string"),
        );
      }

      const toInsert = batch.filter(
        (p) => !p.phone_normalized || !existingPhones.has(p.phone_normalized),
      );
      skippedDuplicates += batch.length - toInsert.length;

      if (toInsert.length === 0) continue;

      // 2) INSERT plano. Si falla, queda en el reporte y seguimos.
      const { data, error } = await supabase
        .from("leads")
        .insert(toInsert as never)
        .select("id");

      if (error) {
        insertErrors.push({
          rowNumber: i + 2,
          reason: `Batch falló: ${error.message}`,
        });
        continue;
      }
      imported += data?.length ?? 0;
    }

    revalidatePath(`/proyectos/${projectId}/leads`);
    return {
      ok: true,
      imported,
      skippedDuplicates,
      errors: [...errors, ...insertErrors],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error procesando el xlsx";
    return { ok: false, error: message };
  }
}

function nonEmpty(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Extrae el archivo + el contexto de import del FormData. Reusado por
 * `validateImport` y `confirmImport` para que se asegure el mismo parsing y
 * los mismos defaults en los dos pasos.
 */
function readContext(
  projectId: string,
  formData: FormData,
):
  | { ok: true; file: File; context: ValidationContext }
  | { ok: false; error: string } {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Falta el archivo." };
  }

  const mappingName = String(formData.get("map_name") ?? "").trim();
  if (!mappingName) {
    return { ok: false, error: "Mapeá la columna del nombre (obligatorio)." };
  }

  const mapping: ImportMapping = {
    name: mappingName,
    phone: nonEmpty(formData.get("map_phone")) ?? undefined,
    email: nonEmpty(formData.get("map_email")) ?? undefined,
    contact: nonEmpty(formData.get("map_contact")) ?? undefined,
  };

  const defaultCountry = (nonEmpty(formData.get("default_country")) ?? "AR") as CountryCode;
  const launchId = nonEmpty(formData.get("launch_id"));

  return {
    ok: true,
    file,
    context: { projectId, launchId, defaultCountry, mapping },
  };
}
