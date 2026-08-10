-- Conteo de leads por vendedor desde la pipeline de GHL.
-- Se re-escribe completa en cada sync (delete + insert desde el orchestrator).
-- Permite saber cuántos leads tiene asignados cada vendedor en la pipeline,
-- sin bajar datos individuales de los leads.

create table if not exists ghl_pipeline_lead_counts (
  id             uuid        primary key default gen_random_uuid(),
  launch_id      uuid        not null references launches(id) on delete cascade,
  ghl_user_id    text        not null,
  team_member_id uuid        references team_members(id) on delete set null,
  lead_count     integer     not null default 0,
  synced_at      timestamptz not null default now(),
  unique(launch_id, ghl_user_id)
);

alter table ghl_pipeline_lead_counts enable row level security;

create policy "select via project access"
  on ghl_pipeline_lead_counts
  for select using (
    exists (
      select 1 from launches l
      where l.id = ghl_pipeline_lead_counts.launch_id
        and has_project_access(l.project_id)
    )
  );
