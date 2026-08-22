# Integración con la app externa Nitro (SSO)

**Fase G del plan Academia** — ver [`kingrow-academia-plan.md`](./kingrow-academia-plan.md).

Documenta cómo Kingrow conecta un curso con una plataforma externa (típicamente la app de agenda de turnos de Nitro) usando SSO — el alumno hace click en un botón desde el detalle del curso y llega a la app externa con la sesión ya iniciada.

## Diseño

- Tabla `external_apps` (migración `0153`) — registro de apps por proyecto, con `auth_strategy` + `config` jsonb.
- FK `courses.external_app_id` — un curso apunta a una app opcional.
- Endpoint `GET /api/academia/external-app/sso?courseId=<uuid>` — devuelve `{ url }` con el enlace de SSO.
- UI:
  - CRUD en `/academia/apps-externas` (visible a admin/coordinador/superadmin).
  - Botón "Abrir <app>" en el detalle del curso cuando `course.external_app_id` está seteado y la app está activa.

## Estrategias de auth soportadas

La estrategia se elige por app en el CRUD. Cada una consume un subset de `config` (jsonb).

### `jwt` (recomendada por default)

- Firma un JWT HS256 con `config.secret`. Payload:
  ```json
  { "email": "…", "courseId": "…", "iat": …, "exp": …, "iss": "…?", "aud": "…?" }
  ```
- URL: `${base_url}?${config.token_param|"token"}=<jwt>` (o `#…` si `config.token_placement="hash"`).
- Config requerida:
  - `secret` — shared secret (mín. 32 chars recomendado)
- Config opcional:
  - `issuer`, `audience` — claims JWT
  - `token_param` (default `"token"`)
  - `token_placement` (`"query"` default | `"hash"`)
  - `expires_in_seconds` (default `300`)

**Cómo la valida Nitro:** el backend Nitro (Next.js 16 + Supabase) tiene que exponer un route handler (por ejemplo `app/api/sso/kingrow/route.ts`) que:
1. Lee el `token` del query
2. Valida la firma HMAC-SHA256 con el mismo secret
3. Chequea `exp > now`
4. Resuelve el usuario por `payload.email` (Supabase Admin API — `admin.getUserByEmail`)
5. Setea la sesión (por ejemplo `admin.generateLink({ type: "magiclink" })` + redirect) o crea la sesión directamente
6. Redirige a la home o al detalle relevante

### `shared_secret` (más simple)

- HMAC-SHA256 sobre `${email}.${ts}` firmado con `config.secret`.
- URL: `${base_url}?email=…&ts=…&sig=…&courseId=…`
- Config requerida: `secret`
- La app externa recomputa el HMAC con el mismo secret y valida el `ts` no muy antiguo (5 min).

### `magic_link` (backend-driven)

- POST al `config.magic_link_endpoint` con `Authorization: Bearer <config.secret>` y body `{ email, courseId }`.
- El backend responde `{ url: "…" }` — usualmente el resultado de `supabase.auth.admin.generateLink({ type: "magiclink", email })`.
- Config requerida: `secret`, `magic_link_endpoint`

### `oauth2` (no implementado)

Placeholder — dispara error hasta que se implemente el intercambio OAuth completo.

## Elección para la app Nitro

**Estrategia recomendada: `jwt`** (o `magic_link` si el backend Nitro no puede validar JWTs sin librería extra).

Justificación:
- La app Nitro (`C:\Users\40306\Desktop\dev\agenda-turnos-nitro`) es Next.js 16 + Supabase (mismo stack que Kingrow). No expone endpoints REST hoy — usa Server Actions y una ruta pública `/reserva/[userSlug]` para clientes sin login.
- Para SSO, hay que agregar un route handler mínimo en Nitro (`app/api/sso/kingrow/route.ts`).
- `jwt` evita round-trip HTTP y es más simple de implementar en el backend Nitro con Node crypto puro (sin agregar dependencia).
- `magic_link` es la alternativa si el equipo de Nitro prefiere reusar el flujo de magic link de Supabase Auth (que ya usa).

## Setup paso a paso

### 1. Crear la app en Kingrow

1. Ir a `/academia/apps-externas`
2. Click "+ Nueva app"
3. Completar:
   - Proyecto: el proyecto propia (ej. "Rey Academy")
   - Nombre: `Nitro Agenda`
   - URL base: `https://agenda.nitro.reyacademy.com` (o donde esté deployada)
   - Estrategia: `jwt`
   - Secret: generado con `openssl rand -hex 32` — GUARDAR EN UN PASSWORD MANAGER
   - Issuer: `kingrow`
   - Audience: `nitro`
   - Validez: 300 s

### 2. Vincular la app al curso

Por ahora se hace desde SQL Studio hasta que se agregue el selector al form del curso (Fase H):

```sql
update public.courses
   set external_app_id = (select id from public.external_apps where name = 'Nitro Agenda' and project_id = <project>)
 where id = <course_id>;
```

O programáticamente vía `linkExternalAppToCourse(courseId, appId)` en `src/app/(app)/(kg)/academia/cursos/actions.ts`.

### 3. Configurar el backend Nitro

En el repo de Nitro (`agenda-turnos-nitro`), agregar `app/api/sso/kingrow/route.ts`. Env vars necesarias:

- `KINGROW_SSO_SECRET` — el mismo secret que se guardó en `external_apps.config.secret`
- `KINGROW_SSO_ISSUER` = `kingrow` (opcional, para validar `iss`)
- `KINGROW_SSO_AUDIENCE` = `nitro` (opcional, para validar `aud`)

Pseudocódigo del handler:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "no token" }, { status: 400 });

  const [h, p, s] = token.split(".");
  const expected = createHmac("sha256", process.env.KINGROW_SSO_SECRET!)
    .update(`${h}.${p}`)
    .digest();
  const actual = Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/") + "==".slice(0, (4 - s.length % 4) % 4), "base64");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: "bad sig" }, { status: 401 });
  }

  const payload = JSON.parse(Buffer.from(p.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString("utf8"));
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "expired" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: payload.email,
  });
  if (error || !data.properties?.action_link) {
    return NextResponse.json({ error: "sso failed" }, { status: 500 });
  }
  return NextResponse.redirect(data.properties.action_link, 302);
}
```

## Endpoints/paths creados

- `supabase/migrations/0153_external_apps.sql`
- `src/lib/academia/external-apps.ts` — CRUD helper
- `src/lib/academia/external-app-sso.ts` — generador de URL (jwt/shared_secret/magic_link)
- `src/app/api/academia/external-app/sso/route.ts` — endpoint que resuelve el student por email y devuelve `{ url }`
- `src/app/(app)/(kg)/academia/apps-externas/{page,view,actions}.tsx` — CRUD UI
- `src/app/(app)/(kg)/academia/cursos/[courseId]/open-external-app-button.tsx` — botón en detalle del curso

## Security notes

- El `secret` vive en `external_apps.config` (jsonb) sin cifrado nativo. En producción se recomienda:
  - Rotar el secret si se filtra (editable desde el CRUD)
  - Restringir el acceso al proyecto en Kingrow (RLS + roles admin/coordinador)
  - Considerar mover a `pgcrypto` o env var en el futuro
- El JWT dura 5 min por default — no se puede reusar más allá.
- El endpoint SSO chequea que el user de Kingrow sea un `student` del proyecto (match por email). Si no es alumno, 403.
- No se logea el secret; solo `appId` + `strategy` en errores.

## Reportería (segunda iteración — pendiente)

El plan Fase E dejó un placeholder en `src/app/(app)/(kg)/academia/cursos/[courseId]/sistemas/[systemId]/reporte-mensual/page.tsx` para "sesiones individuales" leídas desde Nitro. Una vez que el backend Nitro exponga un endpoint tipo `GET /api/sesiones-individuales?systemId=…&year=…&month=…`, agregar:

- `src/lib/academia/external-app-nitro-sessions.ts` con `fetchIndividualSessionsBySystem(systemId, year, month)` que llame al endpoint (usando `config.secret` como bearer) y devuelva `{ count }`.
- Integrar en `system-reports.ts` reemplazando `individualSessions: null`.

**Bloqueado** hasta que Nitro exponga el endpoint público con auth.
