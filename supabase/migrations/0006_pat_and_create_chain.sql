-- Personal Access Tokens + a server-side "create a whole chain" entry point
-- (2026-06-14). This is the database half of letting any Hilka user create a
-- thought-chain from their AI assistant: a remote MCP server (a Cloudflare
-- Worker) authenticates the user by a PAT and calls create_chain_via_pat to
-- insert the tree.
--
-- The security spine: the elevated insert lives ONLY inside this SECURITY
-- DEFINER function, inside Postgres. The Worker holds no service_role key and no
-- JWT signing key — it only forwards (token_hash, payload). user_id is resolved
-- from the token here and set server-side; it is NEVER taken from the payload,
-- so one user can never write into another's account. The existing triggers
-- (enforce_node_move: cycle + dropped-leaf) and CHECKs (decline_reason_required,
-- nodes_status_check) remain the backstop — this function runs *with* them.
--
-- Apply to project htrvknxzunkqxcqsqxpm via MCP.

-- 1. Personal Access Tokens -------------------------------------------------
-- The raw token is shown to the user exactly once and never stored; we keep
-- only its SHA-256 (hex). Because tokens are high-entropy (256 random bits),
-- a plain SHA-256 is sufficient — no preimage is feasible and the hash is never
-- exposed in a way that helps an attacker.
create table public.pat (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_hash    text not null unique,                 -- lowercase hex sha-256 of the raw token
  name          text not null default '',             -- user label, e.g. "Claude on my laptop"
  scopes        text[] not null default array['create_chain'],
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,                           -- null = no expiry
  revoked_at    timestamptz
);

create index idx_pat_user on public.pat (user_id);

alter table public.pat enable row level security;

-- A user manages only their own tokens. (The Worker never reads this table as a
-- client — only the SECURITY DEFINER function below touches it.)
create policy owner_select on public.pat
  for select using (user_id = (select auth.uid()));
create policy owner_insert on public.pat
  for insert with check (user_id = (select auth.uid()));
create policy owner_update on public.pat
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy owner_delete on public.pat
  for delete using (user_id = (select auth.uid()));

-- 2. create_chain_via_pat ----------------------------------------------------
-- Insert one whole thought-tree on behalf of the PAT's owner. Input shape:
--   p_token_hash : lowercase hex sha-256 of the caller's raw PAT
--   p_payload    : {
--     "title": "Root title",                 -- the chain (root node) title
--     "root_description": "...",              -- root node description (may be "")
--     "nodes": [
--       { "key": "a",                         -- caller's arbitrary unique label
--         "parent_key": null,                 -- null/"" = child of the root
--         "title": "...", "description": "...",
--         "status": "todo|doing|done|dropped",
--         "decline_reason": null }            -- required & non-blank IFF status="dropped"
--     ]
--   }
-- Returns { "root_id": uuid, "node_count": int }.
--
-- The function owns everything the model must not: UUIDs, position (fractional
-- sibling order, append = +1024), status_changed_at, parents-before-children
-- ordering, and user_id (from the token only). It validates the tree up front so
-- the assistant gets a clear, self-correctable error instead of a raw trigger
-- failure, and so cycle/orphan nodes can't be silently dropped by the insert.
create or replace function public.create_chain_via_pat(p_token_hash text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid;
  v_pat_id    uuid;
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
  -- (a) authenticate by token hash; the raw token never reaches the database
  select id, user_id into v_pat_id, v_user_id
  from public.pat
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if v_user_id is null then
    raise exception 'invalid or expired token' using errcode = '28000';
  end if;

  -- (b) validate the tree before touching the table
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

  -- every parent_key must reference a real node key
  if exists (
    select 1 from jsonb_array_elements(v_nodes) as a(e)
    where nullif(a.e->>'parent_key','') is not null
      and not exists (
        select 1 from jsonb_array_elements(v_nodes) as b(e)
        where b.e->>'key' = a.e->>'parent_key')
  ) then
    raise exception 'a parent_key does not match any node key';
  end if;

  -- a dropped thought must be a leaf (the enforce_node_move trigger agrees)
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

  -- every node must descend from the root: catches cycles/orphans that the
  -- insert below would otherwise silently drop
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

  -- (c) the new root appends after the caller's existing roots
  select coalesce(max(position), 0) + 1024
  into v_root_pos
  from public.nodes
  where user_id = v_user_id and parent_id is null;

  -- (d) one atomic insert; parents before children (ORDER BY depth) so the
  --     trigger's parent-existence + dropped-leaf checks pass
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
    v_user_id,
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

  -- (e) record usage, hand back the new chain id
  update public.pat set last_used_at = now() where id = v_pat_id;

  return jsonb_build_object('root_id', v_root_id, 'node_count', v_count + 1);
end;
$$;

-- The publishable/anon key the Worker carries maps to the anon role; the gate is
-- the token hash inside the function, not the caller's role.
revoke all on function public.create_chain_via_pat(text, jsonb) from public;
grant execute on function public.create_chain_via_pat(text, jsonb) to anon, authenticated;
