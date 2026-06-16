-- Cross-link references (2026-06-13): a thought can ALSO appear under other
-- parents besides its single home parent_id. The tree backbone is unchanged —
-- node_links holds extra parent→child edges drawn as dashed connectors. This
-- keeps the tidy-tree layout intact (it still follows parent_id) while letting,
-- e.g., "Train focus" hang off both "Learn faster" and "Think better".
-- Applied to project htrvknxzunkqxcqsqxpm via MCP.

create table public.node_links (
  user_id    uuid not null default auth.uid() references auth.users(id),
  parent_id  uuid not null references public.nodes(id) on delete cascade,
  child_id   uuid not null references public.nodes(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (parent_id, child_id),
  constraint no_self_link check (parent_id <> child_id)
);

create index idx_node_links_user  on public.node_links (user_id);
create index idx_node_links_child on public.node_links (child_id);

alter table public.node_links enable row level security;

-- Both endpoints must be owned by the caller. parent_owned_by_caller (migration
-- 0001) is a generic "this node is mine" probe, reused here for child_id too.
create policy owner_select on public.node_links
  for select using (user_id = (select auth.uid()));

create policy owner_insert on public.node_links
  for insert with check (
    user_id = (select auth.uid())
    and public.parent_owned_by_caller(parent_id)
    and public.parent_owned_by_caller(child_id)
  );

create policy owner_delete on public.node_links
  for delete using (user_id = (select auth.uid()));
