-- Extiende el check de `launch_daily_ads.provider` para aceptar 'ghl'.
--
-- El sync GHL post-refactor (2026-08-10) escribe leads captados por día en
-- esta tabla con provider='ghl' para reutilizar la infraestructura de
-- realtime + agregación por launch. `mergeDailyData` (JS) ignora providers
-- que no sean meta/google/tiktok, así que estos rows NO se suman a los
-- leads pagos — la UI los renderea aparte (KPI card "Leads GHL" + curva
-- propia en la gráfica).
--
-- Sin este cambio el upsert del sync falla con 23514.

alter table public.launch_daily_ads
  drop constraint if exists launch_daily_ads_provider_check;

alter table public.launch_daily_ads
  add constraint launch_daily_ads_provider_check
  check (provider in ('meta', 'google', 'tiktok', 'ghl'));
