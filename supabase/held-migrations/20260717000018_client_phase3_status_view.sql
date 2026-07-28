-- Increment 1: deterministic Phase 3 client status read model.
--
-- HELD FOR REVIEW — do not apply in this increment.
--
-- This view intentionally uses existing authoritative tables only. It does not
-- create a new operational run ledger. Active scoped runs win when present;
-- latest scoped run evidence is considered next; legacy full-month status is
-- derived conservatively from current-month master/calendar outputs. The view
-- does not use activity_log, so historic activity rows cannot mark current
-- clients failed.

CREATE OR REPLACE VIEW public.client_phase3_status_v
WITH (security_invoker = true) AS
WITH months AS (
  SELECT
    to_char(timezone('UTC', now())::date, 'YYYY-MM') AS execution_month,
    date_trunc('month', timezone('UTC', now())::date)::date AS month_start,
    (date_trunc('month', timezone('UTC', now())::date) + interval '1 month - 1 day')::date AS month_end
),
expected_counts AS (
  SELECT
    execution_month,
    month_start,
    month_end,
    32::bigint AS expected_organic,
    28::bigint AS expected_story,
    4::bigint AS expected_ads,
    (
      32 + 28
      + (least(14, extract(day from month_end)::int) - 1 + 1)
      + (least(21, extract(day from month_end)::int) - least(8, extract(day from month_end)::int) + 1)
      + (extract(day from month_end)::int - least(15, extract(day from month_end)::int) + 1)
      + (extract(day from month_end)::int - least(22, extract(day from month_end)::int) + 1)
    )::bigint AS expected_calendar
  FROM months
),
master_counts AS (
  SELECT c.id AS client_id, e.execution_month,
    e.expected_organic,
    e.expected_story,
    e.expected_ads,
    e.expected_calendar,
    count(DISTINCT o.id) AS organic_count,
    count(DISTINCT o.id) FILTER (WHERE o.review_state = 'approved') AS organic_approved,
    count(DISTINCT s.id) AS story_count,
    count(DISTINCT s.id) FILTER (WHERE s.review_state = 'approved') AS story_approved,
    count(DISTINCT a.id) AS ads_count,
    count(DISTINCT a.id) FILTER (WHERE a.review_state = 'approved') AS ads_approved,
    count(DISTINCT cal.id) AS calendar_count,
    count(DISTINCT cal.id) FILTER (WHERE cal.review_state = 'approved') AS calendar_approved
  FROM public.clients c
  CROSS JOIN expected_counts e
  LEFT JOIN public.organic_master o ON o.client_id = c.id AND o.month = e.execution_month
  LEFT JOIN public.story_master s ON s.client_id = c.id AND s.month = e.execution_month
  LEFT JOIN public.ads_master a ON a.client_id = c.id AND a.month = e.execution_month
  LEFT JOIN public.calendar_cells cal ON cal.client_id = c.id AND cal.month = e.execution_month
  GROUP BY c.id, e.execution_month, e.expected_organic, e.expected_story, e.expected_ads, e.expected_calendar
),
active_scoped AS (
  SELECT DISTINCT ON (r.client_id) r.*
  FROM public.client_phase3_scoped_runs r
  JOIN expected_counts e ON r.start_date <= e.month_end AND r.end_date >= e.month_start
  WHERE r.status IN ('planned','generating')
  ORDER BY r.client_id, r.created_at DESC
),
latest_scoped AS (
  SELECT DISTINCT ON (r.client_id) r.*
  FROM public.client_phase3_scoped_runs r
  JOIN expected_counts e ON r.start_date <= e.month_end AND r.end_date >= e.month_start
  ORDER BY r.client_id, r.created_at DESC
)
SELECT
  mc.client_id,
  mc.execution_month,
  CASE
    WHEN active.id IS NOT NULL THEN 'in_progress'
    WHEN ls.status = 'failed' THEN 'failed'
    WHEN ls.status IN ('partial','cancelled')
      OR coalesce(ls.conflicted_count, 0) > 0
      OR coalesce(ls.skipped_count, 0) > 0
      OR coalesce(ls.created_count, 0) < coalesce(ls.total_slots, 0) THEN 'partial'
    WHEN ls.status = 'complete' AND coalesce(ls.created_count, 0) > 0 THEN
      CASE
        WHEN mc.organic_count = mc.expected_organic
          AND mc.story_count = mc.expected_story
          AND mc.ads_count = mc.expected_ads
          AND mc.calendar_count = mc.expected_calendar
          AND mc.organic_approved = mc.organic_count
          AND mc.story_approved = mc.story_count
          AND mc.ads_approved = mc.ads_count
          AND mc.calendar_approved = mc.calendar_count THEN 'complete'
        ELSE 'needs_review'
      END
    WHEN mc.organic_count = mc.expected_organic
      AND mc.story_count = mc.expected_story
      AND mc.ads_count = mc.expected_ads
      AND mc.calendar_count = mc.expected_calendar
      AND mc.organic_approved = mc.organic_count
      AND mc.story_approved = mc.story_count
      AND mc.ads_approved = mc.ads_count
      AND mc.calendar_approved = mc.calendar_count THEN 'complete'
    WHEN mc.organic_count = mc.expected_organic
      AND mc.story_count = mc.expected_story
      AND mc.ads_count = mc.expected_ads
      AND mc.calendar_count = mc.expected_calendar THEN 'needs_review'
    WHEN mc.organic_count + mc.story_count + mc.ads_count + mc.calendar_count > 0 THEN 'partial'
    ELSE 'not_started'
  END AS status
FROM master_counts mc
LEFT JOIN active_scoped active ON active.client_id = mc.client_id
LEFT JOIN latest_scoped ls ON ls.client_id = mc.client_id;

REVOKE ALL ON TABLE public.client_phase3_status_v FROM PUBLIC;
REVOKE ALL ON TABLE public.client_phase3_status_v FROM anon;
GRANT SELECT ON TABLE public.client_phase3_status_v TO authenticated;
