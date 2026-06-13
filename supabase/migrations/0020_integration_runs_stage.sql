-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ integration_runs.stage — particionar el sync de GHL en etapas            │
-- │                                                                          │
-- │ Decisión Fase 3b: un sync de GHL = una etapa. El usuario aprieta el      │
-- │ botón de "Appointments", después el de "Conversaciones", después el de   │
-- │ "Contactos". Cada corrida es chica y termina dentro del timeout del      │
-- │ Server Action. Antes una sola corrida tenía que traer todo y se cortaba │
-- │ a mitad por timeout.                                                    │
-- │                                                                          │
-- │ Stage queda NULL para Meta (su sync no se particiona — es un solo blob  │
-- │ por launch) y para los integration_runs viejos (pre-0020). El            │
-- │ orchestrator lo trata como "all stages" para no romper compat.          │
-- │                                                                          │
-- │ Index nuevo: (launch_id, provider, stage, started_at desc) — para que   │
-- │ la query "último success de appointments en este launch" sea barata.    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.integration_runs
  add column if not exists stage text;

-- Index para la query "última corrida de X stage de X provider en X launch".
-- DESC sobre started_at porque siempre queremos la más reciente.
create index if not exists integration_runs_launch_provider_stage_idx
  on public.integration_runs(launch_id, provider, stage, started_at desc);
