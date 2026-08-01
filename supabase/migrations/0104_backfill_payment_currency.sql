-- Backfill: todos los cobros cargados hasta ahora estaban en pesos.
-- La columna original_currency representa la moneda en que el operador
-- ingresó el monto — no la moneda del banco del método de pago.
-- Efectos: cobros con método USD (Stripe, etc.) cuyo monto era ARS
-- ahora se dividirán correctamente por launches.ars_per_usd al mostrar.
UPDATE payments
SET original_currency = 'ARS'
WHERE original_currency IS NULL;
