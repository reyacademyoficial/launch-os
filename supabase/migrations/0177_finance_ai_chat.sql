-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Financiero · Chat IA con memoria de conversación                        │
-- │                                                                          │
-- │ El módulo Lanzamientos ya tiene análisis IA (`ai_runs`, 0015), pero ese  │
-- │ modelo es one-shot: una fila por corrida, sin hilo. Para el analista     │
-- │ financiero necesitamos CONVERSACIÓN — la IA tiene que recordar lo que    │
-- │ se dijo antes ("¿y si saco Software?" solo se entiende con el turno      │
-- │ anterior en contexto).                                                   │
-- │                                                                          │
-- │ Modelo: dos tablas.                                                      │
-- │   · finance_ai_conversations → el hilo (título + dueño + org).          │
-- │   · finance_ai_messages      → cada turno (user | assistant), en orden.  │
-- │                                                                          │
-- │ Un mensaje `assistant` con `status='error'` guarda el fallo del proveedor│
-- │ para que quede traza en el hilo. El builder de historial los DESCARTA    │
-- │ antes de mandar el contexto al modelo (no son turnos reales).            │
-- │                                                                          │
-- │ Permisos: la conversación es PERSONAL. La frontera es                    │
-- │ `can_edit_organization(organization_id) AND user_id = auth.uid()` — un   │
-- │ admin no lee el hilo de otro admin. El módulo Financiero ya está         │
-- │ restringido a superadmin/admin en el layout; esto agrega el scope por    │
-- │ dueño encima.                                                            │
-- │                                                                          │
-- │ UPDATE sobre conversations existe (renombrar / touch de updated_at);     │
-- │ sobre messages está BLINDADO — un turno no se edita, el hilo es log.     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- Conversaciones
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.finance_ai_conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organization(id) on delete restrict,
  user_id          uuid not null references auth.users(id) on delete cascade,

  -- Se autogenera del primer mensaje del usuario (truncado). Renombrable.
  title            text not null default 'Nueva conversación',

  created_at       timestamptz not null default now(),
  -- Se toca en cada mensaje nuevo → ordena la lista por actividad real,
  -- no por fecha de creación.
  updated_at       timestamptz not null default now()
);

create index if not exists finance_ai_conversations_owner_idx
  on public.finance_ai_conversations(organization_id, user_id, updated_at desc);

drop trigger if exists set_updated_at on public.finance_ai_conversations;
create trigger set_updated_at before update on public.finance_ai_conversations
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Mensajes
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.finance_ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null
                     references public.finance_ai_conversations(id) on delete cascade,

  role             text not null check (role in ('user', 'assistant')),
  content          text not null,

  -- Solo en `assistant`: qué modelo respondió y si la llamada falló.
  model            text,
  status           text not null default 'ok' check (status in ('ok', 'error')),
  error_detail     jsonb,

  created_at       timestamptz not null default now()
);

-- El hilo se lee siempre completo y en orden ascendente.
create index if not exists finance_ai_messages_thread_idx
  on public.finance_ai_messages(conversation_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — frontera org + dueño
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.finance_ai_conversations enable row level security;
alter table public.finance_ai_messages      enable row level security;

revoke all on public.finance_ai_conversations from public;
revoke all on public.finance_ai_conversations from cliente_role;
revoke all on public.finance_ai_messages      from public;
revoke all on public.finance_ai_messages      from cliente_role;

grant select, insert, update, delete on public.finance_ai_conversations to authenticated;
grant select, insert, delete         on public.finance_ai_messages      to authenticated;
-- Log inmutable: Supabase concede `all` por default privileges en `public`,
-- así que el UPDATE hay que revocarlo explícito (mismo caso que 0015).
revoke update on public.finance_ai_messages from authenticated;

-- ─── conversations ────────────────────────────────────────────────────────
drop policy if exists finance_ai_conversations_select on public.finance_ai_conversations;
create policy finance_ai_conversations_select on public.finance_ai_conversations
  for select to authenticated
  using (public.can_edit_organization(organization_id) and user_id = auth.uid());

drop policy if exists finance_ai_conversations_insert on public.finance_ai_conversations;
create policy finance_ai_conversations_insert on public.finance_ai_conversations
  for insert to authenticated
  with check (public.can_edit_organization(organization_id) and user_id = auth.uid());

drop policy if exists finance_ai_conversations_update on public.finance_ai_conversations;
create policy finance_ai_conversations_update on public.finance_ai_conversations
  for update to authenticated
  using      (public.can_edit_organization(organization_id) and user_id = auth.uid())
  with check (public.can_edit_organization(organization_id) and user_id = auth.uid());

drop policy if exists finance_ai_conversations_delete on public.finance_ai_conversations;
create policy finance_ai_conversations_delete on public.finance_ai_conversations
  for delete to authenticated
  using (public.can_edit_organization(organization_id) and user_id = auth.uid());

-- ─── messages: heredan la frontera del hilo padre ─────────────────────────
drop policy if exists finance_ai_messages_select on public.finance_ai_messages;
create policy finance_ai_messages_select on public.finance_ai_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.finance_ai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
        and public.can_edit_organization(c.organization_id)
    )
  );

drop policy if exists finance_ai_messages_insert on public.finance_ai_messages;
create policy finance_ai_messages_insert on public.finance_ai_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.finance_ai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
        and public.can_edit_organization(c.organization_id)
    )
  );

drop policy if exists finance_ai_messages_delete on public.finance_ai_messages;
create policy finance_ai_messages_delete on public.finance_ai_messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.finance_ai_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
        and public.can_edit_organization(c.organization_id)
    )
  );
