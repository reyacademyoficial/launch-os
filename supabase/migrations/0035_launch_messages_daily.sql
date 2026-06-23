-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase B — Conteo diario de mensajes entrantes WhatsApp/SMS por launch     │
-- │                                                                          │
-- │ Contexto: el sync GHL vigente filtra conversaciones por                  │
-- │ lastMessageType=TYPE_WHATSAPP, pero el WhatsApp-App-level del usuario    │
-- │ llega como messageType=TYPE_CUSTOM_SMS (verificado 2026-06-23 con data   │
-- │ real del location WDYpjQTiKpK6eUD1aFYZ). Ese filtro dropea todo.         │
-- │                                                                          │
-- │ Solución: sync NUEVO y SEPARADO ("Sync mensajes") que:                   │
-- │  - Trae conversaciones sin filtro de type (cap 500).                     │
-- │  - Pagina /conversations/{id}/messages por cada una.                     │
-- │  - Cuenta inbound por día con un matcher familia (messageType contiene   │
-- │    "SMS" o "WHATSAPP" — captura TYPE_SMS, TYPE_CUSTOM_SMS, TYPE_WHATSAPP │
-- │    y variantes futuras sin redeploy).                                    │
-- │                                                                          │
-- │ Este sync NO corre dentro del sync GHL interactivo — la serie es para    │
-- │ análisis retrospectivo (chart Meta vs comunidad), no necesita frescura   │
-- │ al minuto. Botón aparte + cron en 3c.                                    │
-- │                                                                          │
-- │ Idempotencia: upsert por (launch_id, date). Re-correr sobre la misma     │
-- │ ventana deja el mismo estado — no duplica.                               │
-- │                                                                          │
-- │ RLS espejo de launch_daily_ads/launch_community_metrics: SELECT para     │
-- │ miembros del proyecto, sin policies I/U/D (service-role escribe).        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.launch_messages_daily (
  id            uuid primary key default gen_random_uuid(),
  launch_id     uuid not null references public.launches(id) on delete cascade,

  date          date not null,

  -- Conteo de mensajes inbound (direction='inbound') que pasan el matcher
  -- familia "SMS-or-WhatsApp" para ese día. No incluye Instagram, Email, ni
  -- markers de sistema (TYPE_ACTIVITY_*).
  inbound_count integer not null default 0 check (inbound_count >= 0),

  -- Auditoría: { "TYPE_CUSTOM_SMS": 87, "TYPE_INSTAGRAM": 12, ... } — TODOS
  -- los messageType vistos ese día (incluye los descartados por el matcher).
  -- Sirve para que el operador pueda inspeccionar qué quedó afuera y decidir
  -- si extender la lista (ej. sumar Instagram a la serie).
  observed_message_types jsonb not null default '{}'::jsonb,

  synced_at     timestamptz not null default now(),

  unique (launch_id, date)
);

create index if not exists launch_messages_daily_launch_date_idx
  on public.launch_messages_daily(launch_id, date);

alter table public.launch_messages_daily enable row level security;
grant select, insert, update, delete on public.launch_messages_daily to authenticated;

drop policy if exists launch_messages_daily_select on public.launch_messages_daily;
create policy launch_messages_daily_select on public.launch_messages_daily
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));
-- (no I/U/D policies — solo service-role escribe)

-- Realtime — el chart debería refresh cuando el sync escribe filas nuevas.
-- Mismo patrón que launch_daily_ads / launch_community_metrics.
do $$
begin
  alter publication supabase_realtime add table public.launch_messages_daily;
exception when duplicate_object then
  null;
end$$;
