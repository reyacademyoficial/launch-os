import "server-only";

import {
  normalizeName,
  parseYmd,
  readSheet,
  str,
  type ParseError,
  type ParseResult,
} from "@/lib/finance/xlsx-import";

/**
 * Parser xlsx → filas listas para insertar en `students` + `enrollments`.
 *
 * Modelado 1:1 sobre `parseMovementsWorkbook`:
 *   - Headers en español, tolerantes a mayúsculas/acentos/espacios.
 *   - Fechas: acepta Date de Excel o texto YYYY-MM-DD / DD/MM/YYYY.
 *   - Alias por campo (la plantilla siempre gana porque su header exacto
 *     está primero en la lista).
 *   - Resuelve producto + cohorte por nombre contra maps precargados
 *     (mismo patrón que "banco" en movimientos).
 *   - Validación por fila con rowNumber 1-indexed (1 = header, datos desde 2).
 *
 * Un mismo alumno puede aparecer en varias filas (distintos productos/
 * cohortes) — el matching por email + creación diferida es responsabilidad
 * de `confirmStudentsImport`, no del parser.
 */

export interface StudentImportRow {
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly enrolled_at: string;
  readonly cohort_id: string;
  readonly access_expires_at: string | null;
  readonly notes: string | null;
}

const STUDENT_ALIASES: Record<
  | "nombre"
  | "email"
  | "telefono"
  | "fecha"
  | "producto"
  | "cohorte"
  | "vigencia"
  | "notas",
  ReadonlyArray<string>
> = {
  nombre: ["nombre", "nombre completo", "alumno", "estudiante", "name"],
  email: ["email", "correo", "mail", "correo electronico"],
  telefono: ["telefono", "tel", "celular", "movil", "phone"],
  fecha: [
    "fecha de alta",
    "fecha alta",
    "alta",
    "fecha",
    "fecha de inscripcion",
    "enrolled at",
  ],
  producto: ["producto", "curso", "product"],
  cohorte: ["cohorte", "generacion", "cohort"],
  vigencia: [
    "vigencia hasta",
    "vigencia",
    "vence",
    "vencimiento",
    "access expires at",
  ],
  notas: ["notas", "observaciones", "notes"],
};

const STUDENT_REQUIRED: ReadonlyArray<
  keyof typeof STUDENT_ALIASES
> = ["nombre", "fecha", "producto", "cohorte"];

function resolveHeaderMap<K extends string>(
  headers: ReadonlyArray<string>,
  aliases: Record<K, ReadonlyArray<string>>,
): Record<K, string | null> {
  const claimed = new Set<string>();
  const map = {} as Record<K, string | null>;
  for (const field of Object.keys(aliases) as K[]) {
    let hit: string | null = null;
    for (const alias of aliases[field]) {
      if (headers.includes(alias) && !claimed.has(alias)) {
        hit = alias;
        break;
      }
    }
    map[field] = hit;
    if (hit) claimed.add(hit);
  }
  return map;
}

function humanHeaders(headers: ReadonlyArray<string>): string {
  const visible = headers.filter((h) => !h.startsWith("__col_"));
  return visible.length === 0 ? "(ninguno)" : visible.join(", ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Info por producto para el matching de fila.
 * cohortsByNormalizedName: nombre normalizado → cohort_id.
 */
export interface ProductForImport {
  readonly productName: string;
  readonly courseId: string;
  readonly cohortsByNormalizedName: ReadonlyMap<string, string>;
}

/**
 * `productsByName` mapea `normalizeName(productName)` → { courseId, cohortes }.
 * Un producto sin cohortes en el proyecto igual entra en el map — para dar
 * un error de fila más específico ("cohorte X no existe para producto Y").
 */
export async function parseStudentsWorkbook(
  buffer: Buffer,
  productsByName: ReadonlyMap<string, ProductForImport>,
): Promise<ParseResult<StudentImportRow>> {
  const rows: StudentImportRow[] = [];
  const errors: ParseError[] = [];
  let totalRows = 0;
  let headerError: string | null = null;

  let colNombre: string | null = null;
  let colEmail: string | null = null;
  let colTelefono: string | null = null;
  let colFecha: string | null = null;
  let colProducto: string | null = null;
  let colCohorte: string | null = null;
  let colVigencia: string | null = null;
  let colNotas: string | null = null;

  const productNamesVisible = Array.from(productsByName.values())
    .map((p) => p.productName)
    .sort();

  await readSheet(
    buffer,
    (headers) => {
      const map = resolveHeaderMap(headers, STUDENT_ALIASES);
      colNombre = map.nombre;
      colEmail = map.email;
      colTelefono = map.telefono;
      colFecha = map.fecha;
      colProducto = map.producto;
      colCohorte = map.cohorte;
      colVigencia = map.vigencia;
      colNotas = map.notas;
      const missing: string[] = [];
      for (const req of STUDENT_REQUIRED) {
        if (!map[req]) missing.push(capitalize(req));
      }
      if (missing.length > 0) {
        headerError = `Falta${missing.length > 1 ? "n" : ""} la${
          missing.length > 1 ? "s" : ""
        } columna${missing.length > 1 ? "s" : ""}: ${missing.join(
          ", ",
        )}. Detecté: ${humanHeaders(
          headers,
        )}. Usá los headers de la plantilla (Nombre, Email, Teléfono, Fecha de alta, Producto, Cohorte, Vigencia hasta, Notas).`;
      }
    },
    (record, rowNumber) => {
      if (headerError) return;
      totalRows++;
      const rowErrors: string[] = [];

      const name = colNombre ? str(record[colNombre]) : "";
      if (!name) {
        rowErrors.push("Falta el nombre");
      } else if (name.length > 200) {
        rowErrors.push("Nombre demasiado largo (máx 200)");
      }

      const emailRaw = colEmail ? str(record[colEmail]) : "";
      const email = emailRaw ? emailRaw.toLowerCase() : null;
      if (email && !EMAIL_RX.test(email)) {
        rowErrors.push(`Email "${emailRaw}" inválido`);
      }

      const phoneRaw = colTelefono ? str(record[colTelefono]) : "";
      const phone = phoneRaw
        ? phoneRaw.replace(/[^\d+]/g, "") || null
        : null;

      const enrolledAt = colFecha ? parseYmd(record[colFecha]) : null;
      if (!enrolledAt) {
        rowErrors.push(
          "Fecha de alta inválida (usá YYYY-MM-DD, DD/MM/YYYY o una fecha de Excel)",
        );
      }

      const vigenciaRaw = colVigencia ? record[colVigencia] : undefined;
      let accessExpiresAt: string | null = null;
      if (vigenciaRaw != null && String(vigenciaRaw).trim() !== "") {
        const parsed = parseYmd(vigenciaRaw);
        if (!parsed) {
          rowErrors.push("Vigencia hasta inválida");
        } else {
          accessExpiresAt = parsed;
        }
      }

      // Resolver producto + cohorte.
      let cohortId: string | null = null;
      const productNameRaw = colProducto ? str(record[colProducto]) : "";
      const cohortNameRaw = colCohorte ? str(record[colCohorte]) : "";
      if (!productNameRaw) {
        rowErrors.push("Falta el producto");
      }
      if (!cohortNameRaw) {
        rowErrors.push("Falta la cohorte");
      }
      if (productNameRaw && cohortNameRaw) {
        const product = productsByName.get(normalizeName(productNameRaw));
        if (!product) {
          const opts =
            productNamesVisible.length > 0
              ? ` Disponibles: ${productNamesVisible.join(", ")}.`
              : "";
          rowErrors.push(
            `Producto "${productNameRaw}" no existe en el proyecto.${opts}`,
          );
        } else {
          const cid = product.cohortsByNormalizedName.get(
            normalizeName(cohortNameRaw),
          );
          if (!cid) {
            const cohortOptsList = Array.from(
              product.cohortsByNormalizedName.entries(),
            );
            const cohortOpts =
              cohortOptsList.length > 0
                ? ` Cohortes de "${product.productName}": ${cohortOptsList
                    .map(([n]) => n)
                    .join(", ")}.`
                : ` "${product.productName}" no tiene cohortes cargadas.`;
            rowErrors.push(
              `Cohorte "${cohortNameRaw}" no existe para "${product.productName}".${cohortOpts}`,
            );
          } else {
            cohortId = cid;
          }
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ rowNumber, reason: rowErrors.join(" · ") });
        return;
      }

      const notes = colNotas ? str(record[colNotas]) : "";

      rows.push({
        name,
        email,
        phone,
        enrolled_at: enrolledAt as string,
        cohort_id: cohortId as string,
        access_expires_at: accessExpiresAt,
        notes: notes || null,
      });
    },
  );

  if (headerError) {
    return {
      rows: [],
      errors: [],
      totalRows: 0,
      headerError,
    };
  }
  return { rows, errors, totalRows };
}
