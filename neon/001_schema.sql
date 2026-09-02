-- analyzthis_design — persona feedback schema for Neon (plain Postgres)
--
-- Differs from supabase/migrations/* on purpose: Neon has no PostgREST and no
-- `anon` role, so there are NO RLS policies here. The database is never reached
-- by a client. The only thing that connects is the Vercel function in
-- website/api/feedback.js, which holds the connection string in its env.
-- That function is the gate: it validates, caps, and rate-limits.
--
-- Apply:  psql "$NEON_DATABASE_URL" -f neon/001_schema.sql

create extension if not exists pgcrypto;

-- ── Corrections: one row per designer reaction ───────────────────────────────
create table if not exists persona_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  install_id text not null,
  package_version text,
  feedback_id text,

  persona text not null,
  satisfied boolean not null default false,
  rating smallint check (rating is null or (rating between 1 and 5)),
  tags text[] not null default '{}',

  -- What actually happened to the advice. This is the column that separates
  -- "the designer was annoyed" from "the persona was wrong", and only the
  -- second justifies changing the shipped package.
  outcome text check (outcome is null or outcome in ('shipped','revised','blocked_correctly','missed')),
  task_type text,

  user_comment text,
  assistant_rejected text,
  assistant_preferred text,
  task_summary text,
  problem_type text,
  mode text,
  recorded_at timestamptz,

  -- The client generates feedback_id; make replays idempotent.
  unique (install_id, feedback_id)
);

create index if not exists persona_feedback_persona_idx     on persona_feedback (persona);
create index if not exists persona_feedback_created_at_idx  on persona_feedback (created_at desc);
create index if not exists persona_feedback_outcome_idx     on persona_feedback (persona, outcome);
create index if not exists persona_feedback_tags_idx        on persona_feedback using gin (tags);

-- ── Aggregate scores: counts only, never note text ───────────────────────────
create table if not exists persona_scores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  install_id text not null,
  package_version text,

  persona text not null,
  score smallint check (score is null or (score between 0 and 100)),
  level text,
  evidence_count integer not null default 0,

  shipped integer not null default 0,
  revised integer not null default 0,
  blocked_correctly integer not null default 0,
  missed integer not null default 0,
  avg_rating numeric(3,1),

  unique (install_id, persona, package_version)
);

create index if not exists persona_scores_persona_idx on persona_scores (persona, level);

-- ── The maintainer's view ────────────────────────────────────────────────────
-- A rule is only worth changing in the shipped package if it fails across MANY
-- INSTALLS, not many times for one loud user. install_count is that gate.
create or replace view persona_failure_signal as
select
  persona,
  coalesce(nullif(task_type, ''), problem_type, 'unknown') as task_type,
  count(*)                                    as reports,
  count(distinct install_id)                  as install_count,
  count(*) filter (where outcome = 'missed')  as missed,
  count(*) filter (where outcome = 'revised') as revised,
  count(*) filter (where outcome = 'shipped') as shipped,
  round(avg(rating)::numeric, 2)              as avg_rating,
  array_agg(distinct t) filter (where t is not null) as tags
from persona_feedback
left join lateral unnest(tags) as t on true
where outcome is not null
group by 1, 2
having count(distinct install_id) >= 3
order by count(*) filter (where outcome in ('missed','revised')) desc;

comment on view persona_failure_signal is
  'Maintainer view: recurring persona failures by task type, gated at 3+ distinct installs.';
comment on table persona_scores is
  'Aggregate persona trust scores. Counts only - no note text.';
