-- ads_currency: moneda en que las plataformas publicitarias (Meta, Google,
-- TikTok) reportan los gastos de este launch. La mayoría de las cuentas
-- reportan en USD; las cuentas argentinas reportan en ARS.
-- Cuando es 'ARS' y el launch tiene ars_per_usd seteado, los valores de
-- meta_investment / google_investment / tiktok_investment se dividen por
-- ars_per_usd para mostrar en USD en los dashboards.
ALTER TABLE launches
  ADD COLUMN ads_currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (ads_currency IN ('ARS', 'USD'));
