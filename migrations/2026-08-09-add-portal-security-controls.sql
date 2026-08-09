begin;

create table if not exists public.portal_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  blocked_until timestamptz,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.portal_rate_limits enable row level security;
revoke all on table public.portal_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.portal_rate_limits to service_role;

create index if not exists portal_rate_limits_expires_at_idx
  on public.portal_rate_limits (expires_at);

create or replace function public.check_portal_rate_limit(
  p_key_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.portal_rate_limits%rowtype;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$'
     or p_max_attempts not between 1 and 10000
     or p_window_seconds not between 10 and 86400
     or p_block_seconds not between 10 and 604800 then
    raise exception 'invalid rate-limit parameters';
  end if;

  insert into public.portal_rate_limits as limits (
    key_hash, window_started_at, attempts, blocked_until, expires_at, updated_at
  ) values (
    p_key_hash,
    v_now,
    1,
    null,
    v_now + make_interval(secs => p_window_seconds + p_block_seconds),
    v_now
  )
  on conflict (key_hash) do update set
    window_started_at = case
      when limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
      else limits.window_started_at
    end,
    attempts = case
      when limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
      else limits.attempts + 1
    end,
    blocked_until = case
      when limits.blocked_until is not null and limits.blocked_until > v_now then limits.blocked_until
      when limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then null
      when limits.attempts + 1 > p_max_attempts then v_now + make_interval(secs => p_block_seconds)
      else null
    end,
    expires_at = v_now + make_interval(secs => p_window_seconds + p_block_seconds),
    updated_at = v_now
  returning limits.* into v_row;

  allowed := (v_row.blocked_until is null or v_row.blocked_until <= v_now)
    and v_row.attempts <= p_max_attempts;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer)
  end;
  return next;
end;
$$;

revoke all on function public.check_portal_rate_limit(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_portal_rate_limit(text, integer, integer, integer)
  to service_role;

create table if not exists public.portal_security_events (
  id bigint generated always as identity primary key,
  event_type text not null check (length(event_type) between 1 and 80),
  actor_type text not null check (actor_type in ('anonymous', 'admin', 'partner')),
  success boolean not null,
  identifier_hash text check (identifier_hash is null or identifier_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash text not null check (user_agent_hash ~ '^[0-9a-f]{64}$'),
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.portal_security_events enable row level security;
revoke all on table public.portal_security_events from public, anon, authenticated;
revoke all on sequence public.portal_security_events_id_seq from public, anon, authenticated;
grant select, insert, delete on table public.portal_security_events to service_role;
grant usage, select on sequence public.portal_security_events_id_seq to service_role;

create index if not exists portal_security_events_created_at_idx
  on public.portal_security_events (created_at desc);
create index if not exists portal_security_events_type_created_at_idx
  on public.portal_security_events (event_type, created_at desc);

comment on table public.portal_rate_limits is
  'Service-role-only counters for portal abuse prevention. Keys are SHA-256 hashes; raw IPs/emails/tokens are never stored.';
comment on table public.portal_security_events is
  'Service-role-only, metadata-minimised authentication and authorization audit trail.';

commit;
