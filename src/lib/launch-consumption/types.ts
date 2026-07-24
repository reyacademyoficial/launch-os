/**
 * Modelo de la grilla de consumo por clase de un lanzamiento.
 *
 * La tabla `launch_consumption` guarda config (start/end/interval + nombres de
 * clases) y una matriz JSONB de asistentes indexada por hora "HH:MM" → clase.
 * Este archivo define los tipos que ven la lib server y los componentes.
 */

/** Slot horario en formato "HH:MM" (24h). */
export type HourSlot = string;

/** Nombre de una clase (columna de la grilla). */
export type ClassName = string;

/**
 * Config editable por el operador. Los defaults vienen del server (o de la
 * migración) — el editor los presenta como estado inicial de los inputs.
 */
export interface ConsumptionConfig {
  /** "HH:MM" — inicio de la primera franja. */
  startTime: HourSlot;
  /** "HH:MM" — la última franja generada satisface `slot <= endTime`. */
  endTime: HourSlot;
  /** Intervalo en minutos entre franjas consecutivas. 1..240. */
  intervalMinutes: number;
  /** Columnas de la grilla — nombres únicos, orden preservado. */
  classes: ClassName[];
}

/**
 * Matriz de asistentes: hora → clase → cantidad.
 * Las celdas ausentes o no numéricas se interpretan como 0.
 */
export type ConsumptionCells = Record<HourSlot, Record<ClassName, number>>;

/**
 * Estado completo de una grilla — lo que devuelve `getConsumptionForLaunch`
 * y lo que el editor guarda con `saveConsumption`.
 */
export interface ConsumptionState {
  config: ConsumptionConfig;
  cells: ConsumptionCells;
  /** ISO timestamp — null si nunca se guardó (fila inexistente). */
  updatedAt: string | null;
}

/** Defaults que coinciden con los de la migración 0048. */
export const DEFAULT_CONSUMPTION_CONFIG: ConsumptionConfig = {
  startTime: "09:00",
  endTime: "12:00",
  intervalMinutes: 10,
  classes: ["Clase 1", "Clase 2", "Clase 3"],
};
