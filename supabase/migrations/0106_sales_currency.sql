-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ sales.currency — moneda OPERATIVA de la venta                            │
-- │                                                                          │
-- │ Contexto: la migración 0103 agregó `sales.original_currency` como        │
-- │ AUDITORÍA del backfill (qué moneda tenía el numérico antes de convertir).│
-- │ Eso no alcanza para operar: hoy `saleCurrency()` en TS deriva la moneda  │
-- │ de la venta a partir de si el launch tiene `ars_per_usd` cargado —       │
-- │ heurística incorrecta cuando una venta se pactó en USD dentro de un      │
-- │ launch operado en ARS (o viceversa).                                     │
-- │                                                                          │
-- │ Bug reportado: ventas cargadas en pesos + cobros efectuados en dólares   │
-- │ mostraban "pactado 555.800 vs cobrado 397" como si el saldo faltante     │
-- │ fuera enorme, cuando en realidad la venta se saldó completa en su        │
-- │ moneda nativa. El motor comparaba números de monedas distintas.          │
-- │                                                                          │
-- │ FIX: columna `currency` NOT NULL en `sales`. La cuota (installments) NO  │
-- │ recibe columna propia — todas las cuotas de una venta comparten moneda   │
-- │ (mezclar cuotas ARS+USD dentro de una misma venta es edge case raro y    │
-- │ operativamente confuso; el operador crearía dos ventas separadas).       │
-- │                                                                          │
-- │ La moneda del cobro (payments.original_currency, ya presente) debe       │
-- │ coincidir con `sales.currency`; el TS marca mismatch en UI.              │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.sales
  add column if not exists currency text not null default 'ARS'
    check (currency in ('ARS', 'USD'));

-- Backfill defensivo — sales viejas se asumen ARS (única moneda operativa
-- hasta hoy). Si `original_currency` (auditoría de 0103) dice USD, respetamos
-- esa señal: implica que el numérico en `total_amount` YA vive en USD tras
-- el backfill de conversión.
update public.sales
  set currency = 'USD'
  where original_currency = 'USD'
    and currency = 'ARS';
