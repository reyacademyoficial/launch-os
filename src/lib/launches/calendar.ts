/**
 * Calendario de etapas de un lanzamiento — funciones puras.
 *
 * Toda la lógica vive acá. El SQL `0011_launch_calendar.sql` replica el
 * cálculo de `date_start` (= inicio de captación) y `date_end` (= fin de
 * cierre) en columnas GENERATED — las etapas intermedias se derivan en TS
 * al render porque no las necesita nada server-side.
 *
 * Convención de conteo (importante, NO uniforme — replica la regla del
 * roadmap exactamente para no contradecir el ejemplo):
 *   - Etapas previas (creación, nutrición, captación, calentamiento):
 *     inicio = ancla − dur, fin = ancla − 1. Rango inclusivo de exactamente
 *     `dur` días. La "ancla" de captación/calentamiento es L; la de
 *     creación/nutrición es el inicio de captación.
 *   - Compra y cierre: fin = inicio + dur. La duración es la diferencia
 *     entre los dos extremos (no inclusiva).
 *
 * Creación y nutrición son el par "pre-captación" (equivalente a
 * captación/calentamiento pero corridas una etapa hacia atrás): creación
 * termina cuando arranca captación, y nutrición se solapa dentro de creación
 * de la misma forma que calentamiento se solapa dentro de captación.
 *
 * Test numérico (ver `supabase/tests/rls_smoke_test.sql` para la versión
 * en SQL):
 *   launchDate=2026-07-10, dur=30/15/21/14/5/3 →
 *     creación       20/5 → 18/6
 *     nutrición       4/6 → 18/6   (se solapa con creación)
 *     captación      19/6 → 9/7
 *     calentamiento  26/6 → 9/7    (se solapa con captación)
 *     consumo        clase1=10/7, clase2=11/7, clase3=12/7
 *     compra         12/7 → 17/7
 *     cierre         17/7 → 20/7
 *     ventana total  19/6 → 20/7   (sync engine: cuenta desde captación)
 */

export interface LaunchCalendarInputs {
  /** Fecha de la Clase 1, ancla del calendario. Formato `YYYY-MM-DD`. */
  launchDate: string;
  durCreacion: number;
  durNutricion: number;
  durCaptacion: number;
  durCalentamiento: number;
  durCompra: number;
  durCierre: number;
}

export interface CalendarRange {
  /** YYYY-MM-DD, primer día de la etapa. */
  startDate: string;
  /** YYYY-MM-DD, último día de la etapa. */
  endDate: string;
}

export interface LaunchCalendar {
  /** Igual a `date_start` en la DB (inicio de captación). */
  windowStart: string;
  /** Igual a `date_end` en la DB (fin de cierre). */
  windowEnd: string;
  creacion: CalendarRange;
  nutricion: CalendarRange;
  captacion: CalendarRange;
  calentamiento: CalendarRange;
  consumo: {
    clase1: string;
    clase2: string;
    clase3: string;
  };
  compra: CalendarRange;
  cierre: CalendarRange;
}

/**
 * Parses a `YYYY-MM-DD` string into a UTC midnight Date. We work en UTC
 * para evitar que el TZ del navegador corra las fechas un día atrás/adelante
 * al renderizar — ej. en Buenos Aires (UTC−3), `new Date('2026-07-10')`
 * cae el 2026-07-09 19:00 local que después se formatea como "9/7".
 */
function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function fmt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Defaults del roadmap: 30/15 para el par pre-captación, 21/14/5/3 para el
 * resto. Espejados en el `default` de las migraciones (0011 + la que agrega
 * creación/nutrición).
 */
export const DEFAULT_DURATIONS = {
  durCreacion: 30,
  durNutricion: 15,
  durCaptacion: 21,
  durCalentamiento: 14,
  durCompra: 5,
  durCierre: 3,
} as const;

/**
 * Devuelve el calendario completo a partir de la fecha ancla y las 4
 * duraciones. Sin side effects, sin acceso a hora del cliente.
 */
export function computeLaunchCalendar(
  inputs: LaunchCalendarInputs,
): LaunchCalendar {
  const L = parseDate(inputs.launchDate);

  // Captación: inicio = L − dur, fin = L − 1 (inclusivo, `dur` días)
  const captacionStart = addDays(L, -inputs.durCaptacion);
  const captacionEnd = addDays(L, -1);

  // Calentamiento: igual patrón, se solapa con captación si dur_calent < dur_capt
  const calentamientoStart = addDays(L, -inputs.durCalentamiento);
  const calentamientoEnd = addDays(L, -1);

  // Creación: termina justo cuando arranca captación (día previo, inclusivo).
  // Es el par pre-captación: creación : nutrición :: captación : calentamiento.
  const creacionEnd = addDays(captacionStart, -1);
  const creacionStart = addDays(captacionStart, -inputs.durCreacion);

  // Nutrición: se solapa dentro de creación, terminando el mismo día.
  const nutricionEnd = creacionEnd;
  const nutricionStart = addDays(captacionStart, -inputs.durNutricion);

  // Consumo: clase1 = L, clase2 = L+1, clase3 = L+2
  const clase1 = L;
  const clase2 = addDays(L, 1);
  const clase3 = addDays(L, 2);

  // Compra: arranca el día de la Clase 3 y dura dur_compra (no inclusivo)
  const compraStart = clase3;
  const compraEnd = addDays(compraStart, inputs.durCompra);

  // Cierre: contiguo a Compra (rezagados), dura dur_cierre (no inclusivo)
  const cierreStart = compraEnd;
  const cierreEnd = addDays(cierreStart, inputs.durCierre);

  return {
    windowStart: fmt(captacionStart),
    windowEnd: fmt(cierreEnd),
    creacion: { startDate: fmt(creacionStart), endDate: fmt(creacionEnd) },
    nutricion: { startDate: fmt(nutricionStart), endDate: fmt(nutricionEnd) },
    captacion: { startDate: fmt(captacionStart), endDate: fmt(captacionEnd) },
    calentamiento: {
      startDate: fmt(calentamientoStart),
      endDate: fmt(calentamientoEnd),
    },
    consumo: { clase1: fmt(clase1), clase2: fmt(clase2), clase3: fmt(clase3) },
    compra: { startDate: fmt(compraStart), endDate: fmt(compraEnd) },
    cierre: { startDate: fmt(cierreStart), endDate: fmt(cierreEnd) },
  };
}

/**
 * Versión defensiva: devuelve null si falta launchDate (todavía no se
 * tipeó). Útil para el form en vivo y la sección del detalle.
 */
export function tryComputeLaunchCalendar(
  inputs: Partial<LaunchCalendarInputs>,
): LaunchCalendar | null {
  if (!inputs.launchDate) return null;
  return computeLaunchCalendar({
    launchDate: inputs.launchDate,
    durCreacion: inputs.durCreacion ?? DEFAULT_DURATIONS.durCreacion,
    durNutricion: inputs.durNutricion ?? DEFAULT_DURATIONS.durNutricion,
    durCaptacion: inputs.durCaptacion ?? DEFAULT_DURATIONS.durCaptacion,
    durCalentamiento:
      inputs.durCalentamiento ?? DEFAULT_DURATIONS.durCalentamiento,
    durCompra: inputs.durCompra ?? DEFAULT_DURATIONS.durCompra,
    durCierre: inputs.durCierre ?? DEFAULT_DURATIONS.durCierre,
  });
}
