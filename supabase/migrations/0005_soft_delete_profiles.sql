-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Soft-delete column on profiles                                           │
-- │                                                                          │
-- │ When `deleted_at` is non-null the user is treated as deactivated:        │
-- │   - hidden from /admin/usuarios listing                                  │
-- │   - getSessionProfile returns null (UI sees them as logged out)         │
-- │   - sign-in is also blocked via `auth.admin.updateUserById({ ban_duration })` │
-- │     so existing sessions get invalidated                                 │
-- │                                                                          │
-- │ The row itself, the auth.users row, and all related data (project_members,│
-- │ project_members audit logs, etc.) are preserved on purpose.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.profiles
  add column if not exists deleted_at timestamptz;

-- Partial index speeds up the common "active users only" listing.
create index if not exists profiles_active_idx
  on public.profiles(role)
  where deleted_at is null;
