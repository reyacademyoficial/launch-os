-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Backfill: sales.team_member_id := leads.team_member_id                   │
-- │                                                                          │
-- │ El Leaderboard, los rankings de tier y el PDF de comisiones agrupaban    │
-- │ por `sales.team_member_id`, mientras que el Kanban agrupa por el dueño   │
-- │ del lead. En el proyecto Maratón del Carnicero (2026-06-23) 9 ventas    │
-- │ tenían `sales.team_member_id` desalineado con `leads.team_member_id`:   │
-- │ 8 quedaron en NULL (8 sales por $11.76M invisibles en el LB) y 1 venta  │
-- │ de un lead de un setter quedó atribuida a otro. Resultado: Jesús con    │
-- │ 0 cerrados y $0 cobrado en LB pese a 6 ventas reales en su nombre.     │
-- │                                                                          │
-- │ La decisión cerrada es que el DUEÑO DEL LEAD es la fuente única de      │
-- │ verdad de la atribución. La aplicación pasa a leer `leads.team_member_id`│
-- │ directo y a forzar la consistencia en `createSale` + `updateLead`.      │
-- │ Este backfill alinea los registros existentes para que cualquier        │
-- │ consumidor de `sales.team_member_id` (PDF, queries ad-hoc) vea la       │
-- │ misma verdad.                                                            │
-- │                                                                          │
-- │ Idempotente: el `is distinct from` deja en paz las filas ya alineadas;   │
-- │ correrla dos veces no hace nada en la segunda corrida.                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯
update public.sales s
set
  team_member_id = l.team_member_id,
  updated_at     = now()
from public.leads l
where s.lead_id = l.id
  and s.team_member_id is distinct from l.team_member_id;
