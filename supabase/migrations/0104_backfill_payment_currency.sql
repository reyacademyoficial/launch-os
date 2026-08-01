-- Backfill original_currency detectando la moneda real del método/banco.
-- Prioridad: banco del método → moneda del método → ARS por defecto.
--
-- NOTA: si esta migración ya corrió en su versión anterior (que seteaba todo
-- como ARS), correr también el UPDATE de corrección que usa = 'ARS' en lugar
-- de IS NULL (ver comentario al final).

-- 1. Cobros con método que apunta a un banco en USD
UPDATE payments p
SET original_currency = 'USD'
FROM payment_methods pm
JOIN banks b ON b.id = pm.bank_id
WHERE p.payment_method_id = pm.id
  AND b.currency = 'USD'
  AND p.original_currency IS NULL;

-- 2. Cobros con método sin banco pero con currency = 'USD' explícito
UPDATE payments p
SET original_currency = 'USD'
FROM payment_methods pm
WHERE p.payment_method_id = pm.id
  AND pm.bank_id IS NULL
  AND pm.currency = 'USD'
  AND p.original_currency IS NULL;

-- 3. Todo lo restante (bancos ARS, métodos ARS, sin método) → ARS
UPDATE payments
SET original_currency = 'ARS'
WHERE original_currency IS NULL;

-- CORRECCIÓN (si el backfill viejo ya corrió y seteó todo como 'ARS'):
-- UPDATE payments p
-- SET original_currency = 'USD'
-- FROM payment_methods pm
-- JOIN banks b ON b.id = pm.bank_id
-- WHERE p.payment_method_id = pm.id
--   AND b.currency = 'USD'
--   AND p.original_currency = 'ARS';
