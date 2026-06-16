-- Security fix (2026-06-14): lock down the privileged chain "core" function.
--
-- create_chain_core(p_user_id uuid, p_payload jsonb) is SECURITY DEFINER (so it
-- bypasses RLS) AND takes the user id as a plain argument. Any role that can
-- EXECUTE it can therefore write a chain into ANY user's account by passing that
-- user's id — the entire "user_id is decided inside Postgres, never trusted from
-- the client" spine is bypassable.
--
-- Migration 0007 did `revoke all on function ... from public`, but on Supabase
-- that is NOT enough: Supabase ships an `ALTER DEFAULT PRIVILEGES ... GRANT
-- EXECUTE ON FUNCTIONS TO anon, authenticated`, so every new function in `public`
-- is granted EXECUTE *directly* to the anon and authenticated roles. Revoking
-- from the `public` pseudo-role does not remove those direct grants. The fix is
-- to revoke from anon/authenticated explicitly.
--
-- This does NOT break the legitimate entry points: create_chain_via_pat and
-- create_chain are themselves SECURITY DEFINER and call the core *as the function
-- owner* (postgres), not as the original (anon/authenticated) caller — Postgres
-- checks EXECUTE on a nested call against the current SECURITY DEFINER context, so
-- the delegation keeps working with the core locked to its owner only.
--
-- Apply to project htrvknxzunkqxcqsqxpm via MCP.

revoke execute on function public.create_chain_core(uuid, jsonb) from anon, authenticated, public;

-- create_chain(jsonb) resolves identity via auth.uid(), so the stray anon grant is
-- harmless in practice (anon's auth.uid() is null -> it raises 'not authenticated');
-- tighten it to authenticated-only anyway. create_chain_via_pat MUST stay callable
-- by anon — that is the publishable-key path the Worker uses.
revoke execute on function public.create_chain(jsonb) from anon, public;
