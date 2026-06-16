-- D1 amended 2026-06-13 (owner request): drop 'accepted' and 'parked'.
-- The model collapses to open|declined — a thought is either live (can grow
-- children) or dead (needs a reason, struck through). accepted/parked were the
-- softer middle states; the product's edge is the open/declined split.
-- Applied to project htrvknxzunkqxcqsqxpm via MCP.

update public.nodes
set status = 'open', status_changed_at = now()
where status in ('accepted', 'parked');

alter table public.nodes drop constraint nodes_status_check;
alter table public.nodes add constraint nodes_status_check
  check (status in ('open', 'declined'));
