-- Reparenting/reordering ships via drag-and-drop (D11 amended 2026-06-13): the
-- app now changes parent_id, so the RLS boundary must reject the two illegal
-- moves server-side too — the client guard (computeMove) is not the only barrier
-- (a stale tab, a second device, or a hand-issued PostgREST call must not be able
-- to write a cycle or attach to a declined branch).
--   1. cycles — a thought cannot become a descendant of itself
--   2. attaching to a declined branch (a tombstone can't grow children, §3.1)
-- The declined rule fires only when parent_id is (re)assigned, so editing an
-- existing child of a since-declined branch still works.
-- Applied to project htrvknxzunkqxcqsqxpm via MCP.

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
    if exists (select 1 from public.nodes where id = new.parent_id and status = 'declined') then
      raise exception 'a declined branch cannot grow children';
    end if;
  end if;

  return new;
end;
$$;

create trigger nodes_enforce_move
  before insert or update of parent_id on public.nodes
  for each row execute function public.enforce_node_move();
