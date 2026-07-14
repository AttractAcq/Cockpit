-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduled Publishing — scheduler install (HELD; run manually, in order, only
-- after the P1 migration is applied and process-scheduled-publishing is deployed).
-- This is NOT a migration and must NOT live under supabase/migrations/.
--
-- Decision: publication worker runs every 1 minute; batch 3; ~120s run budget;
-- atomic claim makes overlapping runs safe. Generation is NOT auto-scheduled.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0) Prerequisites (set the edge-function secret out-of-band, never in SQL):
--       supabase secrets set CRON_SECRET=<strong-random>   (or via dashboard)
--    The worker reads Deno.env.get('CRON_SECRET'); the header below must match it.

-- 1) Extensions (both are available on this project).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Store the SAME secret in Vault so the cron command never hardcodes it.
--    Run once; rotating means updating BOTH the edge secret and this Vault value.
--    select vault.create_secret('<same-value-as-CRON_SECRET>', 'CRON_SECRET');

-- 3) Schedule the per-minute publication worker. The secret is read from Vault at
--    call time, so it never appears in cron.job. timeout > the worker's 120s budget.
select cron.schedule(
  'publish-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://xivewedajschthjlblfb.supabase.co/functions/v1/process-scheduled-publishing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 130000
    );
  $cron$
);

-- ── Operations ───────────────────────────────────────────────────────────────
-- Pause (stop firing) without deleting:      update cron.job set active = false where jobname = 'publish-worker';
-- Resume:                                     update cron.job set active = true  where jobname = 'publish-worker';
-- Remove entirely:                            select cron.unschedule('publish-worker');
-- Inspect recent runs / failures:            select jobid, runid, status, return_message, start_time, end_time
--                                              from cron.job_run_details
--                                              where command like '%process-scheduled-publishing%'
--                                              order by start_time desc limit 30;
-- Inspect net responses (HTTP result):       select * from net._http_response order by created desc limit 30;
-- Confirm the worker's own result:           the function returns { processed, recovered, results[] } in the response body.

-- ── Generation worker (NOT scheduled in this slice) ──────────────────────────
-- Intentionally left unscheduled. To enable later (separate decision):
--   select cron.schedule('generation-worker','* * * * *', $g$ select net.http_post(
--     url := 'https://xivewedajschthjlblfb.supabase.co/functions/v1/process-asset-generation-jobs',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')),
--     body := '{}'::jsonb, timeout_milliseconds := 130000); $g$);
