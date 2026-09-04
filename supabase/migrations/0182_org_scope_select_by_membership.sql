-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fix — SELECT de tablas org-scope pasa a can_view_organization()          │
-- │                                                                          │
-- │ MISMO BUG que 0171 (`organization.SELECT`), pero replicado en TODAS las  │
-- │ tablas que siguieron el "template 0090": la policy de SELECT usaba      │
-- │ `can_edit_organization(organization_id)`, que hoy es (0051)             │
-- │ `select public.is_kingrow_admin()` — es decir, sólo `superadmin`/`dev`.  │
-- │ El parámetro de organización se acepta pero se IGNORA (comentario       │
-- │ propio de 0051: "reservado para el refinamiento futuro").               │
-- │                                                                          │
-- │ Efecto real: cualquier usuario con role `admin`, `coordinador`,          │
-- │ `operador`, `closer` o `analista` recibía CERO filas de RLS en          │
-- │ `content_owners`, `content_pieces`, `recording_sessions`, `invoices`,   │
-- │ `clients`, `tickets`, `tasks`, etc. — no porque los datos no existan o   │
-- │ estén mal asociados, sino porque la policy de lectura nunca los         │
-- │ contempló. Detectado en sesión 2026-09-04: dueños de contenido creados   │
-- │ por un usuario superadmin no aparecían para el resto del equipo.        │
-- │                                                                          │
-- │ FIX (idéntico en espíritu a 0171/0173): reemplazar el `using` de cada    │
-- │ policy `*_select` por `can_view_organization(...)` — el helper que ya    │
-- │ existe desde 0166/0173 y reconoce membresía real:                        │
-- │   is_superadmin() OR project_members(user_id) OR                        │
-- │   organization_people(auth_user_id)                                     │
-- │                                                                          │
-- │ ALCANCE — SOLO LECTURA. Los INSERT/UPDATE/DELETE de estas mismas tablas  │
-- │ siguen gateados por `can_edit_organization()` (superadmin/dev-only) sin  │
-- │ ningún cambio — decisión explícita para no ampliar de golpe quién puede  │
-- │ escribir `invoices`/`payroll`/`banks`/`taxes`/etc. Si algún módulo       │
-- │ necesita que coordinador/operador puedan además crear/editar filas (ej.  │
-- │ Marketing, según su matriz de roles documentada), eso es un cambio de    │
-- │ escritura aparte, deliberado por tabla — no se toca acá.                 │
-- │                                                                          │
-- │ `ALTER POLICY ... USING (...)` reemplaza sólo la expresión, sin dropear  │
-- │ la policy — mismo nombre, mismos roles (`authenticated`), mismo comando  │
-- │ (SELECT). `finance_ai_conversations_select` conserva su condición extra  │
-- │ `user_id = auth.uid()`. Las tablas resueltas vía `org_of_*()` (uploads   │
-- │ bancarios, notion) envuelven esa misma función en vez del organization_id│
-- │ directo — comportamiento idéntico al de `can_edit_organization` previo.  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter policy accounts_select on public.accounts using (public.can_view_organization(organization_id));
alter policy assets_select on public.assets using (public.can_view_organization(organization_id));
alter policy bank_movements_select on public.bank_movements using (public.can_view_organization(organization_id));
alter policy banks_select on public.banks using (public.can_view_organization(organization_id));
alter policy blockers_select on public.blockers using (public.can_view_organization(organization_id));
alter policy budgets_select on public.budgets using (public.can_view_organization(organization_id));
alter policy checklist_items_select on public.checklist_items using (public.can_view_organization(organization_id));
alter policy checklists_select on public.checklists using (public.can_view_organization(organization_id));
alter policy client_transfers_select on public.client_transfers using (public.can_view_organization(organization_id));
alter policy clients_select on public.clients using (public.can_view_organization(organization_id));
alter policy content_assets_select on public.content_assets using (public.can_view_organization(organization_id));
alter policy content_edits_select on public.content_edits using (public.can_view_organization(organization_id));
alter policy content_owners_select on public.content_owners using (public.can_view_organization(organization_id));
alter policy content_pieces_select on public.content_pieces using (public.can_view_organization(organization_id));
alter policy content_raws_select on public.content_raws using (public.can_view_organization(organization_id));
alter policy content_uploads_select on public.content_uploads using (public.can_view_organization(organization_id));
alter policy cost_centers_select on public.cost_centers using (public.can_view_organization(organization_id));
alter policy ctbm_select on public.client_transfer_bank_movements using (public.can_view_organization(public.org_of_client_transfer(client_transfer_id)));
alter policy ebm_select on public.expense_bank_movements using (public.can_view_organization(public.org_of_expense(expense_id)));
alter policy editor_availability_select on public.editor_availability using (public.can_view_organization(organization_id));
alter policy expense_categories_select on public.expense_categories using (public.can_view_organization(organization_id));
alter policy expenses_select on public.expenses using (public.can_view_organization(organization_id));
alter policy finance_ai_conversations_select on public.finance_ai_conversations using (public.can_view_organization(organization_id) and user_id = auth.uid());
alter policy ibm_select on public.invoice_bank_movements using (public.can_view_organization(public.org_of_invoice(invoice_id)));
alter policy internal_project_notion_comments_select on public.internal_project_notion_comments using (public.can_view_organization(organization_id));
alter policy internal_project_owners_select on public.internal_project_owners using (public.can_view_organization(organization_id));
alter policy internal_projects_select on public.internal_projects using (public.can_view_organization(organization_id));
alter policy invoices_select on public.invoices using (public.can_view_organization(organization_id));
alter policy launch_settlements_select on public.launch_settlements using (public.can_view_organization(organization_id));
alter policy liabilities_select on public.liabilities using (public.can_view_organization(organization_id));
alter policy notion_databases_select on public.notion_databases using (public.can_view_organization(public.org_of_notion_workspace(workspace_id)));
alter policy notion_sync_log_select on public.notion_sync_log using (public.can_view_organization(public.org_of_notion_workspace(workspace_id)));
alter policy notion_users_select on public.notion_users using (public.can_view_organization(public.org_of_notion_workspace(workspace_id)));
alter policy notion_workspaces_select on public.notion_workspaces using (public.can_view_organization(organization_id));
alter policy nps_responses_select on public.nps_responses using (public.can_view_organization(organization_id));
alter policy organization_people_select on public.organization_people using (public.can_view_organization(organization_id));
alter policy payroll_select on public.payroll using (public.can_view_organization(organization_id));
alter policy pbm_select on public.payroll_bank_movements using (public.can_view_organization(public.org_of_payroll(payroll_id)));
alter policy processes_select on public.processes using (public.can_view_organization(organization_id));
alter policy project_health_select on public.project_health using (public.can_view_organization(organization_id));
alter policy publishing_cadences_select on public.publishing_cadences using (public.can_view_organization(organization_id));
alter policy recording_assignees_select on public.recording_assignees using (public.can_view_organization(organization_id));
alter policy recording_sessions_select on public.recording_sessions using (public.can_view_organization(organization_id));
alter policy renewals_select on public.renewals using (public.can_view_organization(organization_id));
alter policy settlement_rules_select on public.settlement_rules using (public.can_view_organization(organization_id));
alter policy suppliers_select on public.suppliers using (public.can_view_organization(organization_id));
alter policy task_assignees_select on public.task_assignees using (public.can_view_organization(organization_id));
alter policy task_completions_select on public.task_completions using (public.can_view_organization(organization_id));
alter policy tasks_select on public.tasks using (public.can_view_organization(organization_id));
alter policy taxes_select on public.taxes using (public.can_view_organization(organization_id));
alter policy team_membership_select on public.team_membership using (public.can_view_organization(organization_id));
alter policy teams_select on public.teams using (public.can_view_organization(organization_id));
alter policy tickets_select on public.tickets using (public.can_view_organization(organization_id));
alter policy time_entries_select on public.time_entries using (public.can_view_organization(organization_id));
alter policy upsells_select on public.upsells using (public.can_view_organization(organization_id));
