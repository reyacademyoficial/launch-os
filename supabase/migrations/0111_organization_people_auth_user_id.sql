-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5.5 (Kingrow · Operaciones) — organization_people.auth_user_id    │
-- │                                                                          │
-- │ Habilita "cada usuario ve sus tareas" en /operaciones/tareas (filtro    │
-- │ "mis tareas" server-scoped por auth.uid() → person_id → assignee_id).   │
-- │ En el futuro también habilita el widget "Mi Jornada" del sidebar        │
-- │ (Anexo A del plan).                                                      │
-- │                                                                          │
-- │ DECISIÓN: unique GLOBAL (una persona = un auth_user). Multi-org es      │
-- │ lejano y cuando llegue se refactoriza (probablemente moviendo el link a │
-- │ una tabla puente organization_people_users).                            │
-- │                                                                          │
-- │ Aditiva: la columna es nullable. Personas sin usuario Kingrow           │
-- │ (freelance, contactos externos, quien no opera la plataforma) quedan    │
-- │ con auth_user_id NULL — es válido y esperado.                           │
-- │                                                                          │
-- │ on delete set null: si borran el user en auth.users, la persona sigue  │
-- │ existiendo con el link limpio. No destruye historial contable          │
-- │ (payroll, time_entries).                                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.organization_people
  add column if not exists auth_user_id uuid
    unique references auth.users(id) on delete set null;

create index if not exists organization_people_auth_user_idx
  on public.organization_people(auth_user_id)
  where auth_user_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill idempotente por email match.
--
-- Un UPDATE naive puede rebotar si dos personas comparten el mismo email —
-- el batch entero se roll-backea. Usamos una CTE con DISTINCT ON para
-- garantizar que a lo sumo UNA persona quede linkeada a cada auth.user.
--
-- Si hay múltiples personas con mismo email, gana la de UUID lex-menor
-- (tiebreak determinista via ORDER BY). Las otras quedan NULL y el
-- operador las resuelve manualmente desde /organizacion/personas.
--
-- Correr esta migración N veces es inocuo — se skipean las ya linkeadas.
-- ═══════════════════════════════════════════════════════════════════════════
with matches as (
  select distinct on (u.id)
         op.id as person_id,
         u.id  as user_id
    from public.organization_people op
    join auth.users u on lower(u.email) = lower(op.email)
   where op.auth_user_id is null
     and op.email is not null
     and u.email is not null
     and not exists (
       select 1
         from public.organization_people other
        where other.auth_user_id = u.id
     )
   order by u.id, op.id
)
update public.organization_people op
   set auth_user_id = m.user_id
  from matches m
 where op.id = m.person_id;
