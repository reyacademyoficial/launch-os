-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Sueldo base por persona                │
-- │                                                                          │
-- │ Complemento de 0058: la persona guarda el sueldo mensual "de referencia" │
-- │ que se usa como default al cargar una liquidación de nómina (0066).      │
-- │ Sigue siendo per-row en payroll — acá solo se guarda el valor sugerido   │
-- │ para no obligar al operador a retipear el mismo número cada mes.         │
-- │                                                                          │
-- │ Moneda: por-persona (típicamente ARS pero puede ser USD para contratos   │
-- │ dolarizados). Al generar la row de payroll, currency baja de acá.        │
-- │                                                                          │
-- │ Aditivo puro. Personas existentes quedan con monthly_salary=0 y          │
-- │ salary_currency='ARS'; hay que editarlas una vez.                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.organization_people
  add column if not exists monthly_salary numeric(14, 2) not null default 0
    check (monthly_salary >= 0),
  add column if not exists salary_currency text not null default 'ARS'
    check (salary_currency in ('ARS', 'USD'));
