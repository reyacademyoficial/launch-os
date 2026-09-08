-- Amplía el CHECK constraint de content_pieces.category para agregar
-- 'anuncios' (categoría nueva del pipeline de Producción). 'nugget' se
-- mantiene igual en DB — el label plural "Nuggets" es solo de presentación
-- (types.ts), no requiere cambios de constraint.
alter table content_pieces
  drop constraint if exists content_pieces_category_check;

alter table content_pieces
  add constraint content_pieces_category_check
  check (category in ('viral', 'nugget', 'anuncios', 'otro'));
