/**
 * Recorte del historial que se le manda al modelo.
 *
 * Pura, sin DB. La conversación completa SIEMPRE queda persistida y visible
 * en la UI — lo que se poda es solo lo que viaja en la request, para no
 * romper el límite de contexto ni pagar tokens por un turno de hace 40
 * mensajes que ya nadie referencia.
 *
 * Estrategia: ventana deslizante desde el final. Los turnos recientes son
 * los que resuelven las referencias ("sacá ese", "el segundo"); los viejos
 * son historia. Si el hilo se poda, el caller antepone una nota para que el
 * modelo sepa que hubo turnos previos y no invente continuidad.
 */

import type { ChatTurn } from "@/lib/ai/client";

export interface TrimHistoryOptions {
  /** Tope de turnos (user + assistant) que viajan. Default 20. */
  readonly maxTurns?: number;
  /** Tope de caracteres sumados. Default 24000 (~6k tokens). */
  readonly maxChars?: number;
}

export interface TrimmedHistory {
  readonly turns: readonly ChatTurn[];
  /** Cuántos turnos quedaron afuera por el recorte. */
  readonly droppedTurns: number;
}

export function trimHistory(
  turns: readonly ChatTurn[],
  opts: TrimHistoryOptions = {},
): TrimmedHistory {
  const maxTurns = opts.maxTurns ?? 20;
  const maxChars = opts.maxChars ?? 24_000;

  const kept: ChatTurn[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    // El último turno entra SIEMPRE, aunque sea gigante: es la pregunta que
    // hay que responder. Sin este guard, un mensaje largo del usuario
    // produciría un array vacío y la llamada fallaría.
    if (kept.length > 0) {
      if (kept.length >= maxTurns) break;
      if (chars + turn.content.length > maxChars) break;
    }
    kept.push(turn);
    chars += turn.content.length;
  }
  kept.reverse();

  // Un hilo que arranca con `assistant` es una respuesta huérfana: sin la
  // pregunta que la originó aporta poco y confunde al modelo sobre quién
  // dijo qué. Se descarta (cuenta como podada).
  while (kept.length > 1 && kept[0]!.role === "assistant") kept.shift();

  return { turns: kept, droppedTurns: turns.length - kept.length };
}

/**
 * Nota que se antepone al primer turno cuando hubo poda. Le dice al modelo
 * que la conversación empezó antes, para que no arranque como si fuera el
 * primer mensaje ni asuma que nunca se habló de otra cosa.
 */
export function historyTrimNotice(droppedTurns: number): string {
  return `[Nota del sistema: esta conversación tiene ${droppedTurns} mensajes previos que no se incluyen por límite de contexto. Si el usuario referencia algo que no ves en el hilo, pedile que lo repita en vez de inventarlo.]`;
}

/** Aplica la nota de poda al hilo recortado. Si no hubo poda, lo devuelve igual. */
export function withTrimNotice(trimmed: TrimmedHistory): readonly ChatTurn[] {
  if (trimmed.droppedTurns === 0) return trimmed.turns;
  const first = trimmed.turns[0];
  if (!first) return trimmed.turns;
  return [
    { ...first, content: `${historyTrimNotice(trimmed.droppedTurns)}\n\n${first.content}` },
    ...trimmed.turns.slice(1),
  ];
}
