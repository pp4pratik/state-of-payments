-- Geography (Statewise) has been fully moved to static JSON, read from
-- public/statewise-historical/ instead of Supabase (see useStatewiseAll in
-- src/lib/queries.ts, and fetch_npci_data.py's statewise handling). Nothing in the
-- app or the live fetcher reads or writes this table anymore - dropping it.
--
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> Run).
-- Irreversible: back up first if you want to keep a copy (Table Editor -> statewise ->
-- Export data, or `select * from public.statewise` and save the CSV).

drop table if exists public.statewise;
