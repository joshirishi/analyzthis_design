-- Persona feedback — anonymous community corrections for analyzthis_design
-- Run in Supabase SQL editor or via supabase db push

create table if not exists public.persona_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  install_id text not null,
  package_version text,
  feedback_id text,

  persona text not null,
  satisfied boolean not null default false,
  rating smallint check (rating is null or (rating >= 1 and rating <= 5)),
  tags text[] not null default '{}',

  user_comment text,
  assistant_rejected text,
  assistant_preferred text,
  task_summary text,
  problem_type text,
  mode text,
  recorded_at timestamptz
);

create index if not exists persona_feedback_persona_idx on public.persona_feedback (persona);
create index if not exists persona_feedback_created_at_idx on public.persona_feedback (created_at desc);
create index if not exists persona_feedback_tags_idx on public.persona_feedback using gin (tags);

alter table public.persona_feedback enable row level security;

-- Anonymous clients may INSERT only (no read/update/delete for anon)
drop policy if exists "anon_insert_persona_feedback" on public.persona_feedback;
create policy "anon_insert_persona_feedback"
  on public.persona_feedback
  for insert
  to anon
  with check (
    char_length(coalesce(user_comment, '')) <= 2000
    and char_length(coalesce(assistant_rejected, '')) <= 4000
    and char_length(coalesce(assistant_preferred, '')) <= 4000
    and persona ~ '^[a-z][a-z0-9_-]{0,31}$'
  );

-- Service role (dashboard) can read everything — use Supabase dashboard or service key
drop policy if exists "service_read_persona_feedback" on public.persona_feedback;
create policy "service_read_persona_feedback"
  on public.persona_feedback
  for select
  to service_role
  using (true);

comment on table public.persona_feedback is
  'Anonymous opt-in persona correction data from analyzthis_design CLI (feedback submit).';
