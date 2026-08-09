-- Every table has been fully moved to static JSON under public/data/ (and
-- public/statewise-historical/ for Geography, dropped separately in
-- migration_004_drop_statewise.sql). Nothing in the app or either fetcher script
-- (fetch_npci_data.py, fetch_rbi_data.py) reads or writes Supabase anymore -
-- dropping every remaining table.
--
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> Run).
-- Irreversible: back up first if you want to keep a copy of any table (Table Editor
-- -> table -> Export data, or `select * from public.<table>` and save the CSV).

drop table if exists public.monthly_trend;
drop table if exists public.app_stats;
drop table if exists public.p2p_p2m;
drop table if exists public.merchant_categories;
drop table if exists public.circulars;
drop table if exists public.autopay_registrations;
drop table if exists public.autopay_executions;
drop table if exists public.autopay_registrations_by_bank;
drop table if exists public.autopay_executions_by_psp;
drop table if exists public.psp_member_performance;
drop table if exists public.rbi_cards;
drop table if exists public.rbi_payments;
