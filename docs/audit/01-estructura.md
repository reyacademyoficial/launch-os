# 01 · Inventario estructural

> Snapshot al commit `b0136f1` en `main`, working tree limpio.
> Fecha de auditoría: 2026-07-23.

---

## 1.1 Árbol de directorios (top 2 niveles)

Ignoro `node_modules/`, `.next/`, `.git/`, `docs/legacy/`, `html/`, `tsconfig.tsbuildinfo`.

```
launch-os/
├── .claude/                      · settings.local.json (herramientas locales, no producción)
├── docs/
│   ├── AUDITORIA.md              · desactualizado (ver Paso 8 — Discrepancias)
│   ├── INTEGRATIONS_GHL.md
│   ├── INTEGRATIONS_META.md
│   ├── audit/                    · SALIDA DE ESTA AUDITORÍA
│   └── legacy/                   · prototipo Vite (excluido en tsconfig y eslint)
├── public/                       · vacío salvo `.gitkeep`
├── src/
│   ├── app/                      · App Router (126 archivos ts/tsx, 12 828 LOC)
│   │   ├── (admin)/admin/        · superadmin
│   │   ├── (app)/                · dashboard interno (Growins/admin/cliente)
│   │   ├── (auth)/               · login + set-password
│   │   ├── (cliente)/portal/     · portal de cliente final (Fase 6 arrancada)
│   │   ├── api/                  · route handlers (JSON, xlsx exports, PDFs)
│   │   ├── auth/confirm/         · handler PKCE/OTP
│   │   ├── globals.css           · tokens Tailwind v4 (@theme)
│   │   ├── layout.tsx            · root layout
│   │   └── theme-actions.ts      · Server Action de tema
│   ├── components/               · (102 archivos, 17 291 LOC)
│   │   ├── charts/               · VACÍO (.gitkeep)
│   │   ├── client-portal/        · 6 archivos, 309 LOC — shell del portal cliente
│   │   ├── dashboard/            · 85 archivos, 16 407 LOC — grueso del frontend
│   │   ├── notifications/        · 1 archivo (`notification-bell.tsx`, 274 LOC)
│   │   └── ui/                   · 8 archivos, 301 LOC — primitivas
│   ├── hooks/                    · VACÍO (.gitkeep)
│   ├── lib/                      · (127 archivos, 21 524 LOC)
│   ├── types/                    · VACÍO
│   └── proxy.ts                  · ex-middleware Next 16 (session refresh + redirect)
├── supabase/
│   ├── config.toml               · project_id=launch-os, pg 17, storage 50 MiB, sin SMTP
│   ├── migrations/               · 47 archivos SQL, 5 861 LOC
│   └── tests/
│       └── rls_smoke_test.sql    · 1 353 LOC (pgTAP)
├── .env.example                  · sólo nombres, ver 1.6
├── .env.local                    · presente, NO leído en esta auditoría
├── .gitignore
├── .prettierignore / .prettierrc
├── eslint.config.mjs
├── next-env.d.ts
├── next.config.ts                · sólo `reactStrictMode: true`
├── package.json
├── package-lock.json
├── postcss.config.mjs            · plugin `@tailwindcss/postcss`
├── README.md                     · 179 LOC
├── tsconfig.json                 · strict + `noUncheckedIndexedAccess`
└── vitest.config.ts              · tests puros en `src/**/*.test.ts`
```

**No hay** `vercel.json`, `vercel.ts`, `.nvmrc`, `.node-version`, `Dockerfile`, `docker-compose.yml`, ni scripts CI en `.github/`. Config de deploy = zero-config Next en Vercel.

---

## 1.2 Volumen por carpeta

### 1.2.1 Top-level bajo `src/`

| Carpeta | Archivos | LOC (ts/tsx/css) |
| --- | ---: | ---: |
| `src/app/` | 126 | 12 828 |
| `src/components/` | 102 | 17 291 |
| `src/lib/` | 127 | 21 524 |
| `src/hooks/` | 1 (.gitkeep) | 0 |
| `src/types/` | 0 | 0 |

Total: **356 archivos, 51 643 LOC** en `src/`. Sumando `supabase/` (48 SQL, 7 214 LOC): **404 archivos, 58 857 LOC** productivos.

### 1.2.2 Segundo nivel de `src/app/` (rutas + Route Handlers)

Ordenado por LOC descendente:

| Carpeta | Archivos | LOC |
| --- | ---: | ---: |
| `src/app/(app)/proyectos/` | 59 | 8 284 |
| `src/app/(cliente)/portal/` | 19 | 1 154 |
| `src/app/api/proyectos/` | 6 | 950 |
| `src/app/(admin)/admin/` | 11 | 719 |
| `src/app/(app)/dev/` | 2 | 380 |
| `src/app/api/portal/` | 2 | 248 |
| `src/app/(app)/configuracion/` | 4 | 208 |
| `src/app/(auth)/login/` | 4 | 136 |
| `src/app/(app)/calculadora/` | 3 | 133 |
| `src/app/(auth)/set-password/` | 4 | 111 |
| `src/app/auth/confirm/` | 1 | 60 |
| `src/app/api/notifications/` | 2 | 49 |

Observaciones:
- La ruta protegida `/(app)/proyectos/[projectId]/…` concentra el **65 % del código bajo `app/`** (8 284 / 12 828 LOC).
- `(app)/dev/auditoria` — ruta de superadmin (2 archivos, 380 LOC) — no aparece en `docs/AUDITORIA.md`. Discrepancia registrada.
- `(cliente)/portal/` ya existe con 19 archivos → confirma que **Fase 6 arrancó** (contradice memoria `project_launchos_roadmap_v2` que la marca "no empezada").

### 1.2.3 Segundo nivel de `src/lib/`

Ordenado por LOC descendente:

| Carpeta | Archivos | LOC | Nota |
| --- | ---: | ---: | --- |
| `integrations/` | 14 | 8 983 | Meta, GHL, SendFlow + sync engines + fixtures |
| `types/` | 1 | 1 460 | tipos generados de Supabase (ver `database.ts`) |
| `leaderboard/` | 4 | 1 328 | agregado + `aggregate.test.ts` (713 LOC) |
| `reports/` | 2 | 1 145 | PDFs ejecutivos y de comisiones |
| `commissions/` | 6 | 1 135 | cálculo + tests |
| `leads/` | 9 | 994 | import, dedup, kanban helpers |
| `launch-daily/` | 7 | 800 | agregado y merge manual↔API |
| `launch-sales/` | 3 | 496 | |
| `launch-community/` | 5 | 464 | SendFlow retention |
| `analytics/` | 3 | 368 | |
| `client-portal/` | 4 | 357 | endpoints internos del portal |
| `alerts/` | 3 | 346 | |
| `supabase/` | 5 | 332 | clientes browser/server/service + middleware refresh |
| `launch-opportunities/` | 3 | 305 | |
| `launches/` | 5 | 286 | |
| `installments/` | 3 | 268 | cuotas (Fase 11) |
| `ai/` | 4 | 252 | |
| `banks/` | 3 | 177 | |
| `calculator/` | 2 | 171 | reverse/forward puros |
| `auth/` | 2 | 161 | permissions + Server Actions |
| `sales/` | 2 | 158 | |
| `projects/` | 2 | 142 | |
| `notifications/` | 3 | 105 | |
| `users/` | 1 | 85 | |
| `audit/` | 1 | 83 | |
| `projections/` | 2 | 69 | |
| `launch-messages/` | 1 | 67 | |
| `payment-methods/` | 2 | 46 | |
| `team/` | 2 | 42 | |
| `payouts/` | 2 | 41 | |
| `products/` | 2 | 39 | |
| `test-shims/` | 1 | 4 | `server-only` shim para vitest |

**32 subcarpetas** en `src/lib/` — es la superficie de código más rica y donde vive la mayor parte de la lógica de negocio.

### 1.2.4 Segundo nivel de `src/components/dashboard/`

| Carpeta | Archivos | LOC |
| --- | ---: | ---: |
| `sales/` | 5 | 4 112 |
| `launches/` | 22 | 3 643 |
| `leads/` | 6 | 2 163 |
| `calculator/` | 6 | 1 116 |
| `commissions/` | 6 | 1 037 |
| `leaderboard/` | 4 | 938 |
| `banks/` | 7 | 891 |
| `analytics/` | 5 | 628 |
| `admin/` | 5 | 536 |
| `team/` | 3 | 245 |
| `payment-methods/` | 3 | 228 |
| `products/` | 3 | 199 |

`sales/` es el componente más pesado por archivo (promedio 822 LOC/archivo) — señal a mirar en Paso 6.

---

## 1.3 Top 25 archivos por LOC (candidatos a fragmentación)

| # | LOC | Archivo |
| ---: | ---: | --- |
| 1 | 1 881 | `src/lib/integrations/ghl.ts` |
| 2 | 1 749 | `src/lib/integrations/sync.ts` |
| 3 | 1 671 | `src/components/dashboard/sales/sale-modal.tsx` |
| 4 | 1 460 | `src/lib/types/database.ts` (generado — ignorar) |
| 5 | 1 353 | `supabase/tests/rls_smoke_test.sql` |
| 6 | 1 341 | `src/lib/integrations/sync-ghl.ts` |
| 7 | 1 194 | `src/components/dashboard/sales/cobros-view.tsx` |
| 8 | 1 025 | `src/app/(app)/proyectos/[projectId]/leads/sale-actions.ts` |
| 9 | 998 | `src/lib/integrations/meta.ts` |
| 10 | 819 | `src/components/dashboard/sales/project-sales-view.tsx` |
| 11 | 713 | `src/lib/leaderboard/aggregate.test.ts` (test) |
| 12 | 688 | `src/components/dashboard/leads/import-modal.tsx` |
| 13 | 637 | `src/components/dashboard/leads/leads-table.tsx` |
| 14 | 624 | `src/lib/reports/executive-launch-pdf.tsx` |
| 15 | 623 | `src/lib/integrations/sendflow.ts` |
| 16 | 580 | `src/lib/integrations/meta.test.ts` (test) |
| 17 | 567 | `src/components/dashboard/launches/integrations/launch-integrations-section.tsx` |
| 18 | 533 | `src/app/(app)/proyectos/[projectId]/leads/page.tsx` |
| 19 | 525 | `src/app/(app)/proyectos/[projectId]/launches/actions.ts` |
| 20 | 521 | `src/lib/reports/commissions-launch-pdf.tsx` |
| 21 | 515 | `src/components/dashboard/commissions/rule-form.tsx` |
| 22 | 510 | `src/components/dashboard/launches/launch-form.tsx` |
| 23 | 506 | `src/app/(app)/proyectos/[projectId]/launches/[launchId]/sync-actions.ts` |
| 24 | 502 | `src/components/dashboard/leads/kanban-board.tsx` |
| 25 | 446 | `src/components/dashboard/banks/banks-view.tsx` |

Todos son legítimos candidatos a fragmentación **salvo** `database.ts` (autogenerado), el `rls_smoke_test.sql` (un archivo por diseño), y los `.test.ts` (que están grandes por matriz de casos, no por acoplamiento). El grueso de la deuda por tamaño está en `integrations/*` y `sales/*`.

---

## 1.4 `package.json`

Runtime: **Node.js 20.18.1 local**, npm 10.8.2. **No hay `engines` pin** en `package.json` → Vercel elegirá el default de la plataforma (hoy Node 24 LTS). Riesgo bajo pero potencial fuente de drift dev↔prod. Lo capturo en `08-riesgos.md`.

### 1.4.1 Scripts (`package.json:6-16`)

```json
"dev":         "next dev"
"build":       "next build"
"start":       "next start"
"lint":        "eslint ."
"typecheck":   "tsc --noEmit"
"test":        "vitest run"
"test:watch":  "vitest"
"format":      "prettier --write ."
"format:check":"prettier --check ."
```

Sin `postbuild`, `predeploy`, ni scripts wrapper de Supabase. Cero hooks de husky/lint-staged.

### 1.4.2 Dependencies (11)

| Paquete | Versión | Uso |
| --- | --- | --- |
| `next` | ^16.2.6 | Framework (App Router) |
| `react` | ^19.2.0 | |
| `react-dom` | ^19.2.0 | |
| `@supabase/ssr` | ^0.6.1 | Cliente Supabase con cookies (SSR) |
| `@supabase/supabase-js` | ^2.45.4 | Cliente browser + service |
| `openai` | ^6.42.0 | Resúmenes IA (server-only) |
| `recharts` | ^2.13.0 | Gráficos |
| `react-markdown` | ^10.1.0 | Renderiza resumen IA |
| `libphonenumber-js` | ^1.13.6 | Normalización de teléfonos (leads) |
| `exceljs` | ^4.4.0 | Export xlsx |
| `@react-pdf/renderer` | ^4.5.1 | PDFs ejecutivos + comisiones |

### 1.4.3 DevDependencies (11)

| Paquete | Versión |
| --- | --- |
| `typescript` | ^5.6.0 |
| `tailwindcss` | ^4.3.0 |
| `@tailwindcss/postcss` | ^4.3.0 |
| `eslint` | ^9.10.0 |
| `eslint-config-next` | ^16.2.6 |
| `prettier` | ^3.3.3 |
| `vitest` | ^1.6.1 |
| `@types/node` | ^22.7.0 |
| `@types/react` | ^19.0.0 |
| `@types/react-dom` | ^19.0.0 |

Notas:
- **No hay** `@testing-library/*`, `msw`, `playwright`, `cypress`, storybook, `@sentry/*`, `zod`, `zustand`, `react-query`, `swr`, `date-fns`, `zod`, `posthog`, ni un cliente Postgres. La app se apoya 100 % en Supabase para persistencia y no tiene testing de UI ni de integración e2e.
- **No hay** `husky`, `lint-staged` ni `commitlint`.

---

## 1.5 Archivos de configuración

### 1.5.1 `next.config.ts:1-7`

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { reactStrictMode: true };
export default nextConfig;
```

Sin `images.remotePatterns`, sin `experimental.serverActions`, sin `headers`, sin `redirects`, sin custom webpack. Todo el comportamiento es default de Next 16.

### 1.5.2 `tsconfig.json:1-47`

- `target: ES2022`, `module: esnext`, `moduleResolution: bundler`, `jsx: react-jsx`.
- **Strict habilitado + `noUncheckedIndexedAccess` + `noImplicitOverride`**.
- Alias `@/*` → `./src/*` (`tsconfig.json:27-31`).
- `docs/legacy` excluido (`tsconfig.json:40-46`).

### 1.5.3 `tailwindcss` v4 (`postcss.config.mjs:1-7`)

Sólo el plugin `@tailwindcss/postcss`. **No hay `tailwind.config.ts`** — la config vive en `src/app/globals.css` bajo `@theme`. Alineado con `feedback_tailwind_v4_config`.

### 1.5.4 `eslint.config.mjs:1-25`

- Flat config con `nextCoreWebVitals` + `nextTypescript`.
- `no-unused-vars` en `warn` con patrón `^_`.
- Ignora `docs/legacy`, `.next`, `node_modules`, `out`, `supabase`.
- **No lintea SQL** (previsible, pero notable dado el volumen: 5 861 LOC en migraciones).

### 1.5.5 `vitest.config.ts:1-25`

- Environment `node`, sólo archivos `src/**/*.test.ts`.
- Alias `@` y **shim de `server-only`** vía `src/lib/test-shims/server-only.ts` (`vitest.config.ts:15-16`) — permite testear módulos que importan `server-only` sin explotar.
- Cero coverage config, cero setup files.

### 1.5.6 `supabase/config.toml`

- `project_id = "launch-os"`, Postgres 17 (`config.toml:5,42`).
- `db.migrations.enabled = true`, sin `schema_paths` declarativos (`config.toml:59-64`).
- `db.seed.sql_paths = ["./seed.sql"]` — pero **no existe `supabase/seed.sql`** en el repo. Riesgo bajo: sólo aplica a `db reset` local.
- `auth.enable_signup = true` en config local (`config.toml:176`) → **este flag es sólo para dev local**. La política de invite-only vive en el proyecto Supabase remoto; asumo que el toggle está apagado allá pero no lo puedo verificar sin conexión. Anotado como pregunta abierta.
- `auth.minimum_password_length = 6` (`config.toml:182`) — bajo. El código UI pide 8 (`AUDITORIA.md:141`), pero el server acepta 6.
- SMTP comentado (`config.toml:237-244`) → confirma que no hay password reset por email.

### 1.5.7 `src/proxy.ts:1-49`

- Ex-`middleware.ts`, renombrado por convención Next 16.
- Refresh de sesión (`updateSession`) + redirect grueso a `/login` para paths no públicos.
- `PUBLIC_PATHS = ["/login", "/auth/confirm"]` (`proxy.ts:20`).
- Matcher exlucye assets estáticos (`proxy.ts:47`).
- **No** exclue explícitamente `api/*` → todo pasa por el proxy incluso rutas de API, que hoy es lo que queremos (todas las APIs necesitan sesión).

### 1.5.8 `next-env.d.ts`, `.prettierrc`, `.prettierignore`

- Prettier default (sin overrides notables).
- `next-env.d.ts` autogenerado.

---

## 1.6 Variables de entorno

### 1.6.1 En `.env.example` (5 nombres)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
NEXT_PUBLIC_APP_URL
```

### 1.6.2 Referenciadas efectivamente en código (4)

Grep `process.env.*` en `src/`:

| Variable | Archivo(s) | Server/Client |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/{service,server,middleware,client}.ts:16-36` | Ambos |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/supabase/{server,middleware,client}.ts:17-36` | Ambos |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase/service.ts:20` | Server-only |
| `OPENAI_API_KEY` | `src/lib/ai/client.ts:19` | Server-only |

**`NEXT_PUBLIC_APP_URL` figura en `.env.example` pero no se referencia en ningún archivo de `src/`.** Discrepancia: `AUDITORIA.md:309` dice "URL canónica (futuros redirect targets)" → está declarada pero **no se usa**.

### 1.6.3 Tokens de integraciones (Meta, GHL, SendFlow)

**NO hay variables de entorno para tokens externos.** Los tokens viven en la tabla `project_secrets` (RLS blindada, service-role only). Confirmable en Paso 4 al leer `sync.ts` y `sync-ghl.ts`. Diseño coherente con multi-tenant: cada proyecto trae sus propias credenciales.

---

## 1.7 Testing y linters

### 1.7.1 Tests unitarios (`vitest`) — 16 archivos

Todos en `src/lib/**/*.test.ts`:

```
src/lib/commissions/calc.test.ts                     (435 LOC)
src/lib/integrations/ghl-match.test.ts
src/lib/integrations/ghl-messages.test.ts
src/lib/integrations/ghl.test.ts
src/lib/integrations/meta.test.ts                    (580 LOC)
src/lib/integrations/sendflow.test.ts                (373 LOC)
src/lib/integrations/sync-ghl.test.ts
src/lib/kpis.test.ts                                 (379 LOC)
src/lib/launch-community/aggregate.test.ts
src/lib/launch-community/daily.test.ts
src/lib/launch-daily/aggregate.test.ts
src/lib/launch-daily/merge.test.ts
src/lib/launch-opportunities/aggregate.test.ts
src/lib/launch-sales/aggregate.test.ts
src/lib/leaderboard/aggregate.test.ts                (713 LOC)
src/lib/leads/import.test.ts
```

Cobertura fuerte donde importa: **integraciones + agregación + KPIs + comisiones**. Cero tests de componentes React, cero tests e2e.

### 1.7.2 Fixtures

- `src/lib/integrations/__fixtures__/{ghl,meta,sendflow}` — JSON reales de las APIs externas, alimentan los `.test.ts`.

### 1.7.3 Tests SQL

- `supabase/tests/rls_smoke_test.sql` (1 353 LOC pgTAP). Cubre RLS end-to-end. Se corre desde Studio "Run without RLS" según `feedback_studio_smoke_tests`.

### 1.7.4 Linters/formatter

- ESLint flat 9 con `eslint-config-next` — sólo lintea TS/TSX (`.mjs`, `.js` incluidos por default). **No lintea SQL**.
- Prettier 3.3.3 con `.prettierrc` default y `.prettierignore` mínimo.
- **Sin `pre-commit` hook** (no hay husky).
- Comando `npm run test` corre unit tests. `typecheck` corre `tsc --noEmit`.

---

## 1.8 Runtime y tooling local

- **Node.js**: `v20.18.1` local (según `node --version`). No hay pin en `package.json` ni `.nvmrc` — Vercel usará su default (Node 24 LTS actual). Ver `08-riesgos.md`.
- **Package manager**: npm 10.8.2. Presencia de `package-lock.json` (~418 KB) confirma npm; no hay `pnpm-lock.yaml`, `yarn.lock`, ni `bun.lockb`.
- **Supabase CLI**: no instalado localmente. `psql` sí (17), pero no se usa en esta auditoría.
- **Vercel CLI**: no instalado.

---

## 1.9 Superficie de rutas y APIs (resumen para el Paso 2)

Cuenta rápida por conteo de `page.tsx` + `route.ts` + `layout.tsx` (detalle en `02-rutas.md`):

- **Route groups**: 4 (`(admin)`, `(app)`, `(auth)`, `(cliente)`).
- **Rutas internas de Growins / admin**: `/(admin)/admin/*`, `/(app)/*`, `/(app)/dev/*`.
- **Portal cliente final**: `/(cliente)/portal/*` — **existe y tiene 19 archivos** (1 154 LOC).
- **APIs**: dos árboles paralelos: `src/app/api/proyectos/*` (dashboard interno) y `src/app/api/portal/*` (portal cliente).
- **Route Handler auth-flow**: `src/app/auth/confirm/route.ts` (60 LOC).

---

## ⚠️ No pude determinar

- **Versión de Node en Vercel prod**: no hay pin (`package.json` sin `engines`, sin `.nvmrc`). ¿Prod está en Node 20 o Node 24? Necesita verificación en el dashboard.
- **`enable_signup` en Supabase remoto**: el `config.toml` local dice `true` (`config.toml:176`) pero el proyecto real depende del toggle del dashboard. AUDITORIA.md dice que está apagado; no lo puedo confirmar sin acceso a la consola.
- **Si `NEXT_PUBLIC_APP_URL` está seteada en Vercel** aunque no se use — bajo riesgo, pero es un env "muerto" en el código.
- **`html/` en la raíz**: no la leí. ¿Es un export estático viejo, tests renderizados, o basura? Preguntar antes de tocarla.

---

## Discrepancias con `docs/AUDITORIA.md`

`AUDITORIA.md` está fechado 2026-06-06 (`AUDITORIA.md:3`) y describe una versión **congelada en la Fase 2 aproximadamente**. En la sección "Estructura del repo" (`AUDITORIA.md:333-382`) lista:

| Dice | Realidad |
| --- | --- |
| 5 migraciones (`0001`…`0005`, `AUDITORIA.md:344-348`) | **47 migraciones** (`0001`…`0047`). |
| `src/components/{ui,dashboard}` | Suma `client-portal/`, `notifications/`, `charts/` (vacía). |
| `src/lib/{ai,auth,calculator,integrations,launches,launch-daily,projects,supabase,users,format.ts,kpis.ts,types}` | 32 subcarpetas incluyendo `alerts`, `analytics`, `audit`, `banks`, `client-portal`, `commissions`, `installments`, `launch-community`, `launch-messages`, `launch-opportunities`, `launch-sales`, `leaderboard`, `leads`, `notifications`, `payment-methods`, `payouts`, `products`, `projections`, `reports`, `sales`, `team`, `test-shims`. |
| Sólo `(auth)`, `(app)`, `(admin)` route groups (`AUDITORIA.md:353-362`) | Se agregó `(cliente)/portal/` completo con 19 archivos. |
| Ausencia de `api/` en `app/` | Existen `src/app/api/{proyectos,portal,notifications}/...` con handlers, exports xlsx y probes. |
| `format.ts` en `src/lib/` | No existe archivo `src/lib/format.ts` en el árbol actual. Migró a otro lugar o se disolvió — pendiente de confirmar en Paso 6. |
| "Sin Docker" (`AUDITORIA.md:442`) | Sigue siendo cierto. |
| `.env.example` con 5 vars — coherente. `NEXT_PUBLIC_APP_URL` "usado" | En código actual **no se referencia**. |

Además `AUDITORIA.md` **no menciona en absoluto**: leads, sales, commissions/comisiones, kanban, alertas, notifications, sendflow community metrics, evergreen recycling, revenue split, products, multi-sale per lead, installments/cuotas, banks, leaderboard, portal cliente, ni la ruta dev/auditoría. Toda la superficie posterior a la Fase 2 quedó fuera de esa auditoría.

Trato completo en `08-riesgos.md` bajo "Estado real de fases".
