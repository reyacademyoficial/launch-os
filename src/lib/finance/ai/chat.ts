import "server-only";

import { DEFAULT_MODEL, generateChat, type ChatTurn } from "@/lib/ai/client";

import { trimHistory, withTrimNotice } from "./history";
import { buildFinanceSystemPrompt } from "./prompt";
import type { FinanceMessageRow } from "./repo";
import { renderFinanceSnapshot, type SnapshotDetail } from "./render";
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
 * Tope de salida. 700 tokens ≈ 500 palabras: holgado para el límite de 150
 * palabras del prompt, y suficiente para una tabla de recortes larga sin
 * que la respuesta se corte a mitad de frase.
 */
const MAX_ANSWER_TOKENS = 700;

/**
 * Responde el último turno del hilo con el snapshot financiero fresco como
 * contexto. El historial (recortado por ventana) viaja completo — de ahí que
 * el modelo pueda resolver "sacá ese" o "¿y el segundo?".
 *
 * El nivel de detalle del snapshot depende del turno: completo en el
 * primero, compacto después. Ver `render.ts` para el razonamiento — en
 * resumen, el detalle fino ya circuló por la conversación y reenviarlo en
 * cada request es pagar dos veces por el mismo dato.
 *
 * Lanza si el proveedor falla; el caller decide cómo persistirlo.
 */
export async function answerFinanceQuestion(
  messages: readonly FinanceMessageRow[],
): Promise<string> {
  const snapshot = await buildFinanceSnapshot();
  const system = buildFinanceSystemPrompt(
    renderFinanceSnapshot(snapshot, { detail: snapshotDetailFor(messages) }),
  );
  const turns = withTrimNotice(trimHistory(toChatTurns(messages)));
  return generateChat({ system, messages: turns, maxTokens: MAX_ANSWER_TOKENS });
}

/**
 * Primer turno del hilo → detalle completo. De ahí en más, compacto.
 *
 * Se mide por respuestas EFECTIVAS del asistente (no por cantidad de
 * mensajes): si el primer intento falló contra el proveedor, el usuario
 * todavía no vio ningún detalle, así que el reintento tiene que mandar el
 * snapshot completo igual.
 */
export function snapshotDetailFor(
  messages: readonly FinanceMessageRow[],
): SnapshotDetail {
  const answered = messages.some(
    (m) => m.role === "assistant" && m.status === "ok",
  );
  return answered ? "compact" : "full";
}
