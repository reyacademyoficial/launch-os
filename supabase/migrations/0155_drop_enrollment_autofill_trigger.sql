-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0155 — enrollments: drop trigger a_autofill_expiration                   │
-- │                                                                          │
-- │ Historia:                                                               │
-- │   0144 creó un trigger `a_autofill_expiration` que autocompletaba       │
-- │   `enrollments.access_expires_at` como `enrolled_at + course.default_   │
-- │   access_days` cuando el operador no lo pasaba.                        │
-- │                                                                          │
-- │ Cambio de regla (2026-08-22):                                          │
-- │   La vigencia ahora depende del método de pago de la venta asociada:   │
-- │     - Pago único (installment_count = 1) → sin vencimiento             │
-- │     - Cuotas (installment_count > 1)    → 1 año desde purchased_at     │
-- │   Salvo que el curso tenga vigencia fija (`default_access_days`) —    │
-- │   ahí ese valor pisa la regla por método de pago (override).           │
-- │                                                                          │
-- │ La regla requiere conocer la venta (installment_count) y hacer join    │
-- │ vía cohort → course. En la DB queda muy verboso; conviene tenerlo en   │
-- │ app (`src/lib/academia/access-expiration.ts`) porque también es la     │
-- │ regla que quiere manipular futuro código de creación auto de           │
-- │ enrollments desde sales.                                               │
-- │                                                                          │
-- │ Enrollments existentes: no se tocan. La regla nueva aplica desde la    │
-- │ próxima creación en adelante (decisión de negocio).                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

drop trigger if exists a_autofill_expiration on public.enrollments;
drop function if exists public.enrollments_autofill_expiration();
