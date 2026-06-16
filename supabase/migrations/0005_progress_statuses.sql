-- D1 re-amended 2026-06-13 (owner request): replace the decision axis
-- (open|declined) with a four-value PROGRESS axis: todo|doing|done|dropped.
-- A thought is now tracked by where it stands, not by accept/reject. The
-- "dead branch, kept and locked, reasoning preserved" behavior carries over
-- onto `dropped` — the natural successor to `declined`: it is the one
-- tombstone state (greyed subtree, can't grow children, struck through in
-- export, requires a reason, reopen-prepends the old reason). todo/doing/done
-- are all "live" (grow children, edit freely), exactly as `open` was.
-- Data: open -> todo, declined -> dropped. `decline_reason` is kept as-is and
-- now holds the drop reason. Applied to project htrvknxzunkqxcqsqxpm via MCP.

-- 1. lift the constraints that pin the old two-value vocabulary
alter table public.nodes drop constraint nodes_status_check;
alter table public.nodes drop constraint decline_reason_required;

-- 2. relabel existing rows onto the progress axis
update public.nodes set status = 'todo'    where status = 'open';
update public.nodes set status = 'dropped' where status = 'declined';

-- 3. the new four-value progress axis (TEXT + CHECK, never a PG enum — D1)
alter table public.nodes alter column status set default 'todo';
alter table public.nodes add constraint nodes_status_check
  check (status in ('todo', 'doing', 'done', 'dropped'));

-- 4. dropped stays the one heavy state — a non-blank reason is still required
--    (the reason is the product's whole point: turning a dead end into inventory)
alter table public.nodes add constraint decline_reason_required check (
  status <> 'dropped'
  or (decline_reason is not null and btrim(decline_reason) <> '')
);

-- 5. the move-enforcement trigger guarded 'declined' parents; now 'dropped'.
--    A dropped branch is a tombstone and cannot grow children (§3.1); the rule
--    fires only when parent_id is (re)assigned, so editing an existing child of
--    a since-dropped branch still works.
create or replace function public.enforce_node_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur uuid := new.parent_id;
  steps int := 0;
begin
  while cur is not null loop
    if cur = new.id then
      raise exception 'cycle: a thought cannot be a descendant of itself';
    end if;
    select parent_id into cur from public.nodes where id = cur;
    steps := steps + 1;
    if steps > 100000 then
      raise exception 'parent chain too deep (possible pre-existing cycle)';
    end if;
  end loop;

  if new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if exists (select 1 from public.nodes where id = new.parent_id and status = 'dropped') then
      raise exception 'a dropped branch cannot grow children';
    end if;
  end if;

  return new;
end;
$$;
