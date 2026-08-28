-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fix — organization.SELECT bloqueaba a admin/coordinador/operador         │
-- │                                                                          │
-- │ 0052 dejó `organization_select` gateado en `is_kingrow_admin()` — solo   │
-- │ superadmin/dev leen la fila. En ese momento tenía sentido: nada del      │
-- │ resto del app tocaba la tabla directamente.                              │
-- │                                                                          │
-- │ Con `resolveCurrentOrganizationId()` (src/lib/organization/current.ts)   │
-- │ el resolver del orgId hace `select id from organization limit 2` con     │
-- │ RLS del usuario. Cualquier rol que NO sea superadmin/dev devuelve 0     │
-- │ filas → `orgIdOrThrow()` tira "No hay organización visible para este    │
-- │ usuario." Sintomático desde d6cbccf, cuando Lanzamientos y todas las    │
-- │ pantallas kg pasaron a consumir `getKgProjects` / `getOrgPeople` /      │
-- │ `getAllBanks` (todos delegan al resolver).                              │
-- │                                                                          │
-- │ FIX                                                                      │
-- │   Reemplazar la policy de SELECT por `can_view_organization(id)` — el   │
-- │ helper que 0166 introdujo justo para este caso (lectura org-scope       │
-- │ para todo internal team). Insert/Update/Delete se mantienen con        │
-- │ `is_kingrow_admin()` — crear/renombrar/borrar orgs sigue siendo         │
-- │ privilegio de sysadmin.                                                 │
-- │                                                                          │
-- │ FRONTERA CLIENTE                                                         │
-- │   Intacta. 0052 hizo `revoke all on public.organization from             │
-- │ cliente_role` + `grant ... to authenticated`. cliente_role rebota       │
-- │ pre-RLS por falta de grant — la RLS ni siquiera se evalúa para él. La  │
-- │ policy solo se dispara para `authenticated`, que es lo que queremos.   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

drop policy if exists organization_select on public.organization;
create policy organization_select on public.organization
  for select to authenticated
  using (public.can_view_organization(id));
