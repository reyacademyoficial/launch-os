-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0156 — external_apps: drop auth_strategy + config                        │
-- │                                                                          │
-- │ Reversa parcial de 0153. La app externa deja de tener SSO — el botón     │
-- │ del curso simplemente redirige al base_url en nueva pestaña. Las         │
-- │ columnas auth_strategy y config quedan obsoletas.                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.external_apps
  drop column if exists auth_strategy,
  drop column if exists config;

comment on table public.external_apps is
  'Apps externas asociadas a un proyecto propio (ej: Nitro tiene una app de agenda de turnos con expertos). El link app↔curso vive en courses.external_app_id. El botón del curso solo redirige al base_url.';
comment on column public.external_apps.base_url is
  'URL de la app externa. El botón "Abrir {app}" del detalle del curso abre este URL en nueva pestaña.';
