import "server-only";

import { createHmac } from "node:crypto";

import { getExternalApp } from "./external-apps";

/**
 * external-app-nitro-sessions — Bonus / segunda iteración (Fase G).
 *
 * Traer sesiones individuales agendadas por sistema/mes desde la app externa
 * Nitro para alimentar el reporte de Fase E (`monthlyAttendanceBySystem`).
 *
 * ⚠ ESTADO: NO IMPLEMENTADO todavía. Requiere que el backend Nitro exponga:
 *
 *     GET /api/sesiones-individuales?systemId=<uuid>&year=<int>&month=<int>
 *     Authorization: Bearer <config.secret>
 *
 *     Respuesta esperada:
 *     {
 *       "count": <int>,       // total de sesiones agendadas del sistema/mes
 *       "byStudent": [
 *         { "email": "...", "sessions": <int> }
 *       ]
 *     }
 *
 * Cuando exista el endpoint, wire-up: reemplazar `individualSessions: null`
 * en `system-reports.ts` (monthlyAttendanceBySystem) con una llamada acá.
 *
 * El match sistema Kingrow ↔ sistema Nitro se hace por `systemId` UUID —
 * asumiendo que Nitro tiene el mismo id o un mapping por config. Alternativa:
 * pasar `systemName` en vez de id y matchear del lado Nitro.
 */

export interface IndividualSessionsResponse {
  readonly count: number;
  readonly byStudent: ReadonlyArray<{
    readonly email: string;
    readonly sessions: number;
  }>;
}

/**
 * TODO: no implementado. Lanza error explícito para que la llamada quede
 * visible en el placeholder del reporte mensual.
 *
 * Cuando el backend Nitro esté listo:
 * 1) Reemplazar el body de esta función con un fetch al endpoint
 * 2) Usar `config.secret` de la app como Bearer
 * 3) Parsear la respuesta y retornarla tipada
 * 4) Wire-up en system-reports.ts
 */
export async function fetchIndividualSessionsBySystem(
  appId: string,
  systemId: string,
  year: number,
  month: number,
): Promise<IndividualSessionsResponse> {
  const app = await getExternalApp(appId);
  if (!app) throw new Error(`external_app ${appId} no existe.`);
  if (!app.active) throw new Error(`external_app ${appId} está inactiva.`);

  const secret = app.config?.secret;
  if (!secret) {
    throw new Error(
      `external_app ${appId}: config.secret requerido para fetchIndividualSessionsBySystem.`,
    );
  }

  // TODO Fase G-bonus: implementar cuando el backend Nitro exponga el endpoint.
  // El HMAC de abajo es para request signing opcional — se puede pedir del
  // lado Nitro para validar que la request viene de Kingrow.
  const _requestSignature = createHmac("sha256", secret)
    .update(`${systemId}.${year}.${month}`)
    .digest("hex");

  throw new Error(
    "fetchIndividualSessionsBySystem: no implementado todavía. " +
      "Requiere endpoint 'GET /api/sesiones-individuales' en el backend Nitro. " +
      "Ver docs/INTEGRATIONS_NITRO_APP.md.",
  );
}
