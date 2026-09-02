import "server-only";

import { DEFAULT_MODEL, generateChat, type ChatTurn } from "@/lib/ai/client";

import { trimHistory, withTrimNotice } from "./history";
import { buildFinanceSystemPrompt } from "./prompt";
import type { FinanceMessageRow } from "./repo";
import { renderFinanceSnapshot } from "./render";
import { buildFinanceSnapshot } from "./snapshot";

export { DEFAULT_MODEL };

/**
 * Convierte las filas persistidas en turnos para el modelo.
 *
 * Descarta los `assistant` con `status='error'`: son la traza de un fallo
 * del proveedor, no algo que el asistente haya dicho. Mandárselos de vuelta
 * lo llevaría a disculparse por un error que no cometió o, peor, a tratar
 * el texto del error como contenido de la conversación.
 */
export function toChatTurns(
  messages: readonly FinanceMessageRow[],
): ChatTurn[] {
  return messages
    .filter((m) => !(m.role === "assistant" && m.status === "error"))
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Responde el último turno del hilo con el snapshot financiero fresco como
 * contexto. El historial completo viaja (recortado por ventana) — de ahí
 * que el modelo pueda resolver "sacá ese" o "¿y el segundo?".
 *
 * Lanza si el proveedor falla; el caller decide cómo persistirlo.
 */
export async function answerFinanceQuestion(
  messages: readonly FinanceMessageRow[],
): Promise<string> {
  const snapshot = await buildFinanceSnapshot();
  const system = buildFinanceSystemPrompt(renderFinanceSnapshot(snapshot));
  const turns = withTrimNotice(trimHistory(toChatTurns(messages)));
  return generateChat({ system, messages: turns, maxTokens: 1600 });
}
