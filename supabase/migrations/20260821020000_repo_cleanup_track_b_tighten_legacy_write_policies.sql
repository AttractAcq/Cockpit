-- Repo cleanup Track B — tighten the v1_foundation.sql direct-authenticated-write
-- RLS exception to match the codebase's stated "writes go through edge functions"
-- convention (CLAUDE.md, docs/operations/architecture-guide.md), for tables that
-- traced to have zero live direct-write callers left.
--
-- Full dependency trace performed before writing this migration (not guessed):
-- grepped src/ for every `supabase.from("<table>").insert|update|delete|upsert(`
-- call against each of the 23 tables 20260702074337_v1_foundation.sql granted
-- direct authenticated INSERT/UPDATE/DELETE to. 19 of the 23 have zero live
-- callers today -- these were unused, dead grants, safe to drop. The other 4
-- (clients, calendar_cells, client_execution_files, activity_log) have real,
-- current frontend code writing to them directly and are deliberately left
-- untouched here -- tightening those requires either a new edge function/RPC
-- to replace the direct write first, or an explicit decision to accept them
-- as intentional legacy scope. That's separate, follow-up work, not folded
-- into this migration.
--
-- Dropping only the authenticated-role write policies, not the SELECT
-- policies (reads under RLS stay exactly as they are) -- service_role
-- (every edge function via svc() in _shared/aa.ts) bypasses RLS by default
-- and needs no new policy to keep writing to these tables.

-- CLIENT INPUTS
DROP POLICY IF EXISTS "client_inputs_insert" ON public.client_inputs;
DROP POLICY IF EXISTS "client_inputs_update" ON public.client_inputs;

-- QUALIFICATION CONFIGS
DROP POLICY IF EXISTS "qual_configs_insert" ON public.qualification_configs;
DROP POLICY IF EXISTS "qual_configs_update" ON public.qualification_configs;

-- CONTEXT FILES
DROP POLICY IF EXISTS "ccf_insert" ON public.client_context_files;
DROP POLICY IF EXISTS "ccf_update" ON public.client_context_files;

-- MASTER TABLES
DROP POLICY IF EXISTS "om_ins" ON public.organic_master;
DROP POLICY IF EXISTS "om_upd" ON public.organic_master;
DROP POLICY IF EXISTS "om_del" ON public.organic_master;

DROP POLICY IF EXISTS "sm_ins" ON public.story_master;
DROP POLICY IF EXISTS "sm_upd" ON public.story_master;
DROP POLICY IF EXISTS "sm_del" ON public.story_master;

DROP POLICY IF EXISTS "am_ins" ON public.ads_master;
DROP POLICY IF EXISTS "am_upd" ON public.ads_master;
DROP POLICY IF EXISTS "am_del" ON public.ads_master;

DROP POLICY IF EXISTS "ac_ins" ON public.ad_creative;
DROP POLICY IF EXISTS "ac_upd" ON public.ad_creative;

DROP POLICY IF EXISTS "pm_ins" ON public.proof_master;
DROP POLICY IF EXISTS "pm_upd" ON public.proof_master;

DROP POLICY IF EXISTS "asm_ins" ON public.asset_master;
DROP POLICY IF EXISTS "asm_upd" ON public.asset_master;

DROP POLICY IF EXISTS "lmm_ins" ON public.lead_magnet_master;
DROP POLICY IF EXISTS "lmm_upd" ON public.lead_magnet_master;

DROP POLICY IF EXISTS "wm_ins" ON public.website_master;
DROP POLICY IF EXISTS "wm_upd" ON public.website_master;

DROP POLICY IF EXISTS "sl_ins" ON public.sops_laws;
DROP POLICY IF EXISTS "sl_upd" ON public.sops_laws;

DROP POLICY IF EXISTS "ws_ins" ON public.weekly_sequence;
DROP POLICY IF EXISTS "ws_upd" ON public.weekly_sequence;

DROP POLICY IF EXISTS "abi_ins" ON public.asset_brief_index;
DROP POLICY IF EXISTS "abi_upd" ON public.asset_brief_index;

-- PIPELINE
DROP POLICY IF EXISTS "pmd_ins" ON public.pipeline_metrics_daily;
DROP POLICY IF EXISTS "pmd_upd" ON public.pipeline_metrics_daily;

-- PLAYBOOK RUNS
DROP POLICY IF EXISTS "pbr_ins" ON public.playbook_runs;
DROP POLICY IF EXISTS "pbr_upd" ON public.playbook_runs;

-- AUTOMATIONS
DROP POLICY IF EXISTS "auto_ins" ON public.automations;
DROP POLICY IF EXISTS "auto_upd" ON public.automations;

-- AUTOMATION RUNS
DROP POLICY IF EXISTS "ar_ins" ON public.automation_runs;

-- REF COUNTERS
DROP POLICY IF EXISTS "rc_ins" ON public.ref_counters;
DROP POLICY IF EXISTS "rc_upd" ON public.ref_counters;

-- Deliberately NOT touched in this migration (real, live, direct frontend
-- writes traced to each -- see header):
--   clients               (src/lib/operations-admin.ts:109)
--   calendar_cells        (src/lib/api.ts:838, 850, 866)
--   client_execution_files (src/lib/api.ts:614)
--   activity_log          (src/lib/api.ts:313)
