/**
 * Traductor de errores de Postgres (via postgrest-js) a mensajes que un
 * humano puede leer. Pura, sin efectos, sin dependencias — testeable.
 *
 * Vive en su propio archivo porque `actions.ts` lleva "use server" y ese
 * régimen solo permite exportar funciones async. Además, dejarlo aparte
 * mantiene la traducción explícita como contrato: si mañana la RPC empieza
 * a devolver un código nuevo, este archivo es el único lugar que hay que
 * tocar (y hay tests que fallan si un caso deja de manejarse).
 */

export interface RotateRuleErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
}

/**
 * Devuelve el mensaje friendly para mostrar al usuario. Si el error no matchea
 * ningún caso conocido, devolvemos el mensaje original — vale más un mensaje
 * técnico que uno silencioso.
 */
export function translateRotateRuleError(error: RotateRuleErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar la regla.";

  // 23505 = unique_violation. Bajo el partial unique de settlement_rules
  // (activo por scope) solo puede pasar por carrera: dos usuarios editaron
  // a la vez y uno llegó primero. El otro ve este mensaje.
  if (code === "23505") {
    return (
      "Otra persona modificó esta regla mientras la editabas. Recargá la " +
      "página y volvé a intentar."
    );
  }

  // 23514 = check_violation. Nuestras validaciones de coherencia
  // (proyecto ↔ organización, lanzamiento ↔ proyecto) de la RPC 0097 lo usan.
  // El mensaje de la RPC ya viene en castellano llano, propagamos tal cual.
  if (code === "23514") {
    return message;
  }

  return message;
}
