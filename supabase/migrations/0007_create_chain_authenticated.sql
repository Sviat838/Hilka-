-- OAuth path (2026-06-14): let an authenticated caller create a chain directly,
-- so the hilka-mcp Worker can forward a user's Supabase OAuth token (from
-- Supabase's OAuth 2.1 server) to a normal RPC and have RLS/auth.uid() resolve
-- the identity — no PAT needed for the OAuth flow.
--
-- The whole tree-building logic from 0006 is extracted into create_chain_core
-- (internal, SECURITY DEFINER) so both entry points share it:
--   - create_chain_via_pat(token_hash, payload)  -> PAT path (v1, unchanged behavior)
--   - create_chain(payload)                       -> OAuth/session path, user = auth.uid()
--
-- Apply to project htrvknxzunkqxcqsqxpm via MCP.

-- 1. Shared core: insert one whole tree for a given user. Internal only.
create or replace function public.create_chain_core(p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title     text := btrim(coalesce(p_payload->>'title', ''));
  v_root_desc text := coalesce(p_payload->>'root_description', '');
  v_nodes     jsonb := coalesce(p_payload->'nodes', '[]'::jsonb);
  v_root_id   uuid  := gen_random_uuid();
  v_root_pos  double precision;
  v_count          int;
  v_blank_titles   int;
  v_bad_status     int;
  v_drop_no_reason int;
  v_dup            int;
  v_reach          int;
begin
  if p_user_id is null then
    raise exception 'no user' using errcode = '28000';
  end if;
  if v_title = '' then
    raise exception 'chain title is required';
  end if;
  if jsonb_typeof(v_nodes) <> 'array' then
    raise exception 'nodes must be a JSON array';
  end if;

  select
    count(*),
    count(*) filter (where btrim(coalesce(e->>'title','')) = ''),
    count(*) filter (where coalesce(e->>'status','todo') not in ('todo','doing','done','dropped')),
    count(*) filter (where coalesce(e->>'status','todo') = 'dropped'
                      and btrim(coalesce(e->>'decline_reason','')) = '')
  into v_count, v_blank_titles, v_bad_status, v_drop_no_reason
  from jsonb_array_elements(v_nodes) as t(e);

  if v_count > 500 then
    raise exception 'too many thoughts in one chain (% — max 500)', v_count;
  end if;
  if v_blank_titles > 0 then
    raise exception 'every thought needs a title (% missing)', v_blank_titles;
  end if;
  if v_bad_status > 0 then
    raise exception 'invalid status on % thought(s); allowed: todo, doing, done, dropped', v_bad_status;
  end if;
  if v_drop_no_reason > 0 then
    raise exception 'a dropped thought needs a non-blank reason (% missing it)', v_drop_no_reason;
  end if;

  select count(*) - count(distinct e->>'key') into v_dup
  from jsonb_array_elements(v_nodes) as t(e);
  if v_dup > 0 then
    raise exception 'node keys must be unique';
  end if;
  if exists (select 1 from jsonb_array_elements(v_nodes) as t(e) where coalesce(btrim(e->>'key'),'') = '') then
    raise exception 'every node needs a non-blank key';
  end if;
  if exists (select 1 from jsonb_array_elements(v_nodes) as t(e) where e->>'key' = '__root__') then
    raise exception 'node key "__root__" is reserved';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_nodes) as a(e)
    where nullif(a.e->>'parent_key','') is not null
      and not exists (
        select 1 from jsonb_array_elements(v_nodes) as b(e)
        where b.e->>'key' = a.e->>'parent_key')
  ) then
    raise exception 'a parent_key does not match any node key';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_nodes) as a(e)
    where nullif(a.e->>'parent_key','') is not null
      and exists (
        select 1 from jsonb_array_elements(v_nodes) as p(e)
        where p.e->>'key' = a.e->>'parent_key'
          and coalesce(p.e->>'status','todo') = 'dropped')
  ) then
    raise exception 'a dropped thought cannot have children — drop only leaves';
  end if;

  with recursive walk as (
    select e->>'key' as key
    from jsonb_array_elements(v_nodes) as t(e)
    where nullif(e->>'parent_key','') is null
    union
    select a.e->>'key'
    from jsonb_array_elements(v_nodes) as a(e)
    join walk w on nullif(a.e->>'parent_key','') = w.key
  )
  select count(*) into v_reach from walk;
  if v_reach < v_count then
    raise exception 'every thought must descend from the root (cycle or orphan in parent_key)';
  end if;

  select coalesce(max(position), 0) + 1024
  into v_root_pos
  from public.nodes
  where user_id = p_user_id and parent_id is null;

  with recursive allnodes as (
    select '__root__'::text as key, null::text as parent_key,
           v_title as title, v_root_desc as description, 'todo'::text as status,
           null::text as decline_reason, 0::bigint as ord
    union all
    select e->>'key',
           coalesce(nullif(e->>'parent_key',''), '__root__'),
           coalesce(e->>'title',''),
           coalesce(e->>'description',''),
           coalesce(e->>'status','todo'),
           e->>'decline_reason',
           ord
    from jsonb_array_elements(v_nodes) with ordinality as t(e, ord)
  ),
  ids as (
    select key, case when key = '__root__' then v_root_id else gen_random_uuid() end as id
    from allnodes
  ),
  lvl as (
    select key, 0 as depth from allnodes where key = '__root__'
    union all
    select a.key, l.depth + 1
    from allnodes a join lvl l on a.parent_key = l.key
    where a.key <> '__root__'
  ),
  pos as (
    select key,
           1024.0 * row_number() over (partition by parent_key order by ord) as position
    from allnodes
  )
  insert into public.nodes
    (id, user_id, parent_id, title, description, status, decline_reason, position, status_changed_at)
  select
    ids.id,
    p_user_id,
    parent.id,
    a.title, a.description, a.status,
    case when a.status = 'dropped' then a.decline_reason else null end,
    case when a.key = '__root__' then v_root_pos else pos.position end,
    now()
  from allnodes a
  join ids on ids.key = a.key
  join lvl on lvl.key = a.key
  join pos on pos.key = a.key
  left join ids parent on parent.key = a.parent_key
  order by lvl.depth;

  return jsonb_build_object('root_id', v_root_id, 'node_count', v_count + 1);
end;
$$;

revoke all on function public.create_chain_core(uuid, jsonb) from public;

-- 2. PAT entry point now delegates to the core (behavior unchanged).
create or replace function public.create_chain_via_pat(p_token_hash text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_pat_id  uuid;
  v_result  jsonb;
begin
  select id, user_id into v_pat_id, v_user_id
  from public.pat
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if v_user_id is null then
    raise exception 'invalid or expired token' using errcode = '28000';
  end if;

  v_result := public.create_chain_core(v_user_id, p_payload);
  update public.pat set last_used_at = now() where id = v_pat_id;
  return v_result;
end;
$$;

revoke all on function public.create_chain_via_pat(text, jsonb) from public;
grant execute on function public.create_chain_via_pat(text, jsonb) to anon, authenticated;

-- 3. OAuth/session entry point: identity from the verified JWT (auth.uid()).
--    The Worker forwards the user's Supabase OAuth token; PostgREST verifies it
--    and sets auth.uid(); this never trusts a caller-supplied user id.
create or replace function public.create_chain(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return public.create_chain_core(v_uid, p_payload);
end;
$$;

revoke all on function public.create_chain(jsonb) from public;
grant execute on function public.create_chain(jsonb) to authenticated;
