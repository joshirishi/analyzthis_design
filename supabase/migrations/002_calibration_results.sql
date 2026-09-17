-- Fixed-benchmark calibration aggregates. Private prompts and outputs are never stored.

create table if not exists public.calibration_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  install_id text not null,
  package_version text,
  benchmark_version text not null,
  validator_version text not null,
  judge_policy_version text not null,
  prompt_hash text not null,
  persona text not null,
  effort text not null,
  output_format text not null,
  model_id text not null,
  sample_count integer not null check (sample_count > 0),
  score_mean double precision check (score_mean between 0 and 1),
  score_variance double precision check (score_variance between 0 and 1),
  pass_rate double precision check (pass_rate between 0 and 1),
  latency_ms integer check (latency_ms >= 0),
  availability_rate double precision check (availability_rate between 0 and 1),
  cost_usd double precision check (cost_usd >= 0),
  unique (
    install_id, package_version, benchmark_version, validator_version,
    judge_policy_version, prompt_hash, persona, effort, output_format, model_id
  )
);

create index if not exists calibration_results_lookup_idx
  on public.calibration_results (benchmark_version, validator_version, persona, effort, model_id);

alter table public.calibration_results enable row level security;

comment on table public.calibration_results is
  'Opt-in, text-free fixed-benchmark aggregates. Access is through the Neon database owner used by the server endpoint.';
