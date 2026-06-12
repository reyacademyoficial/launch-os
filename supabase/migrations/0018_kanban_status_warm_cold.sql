-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 3b — Nuevo modelo del kanban: frío | tibio | agendado | cerrado |  │
-- │           perdido                                                       │
-- │                                                                          │
-- │ Decisión del usuario: el estado del lead refleja su nivel de actividad. │
-- │   - frio: 1 mensaje inbound de WhatsApp o formulario sin actividad.     │
-- │   - tibio: 2+ mensajes inbound (lead respondió).                        │
-- │   - agendado: tiene appointment en GHL.                                │
-- │   - cerrado: tag "cliente" en GHL (o manual).                          │
-- │   - perdido: manual.                                                   │
-- │                                                                          │
-- │ Migración:                                                              │
-- │   nuevo       → frio                                                    │
-- │   contactado  → tibio                                                   │
-- │   calificado  → tibio                                                   │
-- │   agendado, cerrado, perdido → se mantienen                            │
-- │                                                                          │
-- │ ORDEN IMPORTANTE: el CHECK constraint viejo bloquea los UPDATEs si      │
-- │ intentamos poner valores nuevos ('frio', 'tibio') mientras él esté     │
-- │ activo. Por eso:                                                        │
-- │   1) DROP del constraint viejo.                                        │
-- │   2) UPDATEs de los datos.                                             │
-- │   3) ADD del constraint nuevo.                                         │
-- │   4) Cambiar default a 'frio'.                                         │
-- │                                                                          │
-- │ Idempotente: si la migración corrió parcialmente antes y dejó filas    │
-- │ ya con 'frio'/'tibio', no se rompen — los UPDATEs no las tocan.        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) DROP del constraint viejo PRIMERO
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads drop constraint if exists leads_status_check;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Migrar datos existentes (ahora sin constraint que bloquee)
-- ═══════════════════════════════════════════════════════════════════════════
update public.leads set status = 'frio'  where status = 'nuevo';
update public.leads set status = 'tibio' where status = 'contactado';
update public.leads set status = 'tibio' where status = 'calificado';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Agregar constraint nuevo con los 5 valores válidos
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads
  add constraint leads_status_check
  check (status in ('frio', 'tibio', 'agendado', 'cerrado', 'perdido'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Cambiar el default a 'frio'
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads alter column status set default 'frio';
