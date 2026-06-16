-- Defense-in-depth before going public (2026-06-14): stop exposing two internal
-- functions as callable PostgREST RPCs, and document the unenforced pat.scopes
-- column. None of this changes app behavior — it only shrinks the public API
-- surface and clears Supabase security-advisor warnings.
--
-- Why these were exposed at all: Supabase ships an
--   ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated
-- so every new function in `public` is directly EXECUTE-grantable by anon and
-- authenticated (the same default that migration 0008 had to revoke from the
-- *_core functions). These two helpers slipped through.
--
-- Apply to project htrvknxzunkqxcqsqxpm via MCP.

-- 1. enforce_node_move() is a TRIGGER function. Triggers fire it regardless of the
--    invoking role's EXECUTE privilege, so revoking EXECUTE does NOT affect the
--    trigger — it only removes the pointless /rest/v1/rpc/enforce_node_move endpoint
--    (calling it directly would error on its NEW/TG_OP references anyway).
revoke execute on function public.enforce_node_move() from anon, authenticated, public;

-- 2. parent_owned_by_caller(uuid) is an internal ownership probe used INSIDE the
--    RLS policies on nodes/node_links (owner_insert / owner_update). Those policies
--    are evaluated as the `authenticated` role, so authenticated MUST keep EXECUTE.
--    anon never inserts/updates (its auth.uid() is null, so every such row fails the
--    user_id check before this helper matters), and the function leaks nothing to
--    anon regardless (it only ever checks rows where user_id = auth.uid() = null).
--    Revoke the stray anon grant; keep authenticated.
revoke execute on function public.parent_owned_by_caller(uuid) from anon;

-- 3. pat.scopes is reserved scaffolding, NOT an enforced control. No function reads
--    it; every PAT today has full owner access (resolve_pat_user only checks
--    revoked_at/expires_at). Document this so nobody later mints a "read-only" token
--    trusting this column to restrict it without first wiring enforcement into
--    resolve_pat_user / the *_via_pat wrappers. Comment only — no behavior change.
comment on column public.pat.scopes is
  'RESERVED / NOT ENFORCED. No function reads this; every PAT has full owner access. '
  'Do not mint a limited-scope token assuming this restricts it — wire enforcement '
  'into resolve_pat_user and the *_via_pat wrappers first.';
