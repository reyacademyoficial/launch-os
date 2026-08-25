-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fix — READ policies de org-scope no distinguían READ de WRITE            │
-- │                                                                          │
-- │ Toda tabla org-scope (Bloques 1/2/3/5 + marketing + notion) gateaba su   │
-- │ SELECT en `can_edit_organization()`, que en 0051 es exactamente          │
-- │ `is_superadmin()` (`role='superadmin'` OR `is_dev_privileged`). Efecto: │
-- │ admin, coordinador y operador NO leían ninguna fila de esas tablas —    │
-- │ solo la UI los tapaba. En cuanto una query intentaba hidratar owner /   │
-- │ assignee / proyecto asignado, se caía en vacío por RLS.                 │
-- │                                                                          │
-- │ FIX ACOTADO (opción 1 del análisis):                                    │
-- │   Introducir `can_view_organization()` — permiso amplio de LECTURA para │
-- │   internal team. Aplicarlo solo a Ops (Bloque 5) + Notion. Deja fuera   │
-- │   Financiero, Comercial, Clientes, Academia, Marketing — cuando el rol  │
-- │   los necesite (coordinador toca Clientes/Academia/Marketing, admin     │
-- │   toca Financiero/Comercial) se extiende con migración separada.        │
-- │                                                                          │
-- │ WRITE sin cambios: insert/update/delete siguen gateados por             │
-- │ `can_edit_organization()` — solo super/dev pueden crear/editar/borrar   │
-- │ personas, proyectos, tareas, workspaces, etc. Ese modelo es correcto:   │
-- │ hoy la escritura es privilegio de sysadmin; en un futuro se refina el   │
-- │ helper de write con roles granulares.                                    │
-- │                                                                          │
-- │ SEGURIDAD                                                                │
-- │   `cliente_role` (0023) es un rol PostgREST distinto de `authenticated`,│
-- │   y todas estas tablas hacen `revoke all ... from cliente_role` +      │
-- │   `grant ... to authenticated` en su bootstrap. Cliente nunca llega a  │
-- │   las policies — el pre-RLS le tira 42501. Abrir SELECT a authenticated│
-- │   NO afecta cliente.                                                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Helper de lectura org-scope. Hoy devuelve true para todo authenticated.
--    Si aparece necesidad de multi-tenancy fina (varias orgs) o de restringir
--    lectura por sub-rol, se refina el cuerpo acá y todas las policies heredan.
--    Firma parametrizada para que el día del refinamiento no cambie el callsite.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_view_organization(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- p_organization_id: reservado para refinamiento futuro. Hoy la respuesta
  -- es global — cualquier authenticated (no cliente, que sale por grant) lee.
  select true;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Bloque 5 (Operaciones) — 12 tablas
--
-- organization_people (0058) — canónica de personas, needed por ops + notion
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists organization_people_select on public.organization_people;
create policy organization_people_select on public.organization_people
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- internal_projects (0090)
drop policy if exists internal_projects_select on public.internal_projects;
create policy internal_projects_select on public.internal_projects
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- teams + team_membership (0091)
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select to authenticated
  using (public.can_view_organization(organization_id));

drop policy if exists team_membership_select on public.team_membership;
create policy team_membership_select on public.team_membership
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- tasks (0092)
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- checklists + checklist_items (0093)
drop policy if exists checklists_select on public.checklists;
create policy checklists_select on public.checklists
  for select to authenticated
  using (public.can_view_organization(organization_id));

drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- processes (0094)
drop policy if exists processes_select on public.processes;
create policy processes_select on public.processes
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- blockers (0095)
drop policy if exists blockers_select on public.blockers;
create policy blockers_select on public.blockers
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- time_entries (0096)
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- task_completions (0139)
drop policy if exists task_completions_select on public.task_completions;
create policy task_completions_select on public.task_completions
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- internal_project_owners (0140)
drop policy if exists internal_project_owners_select on public.internal_project_owners;
create policy internal_project_owners_select on public.internal_project_owners
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- task_assignees (0141)
drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees
  for select to authenticated
  using (public.can_view_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Integración Notion (0132, 0133) — el coordinador necesita ver el mapping
--    para entender qué proyectos vienen de qué DB. notion_databases /
--    notion_users / notion_sync_log resuelven la org vía wrapper
--    org_of_notion_workspace — mantenemos ese wrapper pero cambiamos el
--    helper de can_edit_ a can_view_.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists notion_workspaces_select on public.notion_workspaces;
create policy notion_workspaces_select on public.notion_workspaces
  for select to authenticated
  using (public.can_view_organization(organization_id));

drop policy if exists notion_databases_select on public.notion_databases;
create policy notion_databases_select on public.notion_databases
  for select to authenticated
  using (public.can_view_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_users_select on public.notion_users;
create policy notion_users_select on public.notion_users
  for select to authenticated
  using (public.can_view_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_sync_log_select on public.notion_sync_log;
create policy notion_sync_log_select on public.notion_sync_log
  for select to authenticated
  using (public.can_view_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists internal_project_notion_comments_select
  on public.internal_project_notion_comments;
create policy internal_project_notion_comments_select
  on public.internal_project_notion_comments
  for select to authenticated
  using (public.can_view_organization(organization_id));
