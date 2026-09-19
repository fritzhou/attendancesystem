-- ============================================================
--  /sql/rate-limiting.sql — Phase 19: abuse protection table
-- ============================================================

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  ip text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index idx_rate_limit_lookup on public.rate_limit_events (ip, action, created_at);

-- Locked to service-role only — no anon/authenticated policies at
-- all, so only the Edge Function can read or write this table.
alter table public.rate_limit_events enable row level security;
