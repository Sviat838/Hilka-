-- Read + edit a thought-chain from the MCP server (2026-06-14).
--
-- Until now the only server-side entry point was create_chain (0006/0007). To let
-- an AI assistant *edit* an existing chain it must first be able to SEE the chain
-- (and the real node ids it will edit), then submit a batch of changes. This adds
-- three tools, each in the proven create_chain shape — an internal SECURITY
-- DEFINER *_core(p_user_id, ...) plus two thin entry points:
--   list_chains   — the user's chains (roots) with counts, so the model can pick one
--   get_chain     — one chain's whole tree + cross-links + a version token
--   edit_chain    — one ATOMIC batch of edits (updates/adds/moves/deletes/links)
--
-- Security spine (identical to 0006/0007 and 0008):
--   * Every *_core and helper that takes an explicit p_user_id is SECURITY DEFINER
--     and is REVOKEd from anon/authenticated/public — only the SECURITY DEFINER
--     entry points (running as the owner) may call them. SECURITY DEFINER bypasses
--     RLS, so the core CANNOT trust an id from the payload: it re-verifies that
--     every node an op touches is owned by p_user_id AND belongs to this chain.
--   * user_id is resolved from the PAT (resolve_pat_user) or auth.uid() ONLY,
--     never from the payload.
--   * search_path='' on every function (so every reference is schema-qualified and
--     a hostile search_path can't hijack the definer).
--
-- The existing triggers/CHECKs/FK remain the backstop: enforce_node_move (cycles +
-- "a dropped branch cannot grow children" on (re)parent), decline_reason_required,
-- nodes_status_check, and the parent_id ON DELETE RESTRICT (delete is leaf-only).
-- Note a node that is dropped *keeps* the children it already had (a greyed
-- tombstone subtree, PLAN.md §3.1) — only ATTACHING a new child to a dropped node
-- is illegal, which the trigger already enforces.
--
-- Apply to project htrvknxzunkqxcqsqxpm via MCP.

-- 0. Shared PAT resolver -----------------------------------------------------
-- The revoked/expired token lookup, factored out of the *_via_pat wrappers.
-- Stamps last_used_at. Raises 28000 on a bad token. Called only by SECURITY
-- DEFINER wrappers (as the owner), so it is locked to the owner.
create or replace function public.resolve_pat_user(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_pat_id  uuid;
begin
  select id, user_id into v_pat_id, v_user_id
  from public.pat
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if v_user_id is null then
    raise exception 'invalid or expired token' using errcode = '28000';
  end if;
  update public.pat set last_used_at = now() where id = v_pat_id;
  return v_user_id;
end;
$$;
revoke execute on function public.resolve_pat_user(text) from public, anon, authenticated;

-- 1. list_chains -------------------------------------------------------------
create or replace function public.list_chains_core(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'no user' using errcode = '28000';
  end if;

  with recursive forest as (
    select r.id as root_id, r.id, r.parent_id, r.status, r.updated_at
    from public.nodes r
    where r.user_id = p_user_id and r.parent_id is null
    union all
    select f.root_id, n.id, n.parent_id, n.status, n.updated_at
    from public.nodes n
    join forest f on n.parent_id = f.id
    where n.user_id = p_user_id
  ),
  agg as (
    select root_id,
           count(*)                                    as node_count,
           count(*) filter (where status = 'dropped')  as dropped_count,
           max(updated_at)                             as last_updated
    from forest
    group by root_id
  ),
  roots as (
    select id as chain_id, title, description, position, created_at, updated_at
    from public.nodes
    where user_id = p_user_id and parent_id is null
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'chain_id',      r.chain_id,
        'title',         r.title,
        'description',   r.description,
        'node_count',    coalesce(a.node_count, 1),
        'dropped_count', coalesce(a.dropped_count, 0),
        'created_at',    r.created_at,
        'updated_at',    greatest(r.updated_at, a.last_updated)
      )
      order by r.position, r.created_at
    ),
    '[]'::jsonb
  )
  into v_result
  from roots r
  left join agg a on a.root_id = r.chain_id;

  return v_result;
end;
$$;
revoke execute on function public.list_chains_core(uuid) from public, anon, authenticated;

create or replace function public.list_chains_via_pat(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.list_chains_core(public.resolve_pat_user(p_token_hash));
end;
$$;
revoke execute on function public.list_chains_via_pat(text) from public;
grant execute on function public.list_chains_via_pat(text) to anon, authenticated;

create or replace function public.list_chains()
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
  return public.list_chains_core(v_uid);
end;
$$;
revoke execute on function public.list_chains() from public, anon;
grant execute on function public.list_chains() to authenticated;

-- 2. get_chain ---------------------------------------------------------------
-- Returns the whole tree (nodes ordered depth-then-position), the cross-links
-- whose BOTH endpoints are in this chain, and a `version` digest the client can
-- pass back to edit_chain as expected_version for optimistic concurrency.
create or replace function public.get_chain_core(p_user_id uuid, p_chain_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root        public.nodes;
  v_nodes       jsonb;
  v_links       jsonb;
  v_version     text;
  v_count       int;
  v_ids         uuid[];
begin
  if p_user_id is null then
    raise exception 'no user' using errcode = '28000';
  end if;

  select * into v_root
  from public.nodes
  where id = p_chain_id and user_id = p_user_id and parent_id is null;
  if not found then
    raise exception 'chain % not found or not yours', p_chain_id using errcode = '42704';
  end if;

  with recursive tree as (
    select n.id, n.parent_id, n.title, n.description, n.status, n.decline_reason,
           n.position, n.updated_at, 1 as depth
    from public.nodes n
    where n.id = p_chain_id
    union all
    select c.id, c.parent_id, c.title, c.description, c.status, c.decline_reason,
           c.position, c.updated_at, t.depth + 1
    from public.nodes c
    join tree t on c.parent_id = t.id
    where c.user_id = p_user_id
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'id',             id,
        'parent_id',      parent_id,
        'title',          title,
        'description',    description,
        'status',         status,
        'decline_reason', decline_reason,
        'depth',          depth,
        'position',       position
      )
      order by depth, position
    ),
    count(*),
    md5(coalesce(string_agg(id::text || '@' || coalesce(updated_at::text, ''), '|' order by id), '')),
    array_agg(id)
  into v_nodes, v_count, v_version, v_ids
  from tree;

  select coalesce(
    jsonb_agg(jsonb_build_object('parent_id', l.parent_id, 'child_id', l.child_id)),
    '[]'::jsonb
  )
  into v_links
  from public.node_links l
  where l.user_id = p_user_id
    and l.parent_id = any(v_ids)
    and l.child_id  = any(v_ids);

  return jsonb_build_object(
    'chain_id',         p_chain_id,
    'title',            v_root.title,
    'root_description', v_root.description,
    'version',          v_version,
    'node_count',       v_count,
    'nodes',            coalesce(v_nodes, '[]'::jsonb),
    'links',            v_links
  );
end;
$$;
revoke execute on function public.get_chain_core(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_chain_via_pat(p_token_hash text, p_chain_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.get_chain_core(public.resolve_pat_user(p_token_hash), p_chain_id);
end;
$$;
revoke execute on function public.get_chain_via_pat(text, uuid) from public;
grant execute on function public.get_chain_via_pat(text, uuid) to anon, authenticated;

create or replace function public.get_chain(p_chain_id uuid)
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
  return public.get_chain_core(v_uid, p_chain_id);
end;
$$;
revoke execute on function public.get_chain(uuid) from public, anon;
grant execute on function public.get_chain(uuid) to authenticated;

-- 3. edit_chain --------------------------------------------------------------
-- p_ops shape (every array optional; an empty/absent array is a no-op):
--   {
--     "expected_version": "<md5 from get_chain>",   -- optional optimistic lock
--     "updates": [ { "id", "title"?, "description"?, "status"?, "decline_reason"? } ],
--     "adds":    [ { "key", "parent"?(uuid|other add key|null=>chain root),
--                    "title", "description"?, "status"?, "decline_reason"? } ],
--     "moves":   [ { "id", "parent"?(uuid|add key|null=>chain root),
--                    "before"?(sibling uuid) | "after"?(sibling uuid) } ],
--     "deletes": [ { "id", "force"?(bool) } ],
--     "links":   [ { "parent"(uuid), "child"(uuid) } ],
--     "unlinks": [ { "parent"(uuid), "child"(uuid) } ]
--   }
-- Returns { chain_id, ok, version, applied:{updated,added[{key,id,parent_id}],
--           moved,deleted,linked,unlinked}, counts:{nodes_after,dropped_after} }.
--
-- Apply order (one transaction): deletes(leaf-peel) -> adds(parents first) ->
-- moves -> updates -> unlinks -> links. Anything illegal rolls the whole batch back.
create or replace function public.edit_chain_core(p_user_id uuid, p_chain_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_owned     uuid[];
  v_version   text;
  v_op_count  int;
  v_expected  text;

  v_updates jsonb := coalesce(p_ops->'updates', '[]'::jsonb);
  v_adds    jsonb := coalesce(p_ops->'adds',    '[]'::jsonb);
  v_moves   jsonb := coalesce(p_ops->'moves',   '[]'::jsonb);
  v_deletes jsonb := coalesce(p_ops->'deletes', '[]'::jsonb);
  v_links   jsonb := coalesce(p_ops->'links',   '[]'::jsonb);
  v_unlinks jsonb := coalesce(p_ops->'unlinks', '[]'::jsonb);

  v_keymap  jsonb := '{}'::jsonb;     -- add key -> new uuid
  v_done    text[] := array[]::text[]; -- add keys already inserted
  v_del     uuid[] := array[]::uuid[];

  -- result accumulators
  r_updated  uuid[]  := array[]::uuid[];
  r_added    jsonb   := '[]'::jsonb;
  r_moved    uuid[]  := array[]::uuid[];
  r_deleted  uuid[]  := array[]::uuid[];
  r_linked   jsonb   := '[]'::jsonb;
  r_unlinked jsonb   := '[]'::jsonb;

  e         jsonb;   -- loop element
  v_id      uuid;
  v_pid     uuid;
  v_key     text;
  v_praw    text;
  v_progress bool;
  v_pass    int;
  v_pos     double precision;
  v_bpos    double precision;
  v_neighbor double precision;
  rec       public.nodes;
  v_status  text;
  v_reason  text;
  v_desc    text;
  v_title   text;
  v_reopen  bool;
  v_nodes_after int;
  v_dropped_after int;
begin
  -- (a) identity + chain ownership
  if p_user_id is null then
    raise exception 'no user' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.nodes
    where id = p_chain_id and user_id = p_user_id and parent_id is null
  ) then
    raise exception 'chain % not found or not yours', p_chain_id using errcode = '42704';
  end if;

  -- (b) the set of node ids this caller may touch = the chain_id subtree they own.
  --     SECURITY DEFINER bypasses RLS, so this is the ONLY thing standing between
  --     an op and another chain / another user's data. Every existing id an op
  --     names is checked against it.
  with recursive tree as (
    select id from public.nodes where id = p_chain_id and user_id = p_user_id
    union all
    select c.id from public.nodes c join tree t on c.parent_id = t.id
    where c.user_id = p_user_id
  )
  select array_agg(id) into v_owned from tree;

  -- (c) shape + size guards
  if jsonb_typeof(v_updates) <> 'array' or jsonb_typeof(v_adds) <> 'array'
     or jsonb_typeof(v_moves) <> 'array' or jsonb_typeof(v_deletes) <> 'array'
     or jsonb_typeof(v_links) <> 'array' or jsonb_typeof(v_unlinks) <> 'array' then
    raise exception 'updates/adds/moves/deletes/links/unlinks must each be a JSON array';
  end if;
  v_op_count := jsonb_array_length(v_updates) + jsonb_array_length(v_adds)
              + jsonb_array_length(v_moves) + jsonb_array_length(v_deletes)
              + jsonb_array_length(v_links) + jsonb_array_length(v_unlinks);
  if v_op_count > 500 then
    raise exception 'too many operations in one edit (% — max 500)', v_op_count;
  end if;

  -- (d) optimistic concurrency: reject if the chain moved since the client read it
  if p_ops ? 'expected_version'
     and nullif(btrim(coalesce(p_ops->>'expected_version','')), '') is not null then
    select md5(coalesce(string_agg(id::text || '@' || coalesce(updated_at::text,''), '|' order by id), ''))
    into v_expected
    from public.nodes where id = any(v_owned);
    if v_expected <> (p_ops->>'expected_version') then
      raise exception 'the chain changed since you read it — call get_chain again and re-apply your edit'
        using errcode = '40001';
    end if;
  end if;

  -- (e) DELETES (leaf-only; whole subtree must be listed). Validate first.
  for e in select * from jsonb_array_elements(v_deletes) loop
    if not (coalesce(e->>'id','') ~ c_uuid_re) then
      raise exception 'delete: each op needs a valid "id"';
    end if;
    v_id := (e->>'id')::uuid;
    if not (v_id = any(v_owned)) then
      raise exception 'delete: node % is not part of this chain', v_id;
    end if;
    if v_id = p_chain_id then
      raise exception 'delete: cannot delete the chain root — delete the whole chain from the app instead';
    end if;
    select * into rec from public.nodes where id = v_id;
    if coalesce((e->>'force')::bool, false) is not true and btrim(rec.description) <> '' then
      raise exception 'delete: node "%" has a description — drop it (status:dropped) to keep the reasoning, or pass force:true to delete', rec.title;
    end if;
    v_del := array_append(v_del, v_id);
  end loop;
  -- every child of a to-be-deleted node must also be in the delete set
  if exists (
    select 1 from public.nodes c
    where c.parent_id = any(v_del) and not (c.id = any(v_del))
  ) then
    raise exception 'delete: a node still has children not included in the delete — delete the whole subtree, or drop it instead';
  end if;
  -- leaf-peel: remove childless members until the set is empty (FK is ON DELETE RESTRICT)
  v_pass := 0;
  while array_length(v_del, 1) is not null loop
    v_pass := v_pass + 1;
    delete from public.nodes n
    where n.id = any(v_del)
      and not exists (select 1 from public.nodes c where c.parent_id = n.id);
    -- track + shrink v_del to what remains
    select array_agg(id) into v_del
    from public.nodes where id = any(v_del);
    v_del := coalesce(v_del, array[]::uuid[]);
    if v_pass > 1000 then
      raise exception 'delete: could not resolve delete order (unexpected)';
    end if;
    exit when array_length(v_del, 1) is null;
  end loop;
  -- record what was deleted (those ids no longer exist)
  for e in select * from jsonb_array_elements(v_deletes) loop
    r_deleted := array_append(r_deleted, (e->>'id')::uuid);
  end loop;

  -- (f) ADDS — validate, mint ids, then insert parents-before-children.
  -- validate keys
  for e in select * from jsonb_array_elements(v_adds) loop
    v_key := btrim(coalesce(e->>'key',''));
    if v_key = '' then
      raise exception 'add: every new node needs a non-blank "key"';
    end if;
    if v_key ~ c_uuid_re then
      raise exception 'add: "key" % must not look like a uuid', v_key;
    end if;
    if v_keymap ? v_key then
      raise exception 'add: duplicate key "%"', v_key;
    end if;
    if btrim(coalesce(e->>'title','')) = '' then
      raise exception 'add: node "%" needs a title', v_key;
    end if;
    if coalesce(e->>'status','todo') not in ('todo','doing','done','dropped') then
      raise exception 'add: node "%" has an invalid status', v_key;
    end if;
    if coalesce(e->>'status','todo') = 'dropped'
       and btrim(coalesce(e->>'decline_reason','')) = '' then
      raise exception 'add: dropped node "%" needs a non-blank decline_reason', v_key;
    end if;
    v_keymap := v_keymap || jsonb_build_object(v_key, gen_random_uuid()::text);
  end loop;
  -- insert in dependency passes (parents land before children)
  if jsonb_array_length(v_adds) > 0 then
    v_pass := 0;
    loop
      v_progress := false;
      v_pass := v_pass + 1;
      for e in select * from jsonb_array_elements(v_adds) loop
        v_key := btrim(e->>'key');
        if v_key = any(v_done) then
          continue;
        end if;
        -- resolve parent id
        v_praw := e->>'parent';
        if v_praw is null or btrim(v_praw) = '' then
          v_pid := p_chain_id;
        elsif v_keymap ? v_praw then
          v_pid := (v_keymap->>v_praw)::uuid;
        elsif v_praw ~ c_uuid_re and (v_praw::uuid = any(v_owned)) then
          v_pid := v_praw::uuid;
          if v_pid = any(v_del) then
            raise exception 'add: node "%" hangs off a node being deleted', v_key;
          end if;
        else
          raise exception 'add: node "%" has an unknown parent "%"', v_key, v_praw;
        end if;
        -- insertable only once its parent row exists
        if not exists (select 1 from public.nodes where id = v_pid) then
          continue;
        end if;
        select coalesce(max(position),0) + 1024 into v_pos
        from public.nodes where parent_id = v_pid;
        v_status := coalesce(e->>'status','todo');
        insert into public.nodes
          (id, user_id, parent_id, title, description, status, decline_reason, position, status_changed_at)
        values (
          (v_keymap->>v_key)::uuid, p_user_id, v_pid,
          btrim(e->>'title'),
          coalesce(e->>'description',''),
          v_status,
          case when v_status = 'dropped' then btrim(e->>'decline_reason') else null end,
          v_pos, now()
        );
        r_added := r_added || jsonb_build_object('key', v_key, 'id', (v_keymap->>v_key), 'parent_id', v_pid);
        v_done := array_append(v_done, v_key);
        v_progress := true;
      end loop;
      exit when coalesce(array_length(v_done,1),0) = jsonb_array_length(v_adds);
      if not v_progress then
        raise exception 'add: a new node references a parent key that is itself never added (cycle or orphan)';
      end if;
      if v_pass > 1000 then
        raise exception 'add: could not resolve add order (unexpected)';
      end if;
    end loop;
  end if;

  -- (g) MOVES — reparent and/or reorder (trigger enforces cycles + attach-to-dropped)
  for e in select * from jsonb_array_elements(v_moves) loop
    if not (coalesce(e->>'id','') ~ c_uuid_re) then
      raise exception 'move: each op needs a valid "id"';
    end if;
    v_id := (e->>'id')::uuid;
    if not (v_id = any(v_owned)) then
      raise exception 'move: node % is not part of this chain', v_id;
    end if;
    if v_id = p_chain_id then
      raise exception 'move: cannot move the chain root';
    end if;
    -- resolve target parent (default: keep current parent)
    if e ? 'parent' then
      v_praw := e->>'parent';
      if v_praw is null or btrim(coalesce(v_praw,'')) = '' then
        v_pid := p_chain_id;
      elsif v_keymap ? v_praw then
        v_pid := (v_keymap->>v_praw)::uuid;
      elsif v_praw ~ c_uuid_re and (v_praw::uuid = any(v_owned)) then
        v_pid := v_praw::uuid;
      else
        raise exception 'move: node % has an unknown parent "%"', v_id, v_praw;
      end if;
    else
      select parent_id into v_pid from public.nodes where id = v_id;
    end if;
    if v_pid = v_id then
      raise exception 'move: a node cannot be its own parent';
    end if;
    -- position
    if (e ? 'before') and (e ? 'after') then
      raise exception 'move: "before" and "after" are mutually exclusive';
    elsif e ? 'before' then
      if not ((e->>'before') ~ c_uuid_re and ((e->>'before')::uuid = any(v_owned))) then
        raise exception 'move: "before" must be a node in this chain';
      end if;
      select position into v_bpos from public.nodes
        where id = (e->>'before')::uuid and parent_id = v_pid;
      if v_bpos is null then
        raise exception 'move: "before" node is not a child of the target parent';
      end if;
      select max(position) into v_neighbor from public.nodes
        where parent_id = v_pid and position < v_bpos and id <> v_id;
      v_pos := case when v_neighbor is null then v_bpos - 1024 else (v_neighbor + v_bpos) / 2 end;
    elsif e ? 'after' then
      if not ((e->>'after') ~ c_uuid_re and ((e->>'after')::uuid = any(v_owned))) then
        raise exception 'move: "after" must be a node in this chain';
      end if;
      select position into v_bpos from public.nodes
        where id = (e->>'after')::uuid and parent_id = v_pid;
      if v_bpos is null then
        raise exception 'move: "after" node is not a child of the target parent';
      end if;
      select min(position) into v_neighbor from public.nodes
        where parent_id = v_pid and position > v_bpos and id <> v_id;
      v_pos := case when v_neighbor is null then v_bpos + 1024 else (v_bpos + v_neighbor) / 2 end;
    else
      select coalesce(max(position),0) + 1024 into v_pos
      from public.nodes where parent_id = v_pid and id <> v_id;
    end if;

    update public.nodes
      set parent_id = v_pid, position = v_pos, updated_at = now()
      where id = v_id;
    r_moved := array_append(r_moved, v_id);
  end loop;

  -- (h) UPDATES — partial; reopen prepends the old drop reason (mirrors the app)
  for e in select * from jsonb_array_elements(v_updates) loop
    if not (coalesce(e->>'id','') ~ c_uuid_re) then
      raise exception 'update: each op needs a valid "id"';
    end if;
    v_id := (e->>'id')::uuid;
    if not (v_id = any(v_owned)) then
      raise exception 'update: node % is not part of this chain', v_id;
    end if;
    select * into rec from public.nodes where id = v_id;

    v_title  := case when e ? 'title'       then btrim(coalesce(e->>'title', rec.title))  else rec.title end;
    if btrim(coalesce(v_title,'')) = '' then
      raise exception 'update: node % cannot have a blank title', v_id;
    end if;
    v_status := case when e ? 'status'      then coalesce(e->>'status', rec.status)       else rec.status end;
    if v_status not in ('todo','doing','done','dropped') then
      raise exception 'update: node % has an invalid status "%"', v_id, v_status;
    end if;
    v_desc   := case when e ? 'description' then coalesce(e->>'description', '')          else rec.description end;

    v_reopen := rec.status = 'dropped' and v_status <> 'dropped';
    if v_reopen then
      v_desc := rtrim('[' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD')
                      || '] Reopened. Was dropped: ' || coalesce(rec.decline_reason, ''))
                || case when btrim(coalesce(v_desc,'')) <> '' then E'\n\n' || v_desc else '' end;
    end if;

    if v_status = 'dropped' then
      -- resulting reason = provided, else the one already on the row (re-drop prefill)
      v_reason := nullif(btrim(coalesce(
                    case when e ? 'decline_reason' then e->>'decline_reason' else rec.decline_reason end, '')), '');
      if v_reason is null then
        raise exception 'update: dropping node "%" needs a non-blank decline_reason', v_title;
      end if;
    end if;

    update public.nodes set
      title             = v_title,
      description       = v_desc,
      status            = v_status,
      decline_reason    = case when v_status = 'dropped' then v_reason else rec.decline_reason end,
      status_changed_at = case when v_status <> rec.status then now() else rec.status_changed_at end,
      updated_at        = now()
    where id = v_id;
    r_updated := array_append(r_updated, v_id);
  end loop;

  -- (i) UNLINKS then LINKS (cross-links; both endpoints must be in this chain)
  for e in select * from jsonb_array_elements(v_unlinks) loop
    if not ((e->>'parent') ~ c_uuid_re and (e->>'child') ~ c_uuid_re) then
      raise exception 'unlink: needs valid "parent" and "child" ids';
    end if;
    if not ((e->>'parent')::uuid = any(v_owned) and (e->>'child')::uuid = any(v_owned)) then
      raise exception 'unlink: both ends must be nodes in this chain';
    end if;
    delete from public.node_links
      where user_id = p_user_id
        and parent_id = (e->>'parent')::uuid
        and child_id  = (e->>'child')::uuid;
    if found then
      r_unlinked := r_unlinked || jsonb_build_object('parent_id', e->>'parent', 'child_id', e->>'child');
    end if;
  end loop;

  for e in select * from jsonb_array_elements(v_links) loop
    if not ((e->>'parent') ~ c_uuid_re and (e->>'child') ~ c_uuid_re) then
      raise exception 'link: needs valid "parent" and "child" ids';
    end if;
    v_pid := (e->>'parent')::uuid;
    v_id  := (e->>'child')::uuid;
    if not (v_pid = any(v_owned) and v_id = any(v_owned)) then
      raise exception 'link: both ends must be nodes in this chain';
    end if;
    if v_pid = v_id then
      raise exception 'link: a node cannot link to itself';
    end if;
    if exists (select 1 from public.nodes where id = v_id and parent_id = v_pid) then
      raise exception 'link: % is already a direct child of %', v_id, v_pid;
    end if;
    insert into public.node_links (user_id, parent_id, child_id)
    values (p_user_id, v_pid, v_id)
    on conflict (parent_id, child_id) do nothing;
    if found then
      r_linked := r_linked || jsonb_build_object('parent_id', e->>'parent', 'child_id', e->>'child');
    end if;
  end loop;

  -- (j) recompute version + counts over the (mutated) subtree
  with recursive tree as (
    select id, status, updated_at from public.nodes where id = p_chain_id and user_id = p_user_id
    union all
    select c.id, c.status, c.updated_at from public.nodes c
    join tree t on c.parent_id = t.id where c.user_id = p_user_id
  )
  select
    md5(coalesce(string_agg(id::text || '@' || coalesce(updated_at::text,''), '|' order by id), '')),
    count(*),
    count(*) filter (where status = 'dropped')
  into v_version, v_nodes_after, v_dropped_after
  from tree;

  return jsonb_build_object(
    'chain_id', p_chain_id,
    'ok', true,
    'version', v_version,
    'applied', jsonb_build_object(
      'updated',  to_jsonb(r_updated),
      'added',    r_added,
      'moved',    to_jsonb(r_moved),
      'deleted',  to_jsonb(r_deleted),
      'linked',   r_linked,
      'unlinked', r_unlinked
    ),
    'counts', jsonb_build_object('nodes_after', v_nodes_after, 'dropped_after', v_dropped_after)
  );
end;
$$;
revoke execute on function public.edit_chain_core(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.edit_chain_via_pat(p_token_hash text, p_chain_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.edit_chain_core(public.resolve_pat_user(p_token_hash), p_chain_id, p_ops);
end;
$$;
revoke execute on function public.edit_chain_via_pat(text, uuid, jsonb) from public;
grant execute on function public.edit_chain_via_pat(text, uuid, jsonb) to anon, authenticated;

create or replace function public.edit_chain(p_chain_id uuid, p_ops jsonb)
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
  return public.edit_chain_core(v_uid, p_chain_id, p_ops);
end;
$$;
revoke execute on function public.edit_chain(uuid, jsonb) from public, anon;
grant execute on function public.edit_chain(uuid, jsonb) to authenticated;
