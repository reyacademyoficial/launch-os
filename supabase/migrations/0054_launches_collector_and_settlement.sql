-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 1 (Kingrow) — Columnas de liquidación en launches (aditivas)     │
-- │                                                                          │
-- │ collector             — quién cobra la plata de este launch:            │
-- │                          'kingrow'  → pasa por bancos de Kingrow        │
-- │                                       (se le presta la pasarela al       │
-- │                                       cliente externo → genera cuenta   │
-- │                                       corriente si es externa).         │
-- │                          'cliente'  → el cliente externo cobra por      │
-- │                                       cuenta propia. Kingrow igual      │
-- │                                       liquida su comisión sobre lo     │
-- │                                       declarado como cobrado, pero no  │
-- │                                       toca la pasarela.                 │
-- │                          Default 'kingrow' (caso mayoritario).          │
-- │                                                                          │
-- │ settlement_rule_id    — pin explícito a una regla de settlement.        │
-- │                          NULL → usar default del proyecto (la fila de  │
-- │                          settlement_rules con project=X, launch=NULL,  │
-- │                          active=true).                                  │
-- │                          Setteado → usar esa regla puntual.             │
-- │                                                                          │
-- │ NO toca ninguna otra columna de launches.                                │
-- │ RLS de launches queda intacta (project-scope).                          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.launches
  add column if not exists collector text
    check (collector in ('kingrow', 'cliente')),
  add column if not exists settlement_rule_id uuid
    references public.settlement_rules(id) on delete set null;

-- Backfill: launches existentes asumen collector='kingrow' (caso típico).
-- Cero riesgo — se está estableciendo un default, no cambiando semántica.
update public.launches
   set collector = 'kingrow'
 where collector is null;

alter table public.launches
  alter column collector set default 'kingrow',
  alter column collector set not null;

create index if not exists launches_settlement_rule_idx
  on public.launches(settlement_rule_id)
  where settlement_rule_id is not null;
