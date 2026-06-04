# Launch OS

Sistema operativo de lanzamientos para campañas de marketing digital. Multi-tenant
(proyecto = cliente), invite-only, con métricas de Meta/Google/TikTok Ads, WhatsApp,
webinar y ventas, KPIs derivados y proyecciones.

## Stack

- **Next.js 16** (App Router, React 19.2)
- **TypeScript** estricto (`strict`, `noUncheckedIndexedAccess`)
- **Tailwind CSS v4** — configuración CSS-first vía `@theme` en `src/app/globals.css`
  (sin `tailwind.config.ts`); integración con Next vía `@tailwindcss/postcss`
- **Supabase** — Postgres + Auth + RLS, vía `@supabase/ssr` (NO `auth-helpers`)
- **Recharts** para gráficos

## Setup local

```bash
cp .env.example .env.local      # completar valores (ver sección Variables)
npm install
npm run dev                     # http://localhost:3000
```

Comandos útiles:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run format       # prettier --write
npm run build        # build de producción
```

## Variables de entorno

Ver `.env.example`. Resumen:

| Variable                          | Lado     | Descripción                                       |
| --------------------------------- | -------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | público  | URL del proyecto Supabase                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | público  | Anon key                                          |
| `SUPABASE_SERVICE_ROLE_KEY`       | **servidor** | Service-role: invites + `project_secrets`     |
| `ANTHROPIC_API_KEY`               | **servidor** | Resumen ejecutivo con IA (Route Handler)      |
| `NEXT_PUBLIC_APP_URL`             | público  | URL canónica (usada en `redirectTo` de invites)   |

> **Regla:** `SUPABASE_SERVICE_ROLE_KEY` y `ANTHROPIC_API_KEY` nunca se importan
> desde código de cliente ni se prefijan con `NEXT_PUBLIC_`.

## Estructura

```
src/
├── app/                  # App Router
│   ├── (auth)/           # público: login, set-password
│   ├── auth/confirm/     # Route Handler: verifica token de invitación
│   ├── (app)/            # protegido: overview, launches, calculadora, etc.
│   └── (admin)/          # superadmin/admin: proyectos, usuarios
├── components/
├── lib/
│   ├── supabase/         # client / server / service (service-role)
│   ├── auth/permissions.ts   # ÚNICA fuente de verdad de permisos en cliente
│   ├── kpis.ts           # cálculos derivados (safe math)
│   └── types/database.ts # generado con `supabase gen types`
├── hooks/
└── proxy.ts              # session refresh + protección coarse (Next 16: ex-middleware)
supabase/migrations/      # SQL ordenado y reproducible
docs/legacy/              # snapshot del prototipo Vite previo
```

## Supabase

### Migraciones (Fase 2)

```bash
supabase init                 # primera vez
supabase start                # levanta Postgres local
supabase db reset             # aplica TODAS las migraciones desde cero
supabase gen types typescript --local > src/lib/types/database.ts
```

Los archivos en `supabase/migrations/` están ordenados:

- `0001_schema.sql` — tablas + extensiones
- `0002_functions.sql` — helpers `SECURITY DEFINER` + triggers
- `0003_rls.sql` — `enable RLS` + políticas
- `0004_seed.sql` — datos mínimos / bootstrap

### Primer superadmin

1. Crear el primer usuario manualmente (Dashboard de Supabase o `signup` directo
   antes de desactivar el registro abierto).
2. Promoverlo: `update public.profiles set role = 'superadmin' where id = '<auth.uid>';`

### Auth — invite-only

En el dashboard de Supabase, después del primer superadmin:

1. **Desactivar** "Allow new users to sign up".
2. **Site URL** = `NEXT_PUBLIC_APP_URL`.
3. **Redirect URLs** permitidas: `<APP_URL>/auth/confirm`, `<APP_URL>/set-password`.
4. Personalizar la plantilla de email **Invite**.

A partir de ahí, los usuarios nuevos solo entran vía `auth.admin.inviteUserByEmail`
(Server Action en `(admin)/usuarios`, con service-role).

## Roles y permisos

Tres roles globales en `profiles.role`. La pertenencia a proyectos vive en
`project_members`.

| Acción                                  | superadmin | admin            | cliente |
| --------------------------------------- | :--------: | :--------------: | :-----: |
| Ver proyectos                           | todos      | los asignados    | el suyo |
| Ver dashboard / métricas                | sí         | sí               | sí      |
| Usar calculadora                        | sí         | sí               | sí      |
| Cargar / editar datos                   | sí         | sí               | **no**  |
| Cargar / editar API keys                | sí         | sí               | **no**  |
| Invitar usuarios / crear proyectos      | sí         | _(a definir)_    | no      |
| Cambiar su propia contraseña            | sí         | sí               | sí      |

> La **diferencia funcional entre `superadmin` y `admin`** todavía no está definida.
> Toda la lógica vive en `src/lib/auth/permissions.ts` y en la función SQL
> `can_edit_project`. Cuando se defina, se toca solo ahí.

### Defensa en profundidad

La autorización se aplica en **tres capas**, ninguna sola alcanza:

1. **Proxy** (Next 16, ex-`middleware`) — refresh de sesión + protección coarse de rutas.
2. **Server Components** — todo layout/page protegido vuelve a verificar el
   `role` del usuario server-side y `redirect()` si no corresponde.
3. **RLS** — última línea. Las políticas se construyen sobre tres helpers
   `SECURITY DEFINER`: `is_superadmin`, `has_project_access`, `can_edit_project`.

## Plan de migración (8 fases)

Cada fase deja un build verde y un commit atómico.

1. **Scaffold** ← _esta fase_
2. Supabase: init + migraciones + tipos generados
3. Auth invite-only + middleware + `/set-password` + Server Action de invite
4. Layouts + nav + `/configuracion`
5. Persistencia: portar dashboard, reemplazar `localStorage` por Supabase
6. Calculadora (port directo del prototipo)
7. Integraciones (UI + `project_secrets`, stub sin OAuth real)
8. Resumen IA server-side + gestión de proyectos/usuarios

## Legacy

El prototipo Vite original quedó preservado en:

- `docs/legacy/App.jsx` y `docs/legacy/main.jsx`
- Rama `legacy/vite-prototype` (apunta al commit inicial)

No se migran automáticamente los datos viejos de `localStorage`.

## License

Private — Growins
