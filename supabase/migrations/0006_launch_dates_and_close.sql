-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Launch window + close state                                              │
-- │                                                                          │
-- │ A launch is a campaign with a temporal window: it has a start date and   │
-- │ (optionally) an end date. When it gets "closed" (closed_at IS NOT NULL)  │
-- │ no more daily data may be loaded. Phase 3 (integrations) will use the    │
-- │ same flag to stop the sync engine.                                       │
-- │                                                                          │
-- │ The legacy `date` column (single date) stays for now, deprecated. It is  │
-- │ no longer read or written by the app; backfilled into `date_start` here  │
-- │ so historical launches keep their starting point. A future migration may │
-- │ drop it once we are sure nothing external depends on it.                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.launches
  add column if not exists date_start date,
  add column if not exists date_end   date,
  add column if not exists closed_at  timestamptz;

-- Backfill: legacy single `date` becomes the launch start date.
update public.launches
   set date_start = date
 where date_start is null
   and date is not null;

-- Window invariant: end >= start (when both are present).
alter table public.launches
  drop constraint if exists launches_date_window_chk;
alter table public.launches
  add constraint launches_date_window_chk
  check (date_end is null or date_start is null or date_end >= date_start);

-- Index on date_start replaces the order-by we used to do on `date`.
create index if not exists launches_date_start_idx
  on public.launches(date_start desc);
