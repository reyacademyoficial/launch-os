-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fix — WRITE de Operaciones y Marketing pasa a can_edit_ops_marketing()   │
-- │                                                                          │
-- │ 0182 dejó esto pendiente a propósito: "Si algún módulo necesita que      │
-- │ coordinador/operador puedan además crear/editar filas (ej. Marketing,   │
-- │ según su matriz de roles documentada), eso es un cambio de escritura     │
-- │ aparte, deliberado por tabla — no se toca acá."                         │
-- │                                                                          │
-- │ SÍNTOMA REPORTADO                                                        │
-- │   - coordinador: "Asignados nuevos fallaron: new row violates row-level │
-- │     security policy for table task_assignees" al cambiar el status de   │
-- │     una tarea (operaciones/tareas/actions.ts → updateTask reemplaza el   │
-- │     set de assignees en cada edit vía delete+insert).                   │
-- │   - admin: mismo error en content_raws al cargar un crudo en Marketing. │
-- │                                                                          │
-- │ CAUSA                                                                    │
-- │   Las tablas de Operaciones y Marketing (template 0090) gatean su        │
-- │   INSERT/UPDATE/DELETE con can_edit_organization() (0051), que hoy       │
-- │   resuelve a is_superadmin() = rol 'superadmin' + 'dev' EXCLUSIVAMENTE.  │
-- │   Pero los layouts de esos módulos (operaciones/layout.tsx,              │
-- │   marketing/layout.tsx) ya admiten                                       │
-- │   superadmin/admin/coordinador/operador — el gate de escritura en DB     │
-- │   nunca siguió a la UI, así que esos 3 roles leían todo pero no podían   │
-- │   escribir nada, con un error de RLS crudo en vez de un 403 prolijo.    │
-- │                                                                          │
-- │ FIX                                                                      │
-- │   Nuevo helper can_edit_ops_marketing(p_organization_id) — mismo         │
-- │   criterio de rol (admin/coordinador/operador) que ya usan los layouts,  │
-- │   PERO atado a membresía real vía can_view_organization() (0173) en vez  │
-- │   de ignorar el parámetro como hace can_edit_organization. Así, el día   │
-- │   que exista una segunda org (ver Pentest Org B en scripts/pentest/) un  │
-- │   admin/coordinador/operador de la Org A no puede escribir filas de      │
-- │   Operaciones/Marketing en la Org B. superadmin/dev siguen pasando       │
-- │   siempre vía is_superadmin(), igual que antes.                          │
-- │                                                                          │
-- │ ALCANCE — solo las 20 tablas propias de Operaciones y Marketing (las     │
-- │ únicas que esos 2 layouts efectivamente escriben, verificado contra el  │
-- │ código de src/app/(app)/(kg)/{operaciones,marketing}). Financiero /      │
-- │ Comercial / Organización (personas, banks, invoices, payroll, taxes,     │
-- │ reglas de split, etc.) NO se tocan: sus server actions ya tienen su      │
-- │ propio requireRole("superadmin") a propósito y ese gate no se afloja acá │
-- │ (mismo criterio documentado en financiero/layout.tsx y comercial/layout).│
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) can_edit_ops_marketing(p_organization_id uuid)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_edit_ops_marketing(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.is_superadmin()
    or (
      exists (
        select 1
          from public.profiles
         where id = auth.uid()
           and role in ('admin', 'coordinador', 'operador')
      )
      and public.can_view_organization(p_organization_id)
    );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Operaciones — 10 tablas
-- ═══════════════════════════════════════════════════════════════════════════

alter policy blockers_insert on public.blockers
  with check (public.can_edit_ops_marketing(organization_id));
alter policy blockers_update on public.blockers
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy blockers_delete on public.blockers
  using (public.can_edit_ops_marketing(organization_id));

alter policy checklists_insert on public.checklists
  with check (public.can_edit_ops_marketing(organization_id));
alter policy checklists_update on public.checklists
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy checklists_delete on public.checklists
  using (public.can_edit_ops_marketing(organization_id));

alter policy checklist_items_insert on public.checklist_items
  with check (public.can_edit_ops_marketing(organization_id));
alter policy checklist_items_update on public.checklist_items
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy checklist_items_delete on public.checklist_items
  using (public.can_edit_ops_marketing(organization_id));

alter policy internal_project_owners_insert on public.internal_project_owners
  with check (public.can_edit_ops_marketing(organization_id));
alter policy internal_project_owners_update on public.internal_project_owners
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy internal_project_owners_delete on public.internal_project_owners
  using (public.can_edit_ops_marketing(organization_id));

alter policy internal_projects_insert on public.internal_projects
  with check (public.can_edit_ops_marketing(organization_id));
alter policy internal_projects_update on public.internal_projects
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy internal_projects_delete on public.internal_projects
  using (public.can_edit_ops_marketing(organization_id));

alter policy processes_insert on public.processes
  with check (public.can_edit_ops_marketing(organization_id));
alter policy processes_update on public.processes
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy processes_delete on public.processes
  using (public.can_edit_ops_marketing(organization_id));

alter policy task_assignees_insert on public.task_assignees
  with check (public.can_edit_ops_marketing(organization_id));
alter policy task_assignees_update on public.task_assignees
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy task_assignees_delete on public.task_assignees
  using (public.can_edit_ops_marketing(organization_id));

alter policy task_completions_insert on public.task_completions
  with check (public.can_edit_ops_marketing(organization_id));
alter policy task_completions_update on public.task_completions
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy task_completions_delete on public.task_completions
  using (public.can_edit_ops_marketing(organization_id));

alter policy tasks_insert on public.tasks
  with check (public.can_edit_ops_marketing(organization_id));
alter policy tasks_update on public.tasks
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy tasks_delete on public.tasks
  using (public.can_edit_ops_marketing(organization_id));

alter policy time_entries_insert on public.time_entries
  with check (public.can_edit_ops_marketing(organization_id));
alter policy time_entries_update on public.time_entries
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy time_entries_delete on public.time_entries
  using (public.can_edit_ops_marketing(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Marketing — 10 tablas
-- ═══════════════════════════════════════════════════════════════════════════

alter policy content_assets_insert on public.content_assets
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_assets_update on public.content_assets
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_assets_delete on public.content_assets
  using (public.can_edit_ops_marketing(organization_id));

alter policy content_edits_insert on public.content_edits
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_edits_update on public.content_edits
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_edits_delete on public.content_edits
  using (public.can_edit_ops_marketing(organization_id));

alter policy content_owners_insert on public.content_owners
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_owners_update on public.content_owners
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_owners_delete on public.content_owners
  using (public.can_edit_ops_marketing(organization_id));

alter policy content_pieces_insert on public.content_pieces
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_pieces_update on public.content_pieces
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_pieces_delete on public.content_pieces
  using (public.can_edit_ops_marketing(organization_id));

alter policy content_raws_insert on public.content_raws
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_raws_update on public.content_raws
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_raws_delete on public.content_raws
  using (public.can_edit_ops_marketing(organization_id));

alter policy content_uploads_insert on public.content_uploads
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_uploads_update on public.content_uploads
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy content_uploads_delete on public.content_uploads
  using (public.can_edit_ops_marketing(organization_id));

alter policy editor_availability_insert on public.editor_availability
  with check (public.can_edit_ops_marketing(organization_id));
alter policy editor_availability_update on public.editor_availability
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy editor_availability_delete on public.editor_availability
  using (public.can_edit_ops_marketing(organization_id));

alter policy publishing_cadences_insert on public.publishing_cadences
  with check (public.can_edit_ops_marketing(organization_id));
alter policy publishing_cadences_update on public.publishing_cadences
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy publishing_cadences_delete on public.publishing_cadences
  using (public.can_edit_ops_marketing(organization_id));

alter policy recording_assignees_insert on public.recording_assignees
  with check (public.can_edit_ops_marketing(organization_id));
alter policy recording_assignees_update on public.recording_assignees
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy recording_assignees_delete on public.recording_assignees
  using (public.can_edit_ops_marketing(organization_id));

alter policy recording_sessions_insert on public.recording_sessions
  with check (public.can_edit_ops_marketing(organization_id));
alter policy recording_sessions_update on public.recording_sessions
  using      (public.can_edit_ops_marketing(organization_id))
  with check (public.can_edit_ops_marketing(organization_id));
alter policy recording_sessions_delete on public.recording_sessions
  using (public.can_edit_ops_marketing(organization_id));
