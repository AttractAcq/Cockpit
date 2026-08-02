


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "extensions";


ALTER SCHEMA "extensions" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."ad_status" AS ENUM (
    'planned',
    'building',
    'live',
    'paused',
    'done',
    'killed',
    'deferred'
);


ALTER TYPE "public"."ad_status" OWNER TO "postgres";


CREATE TYPE "public"."automation_run_status" AS ENUM (
    'running',
    'success',
    'error',
    'cancelled'
);


ALTER TYPE "public"."automation_run_status" OWNER TO "postgres";


CREATE TYPE "public"."automation_type" AS ENUM (
    'marketing_intelligence',
    'creative_intelligence',
    'story_intelligence',
    'distribution',
    'opportunity_detector',
    'ai_receptionist'
);


ALTER TYPE "public"."automation_type" OWNER TO "postgres";


CREATE TYPE "public"."calendar_row_type" AS ENUM (
    'ad1',
    'ad2',
    'ad3',
    'reel',
    'stories',
    'feed_posts',
    'carousels'
);


ALTER TYPE "public"."calendar_row_type" OWNER TO "postgres";


CREATE TYPE "public"."client_status" AS ENUM (
    'prospect',
    'active',
    'paused',
    'churned'
);


ALTER TYPE "public"."client_status" OWNER TO "postgres";


CREATE TYPE "public"."context_file_status" AS ENUM (
    'not_started',
    'generating',
    'generated',
    'needs_review',
    'approved',
    'needs_client_input'
);


ALTER TYPE "public"."context_file_status" OWNER TO "postgres";


CREATE TYPE "public"."integration_status" AS ENUM (
    'not_configured',
    'configured',
    'error'
);


ALTER TYPE "public"."integration_status" OWNER TO "postgres";


CREATE TYPE "public"."organic_status" AS ENUM (
    'idea',
    'briefed',
    'filming',
    'editing',
    'scheduled',
    'live',
    'repurposed',
    'killed'
);


ALTER TYPE "public"."organic_status" OWNER TO "postgres";


CREATE TYPE "public"."package_tier" AS ENUM (
    'proof_sprint',
    'proof_brand',
    'proof_brand_scale'
);


ALTER TYPE "public"."package_tier" OWNER TO "postgres";


CREATE TYPE "public"."pipeline_source" AS ENUM (
    'manual',
    'api',
    'ai_assisted'
);


ALTER TYPE "public"."pipeline_source" OWNER TO "postgres";


CREATE TYPE "public"."playbook_run_status" AS ENUM (
    'running',
    'proposed',
    'approved',
    'rejected',
    'error'
);


ALTER TYPE "public"."playbook_run_status" OWNER TO "postgres";


CREATE TYPE "public"."production_status" AS ENUM (
    'not_started',
    'brief_ready',
    'in_production',
    'in_review',
    'approved',
    'delivered',
    'killed'
);


ALTER TYPE "public"."production_status" OWNER TO "postgres";


CREATE TYPE "public"."proof_status" AS ENUM (
    'missing',
    'requested',
    'captured',
    'verified',
    'approved',
    'in_use',
    'archived'
);


ALTER TYPE "public"."proof_status" OWNER TO "postgres";


CREATE TYPE "public"."review_state" AS ENUM (
    'needs_review',
    'approved',
    'rejected',
    'archived'
);


ALTER TYPE "public"."review_state" OWNER TO "postgres";


CREATE TYPE "public"."source_ref_type" AS ENUM (
    'organic',
    'story',
    'ad',
    'sales',
    'design',
    'lead_magnet',
    'website'
);


ALTER TYPE "public"."source_ref_type" OWNER TO "postgres";


CREATE TYPE "public"."stage_status" AS ENUM (
    'not_run',
    'running',
    'complete',
    'error'
);


ALTER TYPE "public"."stage_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'account_manager',
    'editor',
    'client'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "extensions"."grant_pg_cron_access"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


ALTER FUNCTION "extensions"."grant_pg_cron_access"() OWNER TO "supabase_admin";


COMMENT ON FUNCTION "extensions"."grant_pg_cron_access"() IS 'Grants access to pg_cron';



CREATE OR REPLACE FUNCTION "extensions"."grant_pg_graphql_access"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $_$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


ALTER FUNCTION "extensions"."grant_pg_graphql_access"() OWNER TO "supabase_admin";


COMMENT ON FUNCTION "extensions"."grant_pg_graphql_access"() IS 'Grants access to pg_graphql';



CREATE OR REPLACE FUNCTION "extensions"."grant_pg_net_access"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION "extensions"."grant_pg_net_access"() OWNER TO "supabase_admin";


COMMENT ON FUNCTION "extensions"."grant_pg_net_access"() IS 'Grants access to pg_net';



CREATE OR REPLACE FUNCTION "extensions"."pgrst_ddl_watch"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION "extensions"."pgrst_ddl_watch"() OWNER TO "supabase_admin";


CREATE OR REPLACE FUNCTION "extensions"."pgrst_drop_watch"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION "extensions"."pgrst_drop_watch"() OWNER TO "supabase_admin";


CREATE OR REPLACE FUNCTION "extensions"."set_graphql_placeholder"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


ALTER FUNCTION "extensions"."set_graphql_placeholder"() OWNER TO "supabase_admin";


COMMENT ON FUNCTION "extensions"."set_graphql_placeholder"() IS 'Reintroduces placeholder function for graphql_public.graphql';



CREATE OR REPLACE FUNCTION "public"."_log_distribution_transition"("p_client_id" "uuid", "p_source_ref" "text", "p_record_id" "uuid", "p_action" "text", "p_prev" "text", "p_new" "text", "p_detail" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  begin
    insert into public.activity_log (client_id, event_type, plain_english_message, metadata)
    values (p_client_id, 'distribution_' || p_action,
      coalesce(p_source_ref, '?') || ': ' || p_action || ' (' || coalesce(p_prev, '?') || ' → ' || coalesce(p_new, '?') || ')',
      jsonb_build_object('record_id', p_record_id, 'action', p_action, 'previous_status', p_prev, 'new_status', p_new,
        'operator_user_id', auth.uid(), 'operator_role', public.auth_role(), 'detail', p_detail, 'at', now()));
  exception when others then null;
  end;
end; $$;


ALTER FUNCTION "public"."_log_distribution_transition"("p_client_id" "uuid", "p_source_ref" "text", "p_record_id" "uuid", "p_action" "text", "p_prev" "text", "p_new" "text", "p_detail" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."client_asset_group_completeness_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "asset_group_ref" "text" NOT NULL,
    "generation_job_id" "uuid" NOT NULL,
    "production_brief_id" "uuid",
    "original_expected_count" integer NOT NULL,
    "actual_count_at_acceptance" integer NOT NULL,
    "accepted_output_count" integer NOT NULL,
    "accepted_sequence_indexes" integer[] NOT NULL,
    "missing_sequence_indexes" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "override_reason" "text" NOT NULL,
    "overridden_by" "uuid" NOT NULL,
    "overridden_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_job_status" "text" NOT NULL,
    "source_job_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    "revoked_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_asset_group_completenes_actual_count_at_acceptance_check" CHECK (("actual_count_at_acceptance" > 0)),
    CONSTRAINT "client_asset_group_completeness_o_original_expected_count_check" CHECK (("original_expected_count" > 0)),
    CONSTRAINT "client_asset_group_completeness_ove_accepted_output_count_check" CHECK (("accepted_output_count" > 0)),
    CONSTRAINT "client_asset_group_completeness_override_seq_nonempty" CHECK (("array_length"("accepted_sequence_indexes", 1) IS NOT NULL)),
    CONSTRAINT "client_asset_group_completeness_overrides_override_reason_check" CHECK (("length"(TRIM(BOTH FROM "override_reason")) >= 8))
);


ALTER TABLE "public"."client_asset_group_completeness_overrides" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_partial_asset_group"("p_asset_group_ref" "text", "p_generation_job_id" "uuid", "p_reason" "text", "p_accepted_sequence_indexes" integer[] DEFAULT NULL::integer[]) RETURNS "public"."client_asset_group_completeness_overrides"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user uuid := auth.uid();
  v_role text := public.auth_role();
  v_job public.client_asset_generation_jobs;
  v_expected integer;
  v_actual integer;
  v_accepted integer[];
  v_missing integer[];
  v_duplicate_count integer;
  v_cancelled integer := 0;
  v_override public.client_asset_group_completeness_overrides;
  v_current_sequence integer[];
begin
  if v_user is null then raise exception 'AUTH: login required'; end if;
  if coalesce(v_role, '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if nullif(trim(p_asset_group_ref), '') is null then raise exception 'asset_group_ref is required'; end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) < 8 then raise exception 'A reason of at least 8 characters is required'; end if;

  select * into v_job
  from public.client_asset_generation_jobs
  where id = p_generation_job_id
  for update;

  if not found then raise exception 'generation job not found'; end if;
  if v_job.asset_group_ref <> p_asset_group_ref then raise exception 'job/group mismatch'; end if;
  if v_job.closed_at is not null or v_job.accepted_partial then raise exception 'generation job is already closed'; end if;
  if exists (
    select 1 from public.client_distribution_records d
    where d.client_id = v_job.client_id
      and d.asset_group_ref = p_asset_group_ref
      and d.publish_status in ('ready','scheduled','publishing','published','needs_reconciliation')
  ) then raise exception 'asset group has a publication conflict'; end if;

  perform 1
  from public.client_asset_generation_items i
  where i.generation_job_id = v_job.id
  for update;

  perform 1
  from public.client_assets a
  where a.client_id = v_job.client_id
    and a.production_brief_id = v_job.production_brief_id
    and a.asset_group_ref = p_asset_group_ref
    and coalesce(a.is_current, true)
  for update;

  perform 1
  from public.client_asset_group_completeness_overrides o
  where o.client_id = v_job.client_id and o.asset_group_ref = p_asset_group_ref and o.is_active and o.revoked_at is null
  for update;
  if found then raise exception 'an active partial acceptance already exists for this group'; end if;

  select count(*)::int into v_actual
  from public.client_assets a
  where a.client_id = v_job.client_id
    and a.production_brief_id = v_job.production_brief_id
    and a.asset_group_ref = p_asset_group_ref
    and coalesce(a.is_current, true)
    and a.status not in ('archived','rejected');

  if v_actual < 1 then raise exception 'cannot accept a partial group with no current assets'; end if;
  if v_actual >= v_job.expected_output_count then raise exception 'asset group is already complete'; end if;
  if exists (
    select 1 from public.client_assets a
    where a.client_id = v_job.client_id
      and a.production_brief_id = v_job.production_brief_id
      and a.asset_group_ref = p_asset_group_ref
      and coalesce(a.is_current, true)
      and a.status = 'approved'
  ) then raise exception 'approved group cannot be partially accepted'; end if;

  select count(*)::int into v_duplicate_count
  from (
    select a.sequence_index
    from public.client_assets a
    where a.client_id = v_job.client_id
      and a.production_brief_id = v_job.production_brief_id
      and a.asset_group_ref = p_asset_group_ref
      and coalesce(a.is_current, true)
      and a.status not in ('archived','rejected')
    group by a.sequence_index
    having count(*) > 1
  ) dup;
  if v_duplicate_count > 0 then raise exception 'duplicate current frame state blocks partial acceptance'; end if;

  select array_agg(a.sequence_index order by a.sequence_index) into v_current_sequence
  from public.client_assets a
  where a.client_id = v_job.client_id
    and a.production_brief_id = v_job.production_brief_id
    and a.asset_group_ref = p_asset_group_ref
    and coalesce(a.is_current, true)
    and a.status not in ('archived','rejected');

  select array_agg(seq order by seq) into v_accepted
  from unnest(coalesce(p_accepted_sequence_indexes, '{}')) seq;

  if array_length(v_accepted, 1) is null then raise exception 'accepted sequence cannot be empty'; end if;
  if array_length(v_accepted, 1) <> (select count(distinct seq)::int from unnest(v_accepted) seq) then
    raise exception 'accepted sequence contains duplicates or invalid indexes';
  end if;
  if v_accepted <> v_current_sequence then
    raise exception 'STALE_ASSET_GROUP: asset group changed while under review';
  end if;

  v_expected := v_job.expected_output_count;
  select coalesce(array_agg(n order by n), '{}') into v_missing
  from generate_series(1, v_expected) n
  where not (n = any(v_accepted));

  with cancelled as (
    update public.client_asset_generation_items
    set status = 'cancelled', last_error = null, updated_at = now()
    where generation_job_id = v_job.id and status in ('queued','processing')
    returning id
  )
  select count(*)::int into v_cancelled from cancelled;

  update public.client_asset_generation_jobs
  set status = 'partial',
      closed_at = now(),
      closed_by = v_user,
      closure_reason = trim(p_reason),
      closure_type = 'partial_accepted',
      accepted_partial = true,
      accepted_output_count = array_length(v_accepted, 1),
      accepted_sequence_indexes = v_accepted,
      completed_output_count = v_actual,
      updated_at = now()
  where id = v_job.id;

  insert into public.client_asset_group_completeness_overrides (
    client_id, asset_group_ref, generation_job_id, production_brief_id,
    original_expected_count, actual_count_at_acceptance, accepted_output_count,
    accepted_sequence_indexes, missing_sequence_indexes, override_reason,
    overridden_by, overridden_at, source_job_status, source_job_snapshot
  ) values (
    v_job.client_id, p_asset_group_ref, v_job.id, v_job.production_brief_id,
    v_expected, v_actual, array_length(v_accepted, 1),
    v_accepted, v_missing, trim(p_reason),
    v_user, now(), v_job.status,
    to_jsonb(v_job) || jsonb_build_object('cancelled_item_count', v_cancelled)
  )
  returning * into v_override;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    v_job.client_id,
    'asset_group_partial_accepted',
    p_asset_group_ref || ' accepted as partial: ' || array_length(v_accepted, 1)::text || ' of ' || v_expected::text || ' frames.',
    'client_asset_generation_job',
    v_job.id,
    jsonb_build_object(
      'client_id', v_job.client_id,
      'asset_group_ref', p_asset_group_ref,
      'generation_job_id', v_job.id,
      'production_brief_id', v_job.production_brief_id,
      'source_ref', v_job.source_ref,
      'original_expected_count', v_expected,
      'actual_count', v_actual,
      'accepted_output_count', array_length(v_accepted, 1),
      'accepted_sequence_indexes', v_accepted,
      'missing_sequence_indexes', v_missing,
      'operator_user_id', v_user,
      'operator_role', v_role,
      'reason', trim(p_reason),
      'cancelled_item_count', v_cancelled,
      'target_type', 'asset_group',
      'target_id', p_asset_group_ref,
      'route_tab', 'assets'
    )
  );

  if v_cancelled > 0 then
    insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
    values (
      v_job.client_id,
      'asset_generation_items_cancelled',
      v_cancelled::text || ' unfinished generation item' || case when v_cancelled = 1 then '' else 's' end || ' cancelled for ' || p_asset_group_ref || '.',
      'client_asset_generation_job',
      v_job.id,
      jsonb_build_object(
        'client_id', v_job.client_id,
        'asset_group_ref', p_asset_group_ref,
        'generation_job_id', v_job.id,
        'production_brief_id', v_job.production_brief_id,
        'source_ref', v_job.source_ref,
        'cancelled_item_count', v_cancelled,
        'target_type', 'asset_group',
        'target_id', p_asset_group_ref,
        'route_tab', 'assets'
      )
    );
  end if;

  return v_override;
end $$;


ALTER FUNCTION "public"."accept_partial_asset_group"("p_asset_group_ref" "text", "p_generation_job_id" "uuid", "p_reason" "text", "p_accepted_sequence_indexes" integer[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_asset_group_warning_acknowledgements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "asset_group_ref" "text" NOT NULL,
    "warning_code" "text" NOT NULL,
    "warning_fingerprint" "text" NOT NULL,
    "dismissed_by" "uuid" NOT NULL,
    "dismissed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_asset_group_warning_acknowledg_warning_fingerprint_check" CHECK (("length"(TRIM(BOTH FROM "warning_fingerprint")) > 0)),
    CONSTRAINT "client_asset_group_warning_acknowledgements_warning_code_check" CHECK (("length"(TRIM(BOTH FROM "warning_code")) > 0))
);


ALTER TABLE "public"."client_asset_group_warning_acknowledgements" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acknowledge_asset_group_warning"("p_asset_group_ref" "text", "p_warning_code" "text", "p_warning_fingerprint" "text") RETURNS "public"."client_asset_group_warning_acknowledgements"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user uuid := auth.uid();
  v_role text := public.auth_role();
  v_client_id uuid;
  v_ack public.client_asset_group_warning_acknowledgements;
begin
  if v_user is null then raise exception 'AUTH: login required'; end if;
  if coalesce(v_role, '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if nullif(trim(p_asset_group_ref), '') is null then raise exception 'asset_group_ref is required'; end if;
  if nullif(trim(p_warning_code), '') is null then raise exception 'warning_code is required'; end if;
  if nullif(trim(p_warning_fingerprint), '') is null then raise exception 'warning_fingerprint is required'; end if;

  select a.client_id into v_client_id
  from public.client_assets a
  where a.asset_group_ref = p_asset_group_ref
  order by a.created_at desc
  limit 1;

  if v_client_id is null then
    select j.client_id into v_client_id
    from public.client_asset_generation_jobs j
    where j.asset_group_ref = p_asset_group_ref
    order by j.created_at desc
    limit 1;
  end if;

  if v_client_id is null then raise exception 'asset group not found'; end if;

  insert into public.client_asset_group_warning_acknowledgements
    (client_id, asset_group_ref, warning_code, warning_fingerprint, dismissed_by, dismissed_at)
  values
    (v_client_id, p_asset_group_ref, p_warning_code, p_warning_fingerprint, v_user, now())
  on conflict (client_id, asset_group_ref, warning_code, warning_fingerprint)
  do update set dismissed_by = excluded.dismissed_by, dismissed_at = excluded.dismissed_at
  returning * into v_ack;

  insert into public.activity_log (client_id, event_type, plain_english_message, metadata)
  values (
    v_client_id,
    'asset_group_warning_dismissed',
    p_asset_group_ref || ' warning dismissed: ' || p_warning_code || '.',
    jsonb_build_object(
      'client_id', v_client_id,
      'asset_group_ref', p_asset_group_ref,
      'warning_code', p_warning_code,
      'warning_fingerprint', p_warning_fingerprint,
      'operator_user_id', v_user,
      'operator_role', v_role,
      'target_type', 'asset_group',
      'target_id', p_asset_group_ref,
      'route_tab', 'assets'
    )
  );

  return v_ack;
end $$;


ALTER FUNCTION "public"."acknowledge_asset_group_warning"("p_asset_group_ref" "text", "p_warning_code" "text", "p_warning_fingerprint" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "production_brief_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_format" "text" NOT NULL,
    "asset_group_ref" "text" NOT NULL,
    "sequence_index" integer DEFAULT 1 NOT NULL,
    "title" "text",
    "storage_bucket" "text" DEFAULT 'client-assets'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" DEFAULT 'image/png'::"text" NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "status" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "generation_provider" "text" NOT NULL,
    "generation_model" "text" NOT NULL,
    "prompt_md" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "is_current" boolean DEFAULT true NOT NULL,
    "regen_started_at" timestamp with time zone,
    CONSTRAINT "client_assets_asset_format_check" CHECK (("asset_format" = ANY (ARRAY['ad_static'::"text", 'reel_video'::"text", 'story_sequence'::"text", 'carousel'::"text", 'feed_post'::"text"]))),
    CONSTRAINT "client_assets_height_check" CHECK (("height" > 0)),
    CONSTRAINT "client_assets_mime_type_check" CHECK (("mime_type" = ANY (ARRAY['image/png'::"text", 'image/jpeg'::"text", 'image/webp'::"text", 'video/mp4'::"text"]))),
    CONSTRAINT "client_assets_prompt_md_check" CHECK (("length"(TRIM(BOTH FROM "prompt_md")) > 0)),
    CONSTRAINT "client_assets_sequence_index_check" CHECK (("sequence_index" > 0)),
    CONSTRAINT "client_assets_storage_bucket_check" CHECK (("storage_bucket" = ANY (ARRAY['client-assets'::"text", 'video-assets'::"text"]))),
    CONSTRAINT "client_assets_version_check" CHECK (("version" > 0)),
    CONSTRAINT "client_assets_width_check" CHECK (("width" > 0))
);


ALTER TABLE "public"."client_assets" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_asset_version"("p_asset_id" "uuid") RETURNS SETOF "public"."client_assets"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_brief uuid; v_group text; v_seq integer;
BEGIN
  SELECT production_brief_id, asset_group_ref, sequence_index
    INTO v_brief, v_group, v_seq
  FROM public.client_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'asset % not found', p_asset_id; END IF;

  UPDATE public.client_assets
    SET is_current = false, updated_at = now()
  WHERE production_brief_id = v_brief AND asset_group_ref = v_group
    AND sequence_index = v_seq AND id <> p_asset_id AND is_current;

  UPDATE public.client_assets
    SET is_current = true, updated_at = now()
  WHERE id = p_asset_id;

  RETURN QUERY SELECT * FROM public.client_assets WHERE id = p_asset_id;
END;
$$;


ALTER FUNCTION "public"."activate_asset_version"("p_asset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."allocate_phase3_ref"("p_client_id" "uuid", "p_planned_date" "date", "p_type_code" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_month text := to_char(p_planned_date, 'YYYY-MM');
  v_prefix text := upper(to_char(p_planned_date, 'Mon')) || to_char(p_planned_date, 'DD');
  v_pat text := '-' || p_type_code || '-([0-9]+)$';
  v_max int := 0;
  v_master int := 0;
  v_reserved int := 0;
BEGIN
  IF p_type_code NOT IN ('FP','CR','RL','ST','AD') THEN
    RAISE EXCEPTION 'invalid type_code %', p_type_code;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_client_id::text || ':' || v_month || ':' || p_type_code)::bigint);

  IF p_type_code IN ('FP','CR','RL') THEN
    SELECT coalesce(max((substring(ref from v_pat))::int), 0) INTO v_master
    FROM public.organic_master WHERE client_id = p_client_id AND month = v_month AND ref ~ v_pat;
  ELSIF p_type_code = 'ST' THEN
    SELECT coalesce(max((substring(ref from v_pat))::int), 0) INTO v_master
    FROM public.story_master WHERE client_id = p_client_id AND month = v_month AND ref ~ v_pat;
  ELSE
    SELECT coalesce(max((substring(ref from v_pat))::int), 0) INTO v_master
    FROM public.ads_master WHERE client_id = p_client_id AND month = v_month AND ref ~ v_pat;
  END IF;

  SELECT coalesce(max((substring(i.planned_ref from v_pat))::int), 0) INTO v_reserved
  FROM public.client_phase3_scope_items i
  WHERE i.execution_month = v_month AND i.planned_ref ~ v_pat
    AND i.run_id IN (SELECT id FROM public.client_phase3_scoped_runs WHERE client_id = p_client_id);

  v_max := greatest(v_master, v_reserved);
  RETURN v_prefix || '-' || p_type_code || '-' || lpad((v_max + 1)::text, 3, '0');
END;
$_$;


ALTER FUNCTION "public"."allocate_phase3_ref"("p_client_id" "uuid", "p_planned_date" "date", "p_type_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_context_patch_draft"("p_patch_draft_id" "uuid", "p_final_content" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_patch public.client_context_patch_drafts;
  v_file public.client_context_files;
  v_content text;
  v_current_hash text;
  v_new_hash text;
  v_application_id uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  select * into v_patch from public.client_context_patch_drafts where id=p_patch_draft_id for update;
  if not found then raise exception 'NOT_FOUND: context patch draft'; end if;
  if v_patch.status <> 'approved' then raise exception 'VALIDATION: only approved patches can be applied'; end if;
  if exists(select 1 from public.client_context_patch_applications where patch_draft_id=v_patch.id) then raise exception 'VALIDATION: patch already applied'; end if;

  select * into v_file from public.client_context_files where id=v_patch.target_file_id and client_id=v_patch.client_id for update;
  if not found then raise exception 'VALIDATION: target context file does not belong to client'; end if;
  v_current_hash:=md5(coalesce(v_file.content_md,''));
  if v_file.version <> v_patch.base_file_version or v_current_hash <> v_patch.base_content_hash then
    raise exception 'STALE: target context file version or content changed';
  end if;
  v_content:=coalesce(nullif(p_final_content,''),nullif(v_patch.proposed_content,''));
  if nullif(trim(coalesce(v_content,'')),'') is null then raise exception 'VALIDATION: final content is required to apply patch'; end if;
  v_new_hash:=md5(v_content);

  update public.client_context_files set content_md=v_content,version=v_file.version+1,updated_at=now() where id=v_file.id;
  insert into public.client_context_patch_applications(client_id,patch_draft_id,target_file_id,previous_version,new_version,
    previous_content_hash,new_content_hash,previous_content_snapshot,applied_content_snapshot,applied_by)
  values(v_patch.client_id,v_patch.id,v_file.id,v_file.version,v_file.version+1,v_current_hash,v_new_hash,v_file.content_md,v_content,
    case when auth.role()='service_role' then 'system' else auth.uid()::text end) returning id into v_application_id;
  update public.client_context_patch_drafts set status='applied',applied_at=now(),updated_at=now() where id=v_patch.id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(v_patch.client_id,'context_patch_applied','Context patch applied to '||coalesce(v_patch.target_file_name,v_file.file_name)||'; Phase 3 was not run.',
    'client_context_patch_draft',v_patch.id,jsonb_build_object('application_id',v_application_id,'target_file_id',v_file.id,'previous_version',v_file.version,'new_version',v_file.version+1));
  return v_application_id;
end $$;


ALTER FUNCTION "public"."apply_context_patch_draft"("p_patch_draft_id" "uuid", "p_final_content" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_context_patch_draft"("p_patch_draft_id" "uuid", "p_final_content" "text") IS 'Applies one approved non-stale patch atomically, increments one context file version, and never runs Phase 3.';



CREATE OR REPLACE FUNCTION "public"."apply_delete_asset"("p_operation_id" "uuid", "p_asset_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE a record; v_remaining int; v_promoted uuid; v_dist int := 0; v_analytics int := 0; v_snap int := 0;
BEGIN
  SELECT * INTO a FROM public.client_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('assets_deleted',0,'note','already absent'); END IF;
  IF public.phase_ref_is_published(a.client_id, a.source_ref) THEN
    RAISE EXCEPTION 'BLOCKED: % is published; local deletion is refused.', a.source_ref;
  END IF;
  DELETE FROM public.client_assets WHERE id = p_asset_id;
  SELECT count(*) INTO v_remaining FROM public.client_assets
    WHERE production_brief_id = a.production_brief_id AND asset_group_ref = a.asset_group_ref AND sequence_index = a.sequence_index;
  IF a.is_current AND v_remaining > 0 THEN
    SELECT id INTO v_promoted FROM public.client_assets
      WHERE production_brief_id = a.production_brief_id AND asset_group_ref = a.asset_group_ref AND sequence_index = a.sequence_index
      ORDER BY version DESC LIMIT 1;
    UPDATE public.client_assets SET is_current = true, updated_at = now() WHERE id = v_promoted;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_assets WHERE client_id = a.client_id AND source_ref = a.source_ref) THEN
    WITH d AS (DELETE FROM public.client_distribution_records WHERE client_id = a.client_id AND source_ref = a.source_ref
      AND publish_status <> 'published' AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1)
    SELECT count(*) INTO v_dist FROM d;
    WITH an AS (DELETE FROM public.client_analytics_records WHERE client_id = a.client_id AND source_ref = a.source_ref
      AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1)
    SELECT count(*) INTO v_analytics FROM an;
    WITH s AS (UPDATE public.client_asset_archive_snapshots SET superseded_at = now(), superseded_reason = 'asset permanently deleted', superseded_by_operation_id = p_operation_id
      WHERE client_id = a.client_id AND source_ref = a.source_ref AND superseded_at IS NULL RETURNING 1)
    SELECT count(*) INTO v_snap FROM s;
  END IF;
  RETURN jsonb_build_object('assets_deleted',1,'promoted_version',v_promoted,'remaining_versions',v_remaining,
    'distribution_deleted',v_dist,'analytics_deleted',v_analytics,'snapshots_superseded',v_snap);
END;
$$;


ALTER FUNCTION "public"."apply_delete_asset"("p_operation_id" "uuid", "p_asset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_delete_phase3_content"("p_operation_id" "uuid", "p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
DECLARE v_state text; v_cells int := 0; v_scope int := 0;
BEGIN
  IF p_master_table NOT IN ('organic_master','story_master','ads_master') THEN RAISE EXCEPTION 'invalid master table %', p_master_table; END IF;
  EXECUTE format('SELECT review_state FROM public.%I WHERE client_id=$1 AND ref=$2', p_master_table) INTO v_state USING p_client_id, p_ref;
  IF v_state IS NULL THEN RETURN jsonb_build_object('master_deleted',0,'note','already absent'); END IF;
  IF v_state = 'approved' THEN RAISE EXCEPTION 'BLOCKED: % is approved (immutable in this slice).', p_ref; END IF;
  IF EXISTS (SELECT 1 FROM public.client_production_briefs WHERE client_id=p_client_id AND source_ref=p_ref)
     OR EXISTS (SELECT 1 FROM public.client_assets WHERE client_id=p_client_id AND source_ref=p_ref)
     OR EXISTS (SELECT 1 FROM public.client_distribution_records WHERE client_id=p_client_id AND source_ref=p_ref)
     OR EXISTS (SELECT 1 FROM public.client_analytics_records WHERE client_id=p_client_id AND source_ref=p_ref)
     OR public.phase_ref_is_published(p_client_id, p_ref) THEN
    RAISE EXCEPTION 'BLOCKED: % has downstream records.', p_ref;
  END IF;
  WITH c AS (DELETE FROM public.calendar_cells WHERE client_id=p_client_id AND ref=p_ref RETURNING 1) SELECT count(*) INTO v_cells FROM c;
  EXECUTE format('DELETE FROM public.%I WHERE client_id=$1 AND ref=$2', p_master_table) USING p_client_id, p_ref;
  UPDATE public.client_phase3_scope_items SET created_master_id = NULL, updated_at = now()
    WHERE created_master_table = p_master_table AND planned_ref = p_ref
      AND run_id IN (SELECT id FROM public.client_phase3_scoped_runs WHERE client_id = p_client_id);
  GET DIAGNOSTICS v_scope = ROW_COUNT;
  RETURN jsonb_build_object('master_deleted',1,'calendar_cells_deleted',v_cells,'scope_items_unlinked',v_scope);
END;
$_$;


ALTER FUNCTION "public"."apply_delete_phase3_content"("p_operation_id" "uuid", "p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_reject_asset"("p_operation_id" "uuid", "p_client_id" "uuid", "p_asset_group_ref" "text", "p_brief_id" "uuid", "p_source_ref" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE v_cur int := 0; v_hist int := 0; v_dist int := 0; v_analytics int := 0; v_snap int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.client_assets WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref) AND public.phase_ref_is_published(p_client_id, p_source_ref) THEN
    RAISE EXCEPTION 'BLOCKED: % is published; rejection rollback is refused.', p_source_ref;
  END IF;
  WITH d AS (DELETE FROM public.client_assets WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref AND is_current = true RETURNING 1) SELECT count(*) INTO v_cur FROM d;
  WITH h AS (UPDATE public.client_assets SET status='rejected', updated_at=now() WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref AND is_current = false AND status <> 'rejected' RETURNING 1) SELECT count(*) INTO v_hist FROM h;
  WITH dd AS (DELETE FROM public.client_distribution_records WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref
    AND publish_status <> 'published' AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_dist FROM dd;
  WITH an AS (DELETE FROM public.client_analytics_records WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref
    AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_analytics FROM an;
  WITH s AS (UPDATE public.client_asset_archive_snapshots SET superseded_at=now(), superseded_reason='asset group rejected', superseded_by_operation_id=p_operation_id
    WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref AND stage='assets' AND superseded_at IS NULL RETURNING 1) SELECT count(*) INTO v_snap FROM s;
  IF p_brief_id IS NOT NULL THEN
    UPDATE public.client_production_briefs SET production_status='brief', production_mode=NULL, updated_at=now() WHERE id=p_brief_id;
  END IF;
  RETURN jsonb_build_object('current_frames_deleted',v_cur,'historical_versions_rejected',v_hist,'distribution_deleted',v_dist,'analytics_deleted',v_analytics,'snapshots_superseded',v_snap);
END;
$$;


ALTER FUNCTION "public"."apply_reject_asset"("p_operation_id" "uuid", "p_client_id" "uuid", "p_asset_group_ref" "text", "p_brief_id" "uuid", "p_source_ref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_reject_content_brief"("p_operation_id" "uuid", "p_client_id" "uuid", "p_brief_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE v_ref text; v_assets int := 0; v_jobs int := 0; v_dist int := 0; v_analytics int := 0; v_snap int := 0;
BEGIN
  SELECT source_ref INTO v_ref FROM public.client_production_briefs WHERE id=p_brief_id AND client_id=p_client_id;
  IF v_ref IS NULL THEN RETURN jsonb_build_object('note','brief absent'); END IF;
  IF public.phase_ref_is_published(p_client_id, v_ref) THEN RAISE EXCEPTION 'BLOCKED: % has published downstream content.', v_ref; END IF;
  UPDATE public.client_production_briefs SET status='rejected', production_status='failed', updated_at=now() WHERE id=p_brief_id;
  WITH d AS (DELETE FROM public.client_assets WHERE client_id=p_client_id AND production_brief_id=p_brief_id RETURNING 1) SELECT count(*) INTO v_assets FROM d;
  WITH j AS (DELETE FROM public.client_asset_generation_jobs WHERE client_id=p_client_id AND production_brief_id=p_brief_id RETURNING 1) SELECT count(*) INTO v_jobs FROM j;
  WITH dd AS (DELETE FROM public.client_distribution_records WHERE client_id=p_client_id AND production_brief_id=p_brief_id
    AND publish_status <> 'published' AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_dist FROM dd;
  WITH an AS (DELETE FROM public.client_analytics_records WHERE client_id=p_client_id AND source_ref=v_ref
    AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_analytics FROM an;
  WITH s AS (UPDATE public.client_asset_archive_snapshots SET superseded_at=now(), superseded_reason='content brief rejected', superseded_by_operation_id=p_operation_id
    WHERE client_id=p_client_id AND source_ref=v_ref AND superseded_at IS NULL RETURNING 1) SELECT count(*) INTO v_snap FROM s;
  RETURN jsonb_build_object('brief_retained_rejected',true,'assets_deleted',v_assets,'generation_jobs_deleted',v_jobs,'distribution_deleted',v_dist,'analytics_deleted',v_analytics,'snapshots_superseded',v_snap);
END;
$$;


ALTER FUNCTION "public"."apply_reject_content_brief"("p_operation_id" "uuid", "p_client_id" "uuid", "p_brief_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_expected_edit_revision" integer, "p_current_calendar_digest" "text", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_cycle public.client_ideation_cycles%rowtype;
  v_scoring public.client_ideation_scoring_runs%rowtype;
  v_expected uuid[];
  v_assigned uuid[];
  v_previous uuid;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.client_id <> p_client_id then raise exception 'PROPOSAL_CLIENT_MISMATCH'; end if;
  if v_proposal.status <> 'draft' then raise exception 'PROPOSAL_NOT_APPROVABLE'; end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'PROPOSAL_EDIT_REVISION_CONFLICT';
  end if;
  if v_proposal.calendar_conflict_digest <> p_current_calendar_digest then
    raise exception 'PROPOSAL_CALENDAR_SNAPSHOT_STALE';
  end if;

  select * into v_cycle from public.client_ideation_cycles where id = v_proposal.ideation_cycle_id;
  if v_cycle.status <> 'completed' or v_cycle.shortfall_count <> 0 then raise exception 'CYCLE_NOT_ELIGIBLE'; end if;
  select * into v_scoring from public.client_ideation_scoring_runs where id = v_proposal.scoring_run_id;
  if v_scoring.status <> 'completed' or v_scoring.failed_candidate_count <> 0 then
    raise exception 'SCORING_RUN_NOT_ELIGIBLE';
  end if;

  select array_agg((value->>'candidate_id')::uuid order by value->>'candidate_id')
  into v_expected from jsonb_array_elements(v_proposal.candidate_snapshot);
  select array_agg(candidate_id order by candidate_id)
  into v_assigned from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal.id and candidate_id is not null;
  if v_expected is distinct from v_assigned then raise exception 'PROPOSAL_CANDIDATE_RECONCILIATION_FAILED'; end if;

  if exists (select 1 from public.client_ideation_calendar_proposal_slots
             where proposal_id = v_proposal.id and candidate_id is null) then
    raise exception 'PROPOSAL_INCOMPLETE';
  end if;
  if exists (select 1 from public.client_ideation_calendar_proposal_slots
             where proposal_id = v_proposal.id
               and conflict_status in ('protected','date_capacity_exceeded','stale_calendar_snapshot')) then
    raise exception 'PROPOSAL_UNRESOLVED_CONFLICT';
  end if;
  -- Candidate and score drift since generation blocks approval.
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots slot
    join public.client_ideation_candidate_scores score on score.id = slot.candidate_score_id
    where slot.proposal_id = v_proposal.id
      and (score.candidate_content_hash <> slot.candidate_content_hash
        or score.rank is distinct from slot.candidate_rank_snapshot
        or score.overall_score is distinct from slot.candidate_score_snapshot)
  ) then
    raise exception 'PROPOSAL_CANDIDATE_DRIFTED';
  end if;

  -- Supersede the previously active approved proposal for this cycle.
  select id into v_previous from public.client_ideation_calendar_proposals
  where ideation_cycle_id = v_proposal.ideation_cycle_id and client_id = v_proposal.client_id
    and status = 'approved' and id <> v_proposal.id
  limit 1;
  if v_previous is not null then
    update public.client_ideation_calendar_proposals
    set status = 'superseded' where id = v_previous;
  end if;

  update public.client_ideation_calendar_proposals
  set status = 'approved', approved_at = now(), approved_by = p_actor_id,
      edit_revision = edit_revision + 1
  where id = v_proposal.id returning * into v_proposal;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_approved',
    'A proposed Ideation Calendar was approved. No operational Calendar or master row was created.',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('proposal_version', v_proposal.proposal_version,
      'superseded_proposal_id', v_previous, 'assigned_slots', v_proposal.assigned_slot_count)
  );
  return to_jsonb(v_proposal);
end
$$;


ALTER FUNCTION "public"."approve_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_expected_edit_revision" integer, "p_current_calendar_digest" "text", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_client_ids"() RETURNS "uuid"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_role TEXT;
BEGIN
  v_role := public.auth_role();
  RETURN CASE v_role
    WHEN 'admin'           THEN ARRAY(SELECT id FROM public.clients)
    WHEN 'account_manager' THEN ARRAY(SELECT client_id FROM public.team_members WHERE user_id = auth.uid())
    WHEN 'client'          THEN ARRAY(SELECT client_id FROM public.client_users WHERE user_id = auth.uid())
    ELSE ARRAY[]::uuid[]
  END;
END;
$$;


ALTER FUNCTION "public"."auth_client_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_role"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (SELECT role::text FROM public.users WHERE id = auth.uid());
END;
$$;


ALTER FUNCTION "public"."auth_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_ideation_calendar_proposal"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_scoring_run_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_scoring_snapshot" "jsonb", "p_slot_manifest" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_slot_planner_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_period_start" "date", "p_period_end" "date", "p_expected_slot_count" integer, "p_maximum_attempts" integer, "p_supersedes_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_scoring public.client_ideation_scoring_runs%rowtype;
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_inserted_id uuid;
  v_item jsonb;
  v_version integer := 1;
begin
  if length(trim(p_lease_owner)) < 8 or p_lease_seconds not between 60 and 600 then
    raise exception 'LEASE_CONFIGURATION_INVALID';
  end if;
  if p_maximum_attempts is null or p_maximum_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if p_expected_slot_count is null or p_expected_slot_count < 1 then
    raise exception 'PROPOSAL_EXPECTATION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_slot_manifest, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_slot_manifest) <> p_expected_slot_count then
    raise exception 'SLOT_MANIFEST_INVALID';
  end if;

  select * into v_cycle from public.client_ideation_cycles
  where id = p_ideation_cycle_id for share;
  if v_cycle.id is null then raise exception 'CYCLE_NOT_FOUND'; end if;
  if v_cycle.client_id <> p_client_id then raise exception 'CYCLE_CLIENT_MISMATCH'; end if;
  if v_cycle.status <> 'completed' or v_cycle.shortfall_count <> 0
    or v_cycle.candidate_count <> v_cycle.expected_candidate_count
    or v_cycle.expected_candidate_count <> p_expected_slot_count then
    raise exception 'CYCLE_NOT_ELIGIBLE';
  end if;
  if v_cycle.period_start <> p_period_start or v_cycle.period_end <> p_period_end then
    raise exception 'PERIOD_MISMATCH';
  end if;

  select * into v_scoring from public.client_ideation_scoring_runs
  where id = p_scoring_run_id for share;
  if v_scoring.id is null then raise exception 'SCORING_RUN_NOT_FOUND'; end if;
  if v_scoring.client_id <> p_client_id then raise exception 'SCORING_RUN_CLIENT_MISMATCH'; end if;
  if v_scoring.ideation_cycle_id <> p_ideation_cycle_id then raise exception 'SCORING_RUN_CYCLE_MISMATCH'; end if;
  if v_scoring.status <> 'completed'
    or v_scoring.failed_candidate_count <> 0
    or v_scoring.scored_candidate_count <> v_scoring.expected_candidate_count then
    raise exception 'SCORING_RUN_NOT_ELIGIBLE';
  end if;

  if p_supersedes_proposal_id is not null then
    select coalesce(max(proposal_version), 0) + 1 into v_version
    from public.client_ideation_calendar_proposals
    where ideation_cycle_id = p_ideation_cycle_id and client_id = p_client_id;
    perform 1 from public.client_ideation_calendar_proposals
    where id = p_supersedes_proposal_id and client_id = p_client_id
      and ideation_cycle_id = p_ideation_cycle_id
      and status in ('draft','approved');
    if not found then raise exception 'REGENERATE_PREDECESSOR_INVALID'; end if;
  end if;

  insert into public.client_ideation_calendar_proposals (
    client_id, ideation_cycle_id, scoring_run_id, proposal_version, supersedes_proposal_id,
    idempotency_key, configuration_hash, configuration_snapshot, authority_snapshot,
    candidate_snapshot, scoring_snapshot, slot_manifest_snapshot,
    calendar_conflict_snapshot, calendar_conflict_digest, slot_planner_version,
    prompt_digest, provider, model, output_schema_version, module_version,
    period_start, period_end, expected_slot_count, unassigned_candidate_count,
    maximum_attempts, created_by, lease_owner, lease_expires_at, last_heartbeat_at
  ) values (
    p_client_id, p_ideation_cycle_id, p_scoring_run_id, v_version, p_supersedes_proposal_id,
    p_idempotency_key, p_configuration_hash, p_configuration_snapshot, p_authority_snapshot,
    p_candidate_snapshot, p_scoring_snapshot, p_slot_manifest,
    p_calendar_conflict_snapshot, p_calendar_conflict_digest, p_slot_planner_version,
    p_prompt_digest, p_provider, p_model, p_output_schema_version, p_module_version,
    p_period_start, p_period_end, p_expected_slot_count, p_expected_slot_count,
    p_maximum_attempts, p_actor_id, p_lease_owner,
    now() + make_interval(secs => p_lease_seconds), now()
  )
  on conflict (client_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  select * into v_proposal from public.client_ideation_calendar_proposals
  where client_id = p_client_id and idempotency_key = p_idempotency_key for update;
  if v_proposal.configuration_hash <> p_configuration_hash then
    raise exception using errcode = '23505', message = 'PROPOSAL_IDEMPOTENCY_CONFLICT';
  end if;

  if v_inserted_id is not null then
    -- Materialise every planned slot immediately, unassigned. The manifest is
    -- server-owned from this point: the model can only fill these rows.
    for v_item in select value from jsonb_array_elements(p_slot_manifest)
    loop
      insert into public.client_ideation_calendar_proposal_slots (
        client_id, proposal_id, ideation_cycle_id, scoring_run_id,
        proposal_slot_key, proposed_date, period_start, period_end,
        date_slot_ordinal, required_asset_type, calendar_row_type, placement_basis,
        conflict_status, conflict_details
      ) values (
        p_client_id, v_proposal.id, p_ideation_cycle_id, p_scoring_run_id,
        v_item->>'proposal_slot_key', (v_item->>'proposed_date')::date,
        p_period_start, p_period_end,
        (v_item->>'date_slot_ordinal')::integer, v_item->>'required_asset_type',
        v_item->>'calendar_row_type', v_item->>'placement_basis',
        coalesce(v_item->>'conflict_status', 'clear'),
        coalesce(v_item->'conflict_details', '{}'::jsonb)
      );
    end loop;
    perform public.recount_ideation_proposal(v_proposal.id);
    select * into v_proposal from public.client_ideation_calendar_proposals where id = v_proposal.id;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_calendar_proposal_started',
      'A proposed Ideation Calendar was started.',
      'client_ideation_calendar_proposal', v_proposal.id::text,
      jsonb_build_object('ideation_cycle_id', p_ideation_cycle_id, 'scoring_run_id', p_scoring_run_id,
        'expected_slots', p_expected_slot_count, 'proposal_version', v_proposal.proposal_version)
    );
    return jsonb_build_object('created', true, 'reclaimed', false, 'proposal', to_jsonb(v_proposal));
  end if;

  if v_proposal.status in ('draft','approved','failed','superseded') then
    return jsonb_build_object('created', false, 'reclaimed', false, 'proposal', to_jsonb(v_proposal));
  end if;
  if v_proposal.status = 'running' and v_proposal.lease_expires_at > now() then
    return jsonb_build_object('created', false, 'reclaimed', false, 'proposal', to_jsonb(v_proposal));
  end if;
  if v_proposal.status not in ('running','retryable') then
    raise exception 'PROPOSAL_STATE_INVALID';
  end if;
  if v_proposal.attempt_count >= v_proposal.maximum_attempts then
    update public.client_ideation_calendar_proposals
    set status = 'failed', retryable = false,
        failure_code = 'PROPOSAL_ATTEMPTS_EXHAUSTED',
        failure_message = 'The configured proposal attempt limit was exhausted.',
        failed_at = now(), lease_owner = null, lease_expires_at = null
    where id = v_proposal.id returning * into v_proposal;
    return jsonb_build_object('created', false, 'reclaimed', false,
      'attempts_exhausted', true, 'proposal', to_jsonb(v_proposal));
  end if;

  update public.client_ideation_calendar_proposals
  set status = 'running', retryable = false, attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now(), failure_code = null, failure_message = null, failed_at = null
  where id = v_proposal.id returning * into v_proposal;
  return jsonb_build_object('created', true, 'reclaimed', true, 'proposal', to_jsonb(v_proposal));
end
$$;


ALTER FUNCTION "public"."begin_ideation_calendar_proposal"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_scoring_run_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_scoring_snapshot" "jsonb", "p_slot_manifest" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_slot_planner_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_period_start" "date", "p_period_end" "date", "p_expected_slot_count" integer, "p_maximum_attempts" integer, "p_supersedes_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_ideation_run"("p_client_id" "uuid", "p_period_type" "text", "p_period_start" "date", "p_period_end" "date", "p_execution_months" "text"[], "p_idempotency_key" "text", "p_input_hash" "text", "p_quantity_plan" "jsonb", "p_configuration_snapshot" "jsonb", "p_techniques" "jsonb", "p_slot_allocation" "jsonb", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_inserted_id uuid;
  v_item jsonb;
  v_expected_slugs text[] := array[
    'persona','review-mined-pain-language','competitor-objections',
    'end-customer-complaints','live-objection-log','trigger-event','format-swipe'
  ];
  v_supplied_slugs text[];
  v_validated_count integer;
  v_expected_count integer;
  v_max_attempts integer;
  v_previous_status text;
  v_reclaimed boolean := false;
begin
  if jsonb_typeof(p_techniques) <> 'array' or jsonb_array_length(p_techniques) <> 7 then
    raise exception 'TECHNIQUE_SET_INVALID';
  end if;
  select array_agg(value->>'slug' order by value->>'slug'),
         count(distinct value->>'slug')
    into v_supplied_slugs, v_validated_count
  from jsonb_array_elements(p_techniques);
  if v_validated_count <> 7
    or v_supplied_slugs <> (
      select array_agg(slug order by slug)
      from unnest(v_expected_slugs) as expected(slug)
    ) then
    raise exception 'TECHNIQUE_SET_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_techniques) as supplied(item)
    where coalesce((supplied.item->>'order')::integer, 0) not between 1 and 7
      or coalesce((supplied.item->>'version')::integer, 0) < 1
      or length(coalesce(supplied.item->>'name', '')) < 1
      or length(coalesce(supplied.item->>'prompt_template', '')) < 1
      or length(coalesce(supplied.item->>'output_schema_version', '')) < 1
      or length(coalesce(supplied.item->>'module_version', '')) < 1
      or jsonb_typeof(supplied.item->'source_policy') <> 'object'
      or jsonb_typeof(supplied.item->'model_policy') <> 'object'
      or supplied.item->>'slug' <> v_expected_slugs[(supplied.item->>'order')::integer]
  ) or (
    select count(distinct (value->>'order')::integer)
    from jsonb_array_elements(p_techniques)
  ) <> 7 then
    raise exception 'TECHNIQUE_CONFIGURATION_INVALID';
  end if;
  if p_configuration_snapshot->'technique_manifest' is distinct from p_techniques then
    raise exception 'TECHNIQUE_CONFIGURATION_CHANGED';
  end if;
  if jsonb_typeof(p_slot_allocation) <> 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_slot_allocation) key)
       <> (
         select array_agg(slug order by slug)
         from unnest(v_expected_slugs) as expected(slug)
       ) then
    raise exception 'SLOT_ALLOCATION_INVALID';
  end if;
  if exists (
    select 1 from jsonb_each(p_slot_allocation)
    where jsonb_typeof(value) <> 'array'
  ) then raise exception 'SLOT_ALLOCATION_INVALID'; end if;
  select coalesce(sum(jsonb_array_length(value)), 0) into v_expected_count
  from jsonb_each(p_slot_allocation);
  if v_expected_count <> coalesce((p_quantity_plan->>'total')::integer, -1) then
    raise exception 'SLOT_ALLOCATION_QUANTITY_MISMATCH';
  end if;
  if length(trim(p_lease_owner)) < 8 or p_lease_seconds not between 60 and 600 then
    raise exception 'LEASE_CONFIGURATION_INVALID';
  end if;
  begin
    v_max_attempts := (p_configuration_snapshot #>> '{retry_policy,max_attempts}')::integer;
  exception when others then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end;
  if v_max_attempts is null or v_max_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;

  insert into public.client_ideation_cycles (
    client_id, period_type, period_start, period_end, execution_months,
    idempotency_key, input_hash, quantity_plan, configuration_snapshot,
    slot_allocation, expected_candidate_count, shortfall_count, created_by,
    lease_owner, lease_expires_at, last_heartbeat_at
  ) values (
    p_client_id, p_period_type, p_period_start, p_period_end, p_execution_months,
    p_idempotency_key, p_input_hash, p_quantity_plan, p_configuration_snapshot,
    p_slot_allocation, v_expected_count, v_expected_count, p_actor_id,
    p_lease_owner, now() + make_interval(secs => p_lease_seconds), now()
  )
  on conflict (client_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  select * into v_cycle
  from public.client_ideation_cycles
  where client_id = p_client_id and idempotency_key = p_idempotency_key
  for update;
  if v_cycle.input_hash <> p_input_hash then
    raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  if v_inserted_id is not null then
    for v_item in select value from jsonb_array_elements(p_techniques)
    loop
      insert into public.client_ideation_technique_runs (
        client_id, technique_slug, technique_version, technique_order,
        ideation_cycle_id, status, idempotency_key, input_hash,
        authority_snapshot, technique_snapshot, initiated_by,
        started_at, attempt_count, requested_slots, generated_slots,
        failed_slots, retryable
      ) values (
        p_client_id, v_item->>'slug', (v_item->>'version')::integer,
        (v_item->>'order')::integer, v_cycle.id, 'running',
        p_idempotency_key || ':' || (v_item->>'slug'), p_input_hash,
        p_configuration_snapshot->'authority', v_item, p_actor_id,
        now(), 1, p_slot_allocation->(v_item->>'slug'), 0,
        jsonb_array_length(p_slot_allocation->(v_item->>'slug')), false
      );
    end loop;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_run_started',
      'Ideation generation started for ' || p_period_start || ' through ' || p_period_end || '.',
      'client_ideation_cycle', v_cycle.id::text,
      jsonb_build_object('period_type', p_period_type, 'expected_candidates', v_expected_count)
    );
    return jsonb_build_object('created', true, 'reclaimed', false, 'cycle', to_jsonb(v_cycle));
  end if;

  if v_cycle.status in ('completed','failed') then
    return jsonb_build_object('created', false, 'reclaimed', false, 'cycle', to_jsonb(v_cycle));
  end if;
  if v_cycle.status = 'running' and v_cycle.lease_expires_at > now() then
    return jsonb_build_object('created', false, 'reclaimed', false, 'cycle', to_jsonb(v_cycle));
  end if;
  if v_cycle.status not in ('running','retryable') then
    raise exception 'RUN_STATE_INVALID';
  end if;
  begin
    v_max_attempts := (v_cycle.configuration_snapshot #>> '{retry_policy,max_attempts}')::integer;
  exception when others then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end;
  if v_max_attempts is null or v_max_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if v_cycle.attempt_count >= v_max_attempts then
    update public.client_ideation_technique_runs
    set status = case when status = 'running' or failed_slots > 0 then 'failed' else status end,
        retryable = false,
        error_code = case
          when status = 'running' or failed_slots > 0 then 'IDEATION_ATTEMPTS_EXHAUSTED'
          else error_code
        end,
        error_message = case
          when status = 'running' or failed_slots > 0
            then 'The configured Ideation attempt limit was exhausted.'
          else error_message
        end,
        finished_at = case when status = 'running' or failed_slots > 0 then now() else finished_at end
    where ideation_cycle_id = v_cycle.id;
    update public.client_ideation_cycles
    set status = 'failed',
        retryable = false,
        error_code = 'IDEATION_ATTEMPTS_EXHAUSTED',
        error_message = 'The configured Ideation attempt limit was exhausted.',
        finished_at = now(),
        lease_owner = null,
        lease_expires_at = null
    where id = v_cycle.id
    returning * into v_cycle;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_run_attempts_exhausted',
      'Ideation stopped after exhausting its configured attempt limit.',
      'client_ideation_cycle', v_cycle.id::text,
      jsonb_build_object('attempt_count', v_cycle.attempt_count, 'max_attempts', v_max_attempts)
    );
    return jsonb_build_object(
      'created', false,
      'reclaimed', false,
      'attempts_exhausted', true,
      'cycle', to_jsonb(v_cycle)
    );
  end if;

  v_previous_status := v_cycle.status;
  update public.client_ideation_cycles
  set status = 'running',
      retryable = false,
      attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now(),
      error_code = null,
      error_message = null,
      finished_at = null
  where id = v_cycle.id
  returning * into v_cycle;
  update public.client_ideation_technique_runs
  set status = 'running',
      started_at = now(),
      finished_at = null,
      error_code = null,
      error_message = null,
      retryable = false,
      attempt_count = attempt_count + 1
  where ideation_cycle_id = v_cycle.id
    and attempt_count < v_max_attempts
    and (
      (v_previous_status = 'running' and status = 'running')
      or
      (v_previous_status = 'retryable' and status = 'shortfall' and retryable)
    );
  v_reclaimed := true;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_run_reclaimed',
    'An expired or retryable Ideation generation run was safely reclaimed.',
    'client_ideation_cycle', v_cycle.id::text,
    jsonb_build_object('attempt_count', v_cycle.attempt_count)
  );
  return jsonb_build_object('created', true, 'reclaimed', v_reclaimed, 'cycle', to_jsonb(v_cycle));
end
$$;


ALTER FUNCTION "public"."begin_ideation_run"("p_client_id" "uuid", "p_period_type" "text", "p_period_start" "date", "p_period_end" "date", "p_execution_months" "text"[], "p_idempotency_key" "text", "p_input_hash" "text", "p_quantity_plan" "jsonb", "p_configuration_snapshot" "jsonb", "p_techniques" "jsonb", "p_slot_allocation" "jsonb", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_ideation_scoring_run"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_rubric_slug" "text", "p_rubric_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_expected_candidate_count" integer, "p_maximum_attempts" integer, "p_supersedes_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_run public.client_ideation_scoring_runs%rowtype;
  v_inserted_id uuid;
begin
  if length(trim(p_lease_owner)) < 8 or p_lease_seconds not between 60 and 600 then
    raise exception 'LEASE_CONFIGURATION_INVALID';
  end if;
  if p_maximum_attempts is null or p_maximum_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if p_expected_candidate_count is null or p_expected_candidate_count < 1 then
    raise exception 'SCORING_EXPECTATION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_candidate_snapshot, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_candidate_snapshot) <> p_expected_candidate_count then
    raise exception 'CANDIDATE_SNAPSHOT_INVALID';
  end if;

  select * into v_cycle
  from public.client_ideation_cycles
  where id = p_ideation_cycle_id
  for share;
  if v_cycle.id is null then raise exception 'CYCLE_NOT_FOUND'; end if;
  if v_cycle.client_id <> p_client_id then raise exception 'CYCLE_CLIENT_MISMATCH'; end if;
  if v_cycle.status <> 'completed' then raise exception 'CYCLE_NOT_ELIGIBLE'; end if;
  if v_cycle.shortfall_count <> 0
    or v_cycle.candidate_count <> v_cycle.expected_candidate_count
    or v_cycle.expected_candidate_count <> p_expected_candidate_count then
    raise exception 'CYCLE_NOT_ELIGIBLE';
  end if;

  -- An explicit re-score must name a real, completed, same-cycle predecessor.
  if p_supersedes_scoring_run_id is not null then
    perform 1 from public.client_ideation_scoring_runs
    where id = p_supersedes_scoring_run_id
      and client_id = p_client_id
      and ideation_cycle_id = p_ideation_cycle_id
      and status = 'completed';
    if not found then raise exception 'RESCORE_PREDECESSOR_INVALID'; end if;
  end if;

  insert into public.client_ideation_scoring_runs (
    client_id, ideation_cycle_id, idempotency_key, configuration_hash,
    configuration_snapshot, authority_snapshot, candidate_snapshot,
    rubric_slug, rubric_version, prompt_digest, provider, model,
    output_schema_version, module_version, expected_candidate_count,
    maximum_attempts, supersedes_scoring_run_id, created_by,
    lease_owner, lease_expires_at, last_heartbeat_at
  ) values (
    p_client_id, p_ideation_cycle_id, p_idempotency_key, p_configuration_hash,
    p_configuration_snapshot, p_authority_snapshot, p_candidate_snapshot,
    p_rubric_slug, p_rubric_version, p_prompt_digest, p_provider, p_model,
    p_output_schema_version, p_module_version, p_expected_candidate_count,
    p_maximum_attempts, p_supersedes_scoring_run_id, p_actor_id,
    p_lease_owner, now() + make_interval(secs => p_lease_seconds), now()
  )
  on conflict (client_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  select * into v_run
  from public.client_ideation_scoring_runs
  where client_id = p_client_id and idempotency_key = p_idempotency_key
  for update;
  if v_run.configuration_hash <> p_configuration_hash then
    raise exception using errcode = '23505', message = 'SCORING_IDEMPOTENCY_CONFLICT';
  end if;

  if v_inserted_id is not null then
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_scoring_started',
      'Ideation candidate scoring started.',
      'client_ideation_scoring_run', v_run.id::text,
      jsonb_build_object(
        'ideation_cycle_id', p_ideation_cycle_id,
        'expected_candidates', p_expected_candidate_count,
        'rubric_version', p_rubric_version,
        'supersedes_scoring_run_id', p_supersedes_scoring_run_id
      )
    );
    return jsonb_build_object('created', true, 'reclaimed', false, 'run', to_jsonb(v_run));
  end if;

  if v_run.status in ('completed','failed') then
    return jsonb_build_object('created', false, 'reclaimed', false, 'run', to_jsonb(v_run));
  end if;
  if v_run.status = 'running' and v_run.lease_expires_at > now() then
    return jsonb_build_object('created', false, 'reclaimed', false, 'run', to_jsonb(v_run));
  end if;
  if v_run.status not in ('running','retryable') then
    raise exception 'SCORING_RUN_STATE_INVALID';
  end if;
  if v_run.attempt_count >= v_run.maximum_attempts then
    update public.client_ideation_scoring_runs
    set status = 'failed',
        retryable = false,
        error_code = 'SCORING_ATTEMPTS_EXHAUSTED',
        error_message = 'The configured Ideation scoring attempt limit was exhausted.',
        failed_at = now(),
        lease_owner = null,
        lease_expires_at = null
    where id = v_run.id
    returning * into v_run;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_scoring_attempts_exhausted',
      'Ideation scoring stopped after exhausting its configured attempt limit.',
      'client_ideation_scoring_run', v_run.id::text,
      jsonb_build_object('attempt_count', v_run.attempt_count, 'max_attempts', v_run.maximum_attempts)
    );
    return jsonb_build_object(
      'created', false, 'reclaimed', false, 'attempts_exhausted', true, 'run', to_jsonb(v_run)
    );
  end if;

  update public.client_ideation_scoring_runs
  set status = 'running',
      retryable = false,
      attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now(),
      error_code = null,
      error_message = null,
      failed_at = null
  where id = v_run.id
  returning * into v_run;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_scoring_reclaimed',
    'An expired or retryable Ideation scoring run was safely reclaimed.',
    'client_ideation_scoring_run', v_run.id::text,
    jsonb_build_object('attempt_count', v_run.attempt_count)
  );
  return jsonb_build_object('created', true, 'reclaimed', true, 'run', to_jsonb(v_run));
end
$$;


ALTER FUNCTION "public"."begin_ideation_scoring_run"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_rubric_slug" "text", "p_rubric_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_expected_candidate_count" integer, "p_maximum_attempts" integer, "p_supersedes_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."video_projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "organic_master_id" "uuid",
    "ads_master_id" "uuid",
    "client_production_brief_id" "uuid",
    "archetype" "text" NOT NULL,
    "awareness_stage" "text" NOT NULL,
    "target_duration_sec" integer NOT NULL,
    "brand_prompt_block_id" "uuid" NOT NULL,
    "brand_prompt_block_version" integer NOT NULL,
    "status" "text" DEFAULT 'storyboarding'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "current_deliverable_id" "uuid",
    "story_strategy" "jsonb",
    "continuity_plan" "jsonb",
    "storyboard_provenance" "jsonb",
    "storyboard_prompt_version" "text",
    "storyboard_model" "text",
    "storyboard_generated_at" timestamp with time zone,
    CONSTRAINT "video_projects_archetype_check" CHECK (("archetype" = ANY (ARRAY['A1'::"text", 'A2'::"text", 'A3'::"text", 'A4'::"text", 'A5'::"text"]))),
    CONSTRAINT "video_projects_awareness_stage_check" CHECK (("awareness_stage" = ANY (ARRAY['unaware'::"text", 'problem_aware'::"text", 'solution_aware'::"text", 'product_aware'::"text", 'most_aware'::"text"]))),
    CONSTRAINT "video_projects_brand_prompt_block_version_check" CHECK (("brand_prompt_block_version" > 0)),
    CONSTRAINT "video_projects_source_pair" CHECK ((NOT (("organic_master_id" IS NOT NULL) AND ("ads_master_id" IS NOT NULL)))),
    CONSTRAINT "video_projects_status_check" CHECK (("status" = ANY (ARRAY['storyboarding'::"text", 'generating'::"text", 'review'::"text", 'approved'::"text", 'handed_off'::"text"]))),
    CONSTRAINT "video_projects_target_duration_sec_check" CHECK ((("target_duration_sec" >= 22) AND ("target_duration_sec" <= 34))),
    CONSTRAINT "video_projects_title_check" CHECK (("btrim"("title") <> ''::"text"))
);


ALTER TABLE "public"."video_projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."video_projects"."current_deliverable_id" IS 'The project''s current final Reel. Never infer the final Reel from timestamps, filenames, asset groups or storage listings.';



COMMENT ON COLUMN "public"."video_projects"."story_strategy" IS 'Structured story spine generated before any shot exists. Null for storyboards created before the sequence-first generator.';



COMMENT ON COLUMN "public"."video_projects"."continuity_plan" IS 'Project-level visual continuity plan every shot prompt compiles from.';



COMMENT ON COLUMN "public"."video_projects"."storyboard_provenance" IS 'Which approved authority produced this storyboard: brief id, source row, approved context/execution file ids, brand block id+version, budget outcomes.';



COMMENT ON COLUMN "public"."video_projects"."storyboard_prompt_version" IS 'Prompt contract version used, so a future quality regression is traceable to a prompt change.';



CREATE OR REPLACE FUNCTION "public"."bind_legacy_reel_project_brief"("p_video_project_id" "uuid", "p_client_production_brief_id" "uuid") RETURNS "public"."video_projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_source_table text;
  v_source_row_id uuid;
begin
  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not exist.';
  end if;

  if v_project.client_production_brief_id is not null then
    if v_project.client_production_brief_id is distinct from p_client_production_brief_id then
      raise exception 'REEL_BRIEF_ALREADY_BOUND: Video project is already bound to a different production brief.';
    end if;
    return v_project;
  end if;

  v_source_table := case
    when v_project.organic_master_id is not null then 'organic_master'
    when v_project.ads_master_id is not null then 'ads_master'
    else null
  end;
  v_source_row_id := coalesce(v_project.organic_master_id, v_project.ads_master_id);
  if v_source_table is null or v_source_row_id is null then
    raise exception 'REEL_PROJECT_SOURCE_MISSING: Standalone projects cannot bind a production brief implicitly.';
  end if;

  select *
    into v_brief
    from public.client_production_briefs
   where id = p_client_production_brief_id
   for share;
  if not found then
    raise exception 'REEL_BRIEF_NOT_FOUND: Production brief does not exist.';
  end if;
  if v_brief.client_id is distinct from v_project.client_id
     or v_brief.source_table is distinct from v_source_table
     or v_brief.source_row_id is distinct from v_source_row_id
     or v_brief.asset_format is distinct from 'reel_video'
     or v_brief.status is distinct from 'approved'::public.review_state then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Production brief is not an approved reel_video brief for the project source.';
  end if;

  update public.video_projects
     set client_production_brief_id = p_client_production_brief_id,
         updated_at = now()
   where id = p_video_project_id
  returning * into v_project;

  return v_project;
end;
$$;


ALTER FUNCTION "public"."bind_legacy_reel_project_brief"("p_video_project_id" "uuid", "p_client_production_brief_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_unsupported_scheduled_distribution"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_count integer;
begin
  with blocked as (
    select c.id,
           public.distribution_publication_supported(c.asset_format, c.publish_settings, c.publish_payload, c.video_deliverable_id) as reason
      from public.client_distribution_records c
     where c.publish_status = 'scheduled'
       and c.external_post_id is null and c.published_at is null and c.published_url is null
  ),
  updated as (
    update public.client_distribution_records d
       set publish_status = 'failed', permanent_failure = true,
           claimed_at = null, claimed_by = null, next_attempt_at = null,
           last_error = '[unsupported_capability, non-retryable] ' || b.reason,
           updated_at = now()
      from blocked b
     where d.id = b.id and b.reason is not null
    returning d.id
  )
  select count(*) into v_count from updated;
  return coalesce(v_count, 0);
end;
$$;


ALTER FUNCTION "public"."block_unsupported_scheduled_distribution"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_distribution_record"("p_record_id" "uuid") RETURNS TABLE("success" boolean, "record_id" "uuid", "previous_status" "text", "new_status" "text", "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare rec public.client_distribution_records; v_prev text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.publish_status = 'published' or rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null then
    raise exception 'REFUSED: published or evidence-bearing record cannot be cancelled'; end if;
  if rec.publish_status not in ('ready','scheduled','failed','needs_reconciliation') then raise exception 'REFUSED: cannot cancel from status %', rec.publish_status; end if;
  update public.client_distribution_records set publish_status='cancelled', claimed_at=null, claimed_by=null, next_attempt_at=null, updated_at=now() where id=p_record_id;
  perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'cancel', v_prev, 'cancelled', null);
  return query select true, p_record_id, v_prev, 'cancelled'::text, 'Cancelled.'::text;
end; $$;


ALTER FUNCTION "public"."cancel_distribution_record"("p_record_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_distribution_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "execution_month" "text" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_group_ref" "text" NOT NULL,
    "production_brief_id" "uuid",
    "asset_format" "text" NOT NULL,
    "title" "text",
    "publish_status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "publish_mode" "text",
    "planned_publish_date" "date",
    "scheduled_publish_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "published_url" "text",
    "external_post_id" "text",
    "platform" "text" DEFAULT 'instagram'::"text",
    "destination" "text",
    "publish_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "publish_settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_error" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sequence_index" integer DEFAULT 1 NOT NULL,
    "sequence_count" integer,
    "claimed_at" timestamp with time zone,
    "claimed_by" "text",
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "permanent_failure" boolean DEFAULT false NOT NULL,
    "video_project_id" "uuid",
    "video_deliverable_id" "uuid",
    "external_container_id" "text",
    "container_status" "text",
    "container_created_at" timestamp with time zone,
    "container_checked_at" timestamp with time zone,
    "container_poll_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "client_distribution_records_container_poll_count_check" CHECK (("container_poll_count" >= 0)),
    CONSTRAINT "client_distribution_records_container_status_check" CHECK ((("container_status" IS NULL) OR ("container_status" = ANY (ARRAY['IN_PROGRESS'::"text", 'FINISHED'::"text", 'ERROR'::"text", 'EXPIRED'::"text", 'PUBLISHED'::"text"])))),
    CONSTRAINT "client_distribution_records_execution_month_check" CHECK (("execution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "client_distribution_records_publish_mode_check" CHECK (("publish_mode" = ANY (ARRAY['publish_now'::"text", 'scheduled'::"text"]))),
    CONSTRAINT "client_distribution_records_publish_status_check" CHECK (("publish_status" = ANY (ARRAY['ready'::"text", 'scheduled'::"text", 'publishing'::"text", 'published'::"text", 'failed'::"text", 'cancelled'::"text", 'needs_reconciliation'::"text"]))),
    CONSTRAINT "client_distribution_records_sequence_count_check" CHECK ((("sequence_count" IS NULL) OR ("sequence_count" > 0))),
    CONSTRAINT "client_distribution_records_sequence_index_check" CHECK (("sequence_index" > 0))
);


ALTER TABLE "public"."client_distribution_records" OWNER TO "postgres";


COMMENT ON COLUMN "public"."client_distribution_records"."external_container_id" IS 'Instagram media container id (creation_id) returned by POST /{ig-user-id}/media. Persisted immediately so a worker timeout never creates a second container.';



CREATE OR REPLACE FUNCTION "public"."claim_due_distribution_records"("p_worker_id" "text", "p_limit" integer) RETURNS SETOF "public"."client_distribution_records"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 10);
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then raise exception 'REFUSED: worker id required'; end if;
  return query
  update public.client_distribution_records d
  set publish_status='publishing', claimed_at=now(), claimed_by=p_worker_id, attempt_count=d.attempt_count+1, last_error=null, updated_at=now()
  where d.id in (
    select c.id from public.client_distribution_records c
    where c.publish_status='scheduled' and c.scheduled_publish_at is not null and c.scheduled_publish_at <= now()
      and (c.next_attempt_at is null or c.next_attempt_at <= now())
      and c.external_post_id is null and c.published_at is null and c.published_url is null and c.permanent_failure = false
      and public.distribution_publication_supported(c.asset_format, c.publish_settings, c.publish_payload, c.video_deliverable_id) is null
      and not exists (select 1 from public.client_distribution_records e where e.client_id=c.client_id and e.asset_group_ref=c.asset_group_ref and e.sequence_index < c.sequence_index and e.publish_status <> 'published')
    order by c.scheduled_publish_at limit v_limit for update skip locked)
  returning d.*;
end; $$;


ALTER FUNCTION "public"."claim_due_distribution_records"("p_worker_id" "text", "p_limit" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_asset_generation_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "generation_job_id" "uuid" NOT NULL,
    "sequence_index" integer NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "prompt_md" "text" NOT NULL,
    "storage_path" "text",
    "client_asset_id" "uuid",
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_asset_generation_items_prompt_md_check" CHECK (("length"(TRIM(BOTH FROM "prompt_md")) > 0)),
    CONSTRAINT "client_asset_generation_items_sequence_index_check" CHECK (("sequence_index" > 0)),
    CONSTRAINT "client_asset_generation_items_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'complete'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."client_asset_generation_items" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_asset_generation_item"("p_job_id" "uuid") RETURNS SETOF "public"."client_asset_generation_items"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  update public.client_asset_generation_items i
  set status = 'processing', attempt_count = i.attempt_count + 1, updated_at = now()
  where i.id = (
    select c.id
    from public.client_asset_generation_items c
    join public.client_asset_generation_jobs j on j.id = c.generation_job_id
    where c.generation_job_id = p_job_id
      and c.status = 'queued'
      and j.closed_at is null
      and coalesce(j.accepted_partial, false) = false
      and coalesce(j.closure_type, '') not in ('cancelled','partial_accepted')
      and not exists (
        select 1 from public.client_asset_group_completeness_overrides o
        where o.client_id = j.client_id and o.asset_group_ref = j.asset_group_ref and o.is_active and o.revoked_at is null
      )
    order by c.sequence_index
    limit 1
    for update skip locked
  )
  returning i.*;
$$;


ALTER FUNCTION "public"."claim_next_asset_generation_item"("p_job_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_phase3_scope_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "execution_month" "text" NOT NULL,
    "slot_key" "text" NOT NULL,
    "planned_date" "date" NOT NULL,
    "end_date" "date",
    "asset_format" "text" NOT NULL,
    "type_code" "text" NOT NULL,
    "action" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "planned_ref" "text",
    "created_master_table" "text",
    "created_master_id" "uuid",
    "calendar_cell_id" "uuid",
    "conflict_reason" "text",
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_phase3_scope_items_action_check" CHECK (("action" = ANY (ARRAY['create'::"text", 'skip'::"text", 'conflict'::"text", 'replace'::"text"]))),
    CONSTRAINT "client_phase3_scope_items_asset_format_check" CHECK (("asset_format" = ANY (ARRAY['feed_post'::"text", 'carousel'::"text", 'reel_video'::"text", 'story_sequence'::"text", 'ad_static'::"text"]))),
    CONSTRAINT "client_phase3_scope_items_execution_month_check" CHECK (("execution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "client_phase3_scope_items_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'complete'::"text", 'skipped'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_phase3_scope_items_type_code_check" CHECK (("type_code" = ANY (ARRAY['FP'::"text", 'CR'::"text", 'RL'::"text", 'ST'::"text", 'AD'::"text"])))
);


ALTER TABLE "public"."client_phase3_scope_items" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_phase3_scope_item"("p_run_id" "uuid") RETURNS SETOF "public"."client_phase3_scope_items"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  UPDATE public.client_phase3_scope_items i
  SET status = 'processing', updated_at = now()
  WHERE i.id = (
    SELECT c.id FROM public.client_phase3_scope_items c
    WHERE c.run_id = p_run_id AND c.status = 'queued'
    ORDER BY c.planned_date, c.slot_key
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING i.*;
$$;


ALTER FUNCTION "public"."claim_next_phase3_scope_item"("p_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_ideation_content"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid", "p_configuration_hash" "text", "p_commit_input_snapshot" "jsonb", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals;
  v_cycle public.client_ideation_cycles;
  v_scoring public.client_ideation_scoring_runs;
  v_run_id uuid;
  v_slot record;
  v_candidate public.client_ideation_candidates;
  v_score public.client_ideation_candidate_scores;
  v_target record;
  v_authority record;
  v_authority_version integer;
  v_authority_state text;
  v_authority_hash text;
  v_ref text;
  v_master_id uuid;
  v_cell_id uuid;
  v_month text;
  v_existing_completed uuid;
  v_slot_total integer := 0;
  v_organic integer := 0;
  v_story integer := 0;
  v_placed integer;
  v_existing integer;
  v_protected integer;
  v_master_payload jsonb;
  v_calendar_payload jsonb;
  v_refs text[] := '{}';
  v_attempt integer;
begin
  -- coalesce: a caller with no role claim at all must fail closed, not slip
  -- through on a NULL comparison.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'IDEATION_COMMIT_FORBIDDEN';
  end if;

  -- 1. Lock the proposal for the whole transaction. Two simultaneous commits
  -- serialise here; the loser then finds the completed run at step 3.
  select * into v_proposal
  from public.client_ideation_calendar_proposals
  where id = p_proposal_id and client_id = p_client_id
  for update;
  if not found then raise exception 'IDEATION_COMMIT_PROPOSAL_NOT_FOUND'; end if;

  -- 2. Approved, active, and exactly the revision the operator confirmed.
  if v_proposal.status = 'superseded' then raise exception 'IDEATION_COMMIT_PROPOSAL_SUPERSEDED'; end if;
  if exists (
    select 1 from public.client_ideation_calendar_proposals
    where supersedes_proposal_id = v_proposal.id and client_id = p_client_id and status <> 'failed'
  ) then
    raise exception 'IDEATION_COMMIT_PROPOSAL_SUPERSEDED';
  end if;
  if v_proposal.status <> 'approved' then raise exception 'IDEATION_COMMIT_PROPOSAL_NOT_APPROVED'; end if;
  if v_proposal.approved_at is null or v_proposal.approved_by is null then
    raise exception 'IDEATION_COMMIT_PROPOSAL_NOT_APPROVED';
  end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'IDEATION_COMMIT_PROPOSAL_REVISION_CONFLICT';
  end if;

  -- 3. A completed commit already exists: replay, never duplicate.
  select id into v_existing_completed
  from public.client_ideation_commit_runs
  where proposal_id = v_proposal.id and status = 'completed';
  if v_existing_completed is not null then
    return jsonb_build_object('replayed', true, 'commit_run_id', v_existing_completed);
  end if;

  -- 4. Cycle and scoring run must still be complete and reconciled.
  select * into v_cycle from public.client_ideation_cycles
  where id = v_proposal.ideation_cycle_id and client_id = p_client_id;
  if not found or v_cycle.status <> 'completed'
    or v_cycle.candidate_count <> v_cycle.expected_candidate_count
    or v_cycle.shortfall_count <> 0 then
    raise exception 'IDEATION_COMMIT_CYCLE_NOT_ELIGIBLE';
  end if;

  select * into v_scoring from public.client_ideation_scoring_runs
  where id = v_proposal.scoring_run_id and client_id = p_client_id
    and ideation_cycle_id = v_cycle.id;
  if not found or v_scoring.status <> 'completed'
    or v_scoring.scored_candidate_count <> v_scoring.expected_candidate_count
    or v_scoring.failed_candidate_count <> 0 then
    raise exception 'IDEATION_COMMIT_SCORING_RUN_NOT_ELIGIBLE';
  end if;

  -- 5. Proposal-level completeness.
  if v_proposal.unassigned_candidate_count <> 0 then raise exception 'IDEATION_COMMIT_PROPOSAL_INCOMPLETE'; end if;
  if v_proposal.unresolved_conflict_count <> 0 then raise exception 'IDEATION_COMMIT_PROPOSAL_CONFLICTS_UNRESOLVED'; end if;

  select count(*) into v_slot_total
  from public.client_ideation_calendar_proposal_slots where proposal_id = v_proposal.id;
  if v_slot_total <> v_proposal.expected_slot_count
    or v_proposal.assigned_slot_count <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_PROPOSAL_SNAPSHOT_MISMATCH';
  end if;
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and (candidate_id is null or candidate_score_id is null)
  ) then
    raise exception 'IDEATION_COMMIT_PROPOSAL_INCOMPLETE';
  end if;

  -- 6. Authority and Calendar drift since approval.
  -- Re-verify the authority the proposal recorded, INSIDE this transaction and
  -- under a row lock.
  --
  -- Stage 5 closes the preflight-to-transaction race: the Edge preflight
  -- verifies full content hashes, but a content edit that did not increment a
  -- version could previously slip through between preflight and commit. Each
  -- recorded authority row is now locked FOR SHARE — the narrowest lock that
  -- blocks a concurrent writer while leaving other readers unaffected — and its
  -- content hash is recomputed here. The hash is sha256 of the full content_md,
  -- exactly as reconstructScoringAuthority computes it, so the two halves agree
  -- byte for byte. Locks are held only for this transaction, and no authority
  -- row is ever modified.
  for v_authority in
    select entry->>'id' as id, (entry->>'version')::integer as version,
           entry->>'content_hash' as content_hash, 'context' as kind
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'context', '[]'::jsonb)) entry
    union all
    select entry->>'id', (entry->>'version')::integer, entry->>'content_hash', 'context'
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'strategic_playbooks', '[]'::jsonb)) entry
    union all
    select entry->>'id', (entry->>'version')::integer, entry->>'content_hash', 'execution'
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'execution', '[]'::jsonb)) entry
  loop
    if v_authority.kind = 'context' then
      select version, status, encode(sha256(convert_to(coalesce(content_md, ''), 'UTF8')), 'hex')
      into v_authority_version, v_authority_state, v_authority_hash
      from public.client_context_files
      where id = v_authority.id::uuid and client_id = p_client_id
      for share;
    else
      select version, review_state::text, encode(sha256(convert_to(coalesce(content_md, ''), 'UTF8')), 'hex')
      into v_authority_version, v_authority_state, v_authority_hash
      from public.client_execution_files
      where id = v_authority.id::uuid and client_id = p_client_id
      for share;
    end if;
    if not found
      or v_authority_state <> 'approved'
      or v_authority_version <> v_authority.version
      or (v_authority.content_hash is not null and v_authority_hash <> v_authority.content_hash) then
      raise exception 'IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH';
    end if;
  end loop;

  if v_proposal.calendar_conflict_digest <> p_calendar_digest then
    raise exception 'IDEATION_COMMIT_CALENDAR_SNAPSHOT_STALE';
  end if;

  -- 7. Every asset type must be supported BEFORE any operational write.
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots s
    where s.proposal_id = v_proposal.id
      and not exists (select 1 from public.ideation_commit_target(s.required_asset_type))
  ) then
    raise exception 'IDEATION_COMMIT_UNSUPPORTED_ASSET_TYPE';
  end if;

  -- 8. Re-check the live Calendar inside the transaction, using exactly the
  -- Stage 3 rules: an approved or archived row protects a date and lane, and a
  -- date and lane cannot carry more than two placements.
  for v_slot in
    select s.*, t.calendar_row_type as target_row_type
    from public.client_ideation_calendar_proposal_slots s
    cross join lateral public.ideation_commit_target(s.required_asset_type) t
    where s.proposal_id = v_proposal.id
    order by s.proposed_date, s.proposal_slot_key
  loop
    if v_slot.calendar_row_type <> v_slot.target_row_type then
      raise exception 'IDEATION_COMMIT_MASTER_MAPPING_INVALID: %', v_slot.proposal_slot_key;
    end if;

    select count(*) into v_protected
    from public.calendar_cells c
    where c.client_id = p_client_id and c.date = v_slot.proposed_date
      and c.row_type::text = v_slot.calendar_row_type
      and c.review_state in ('approved','archived');
    if v_protected > 0 then
      raise exception 'IDEATION_COMMIT_CALENDAR_CONFLICT: %', v_slot.proposal_slot_key;
    end if;

    select count(*) into v_existing
    from public.calendar_cells c
    where c.client_id = p_client_id and c.date = v_slot.proposed_date
      and c.row_type::text = v_slot.calendar_row_type;
    select count(*) into v_placed
    from public.client_ideation_calendar_proposal_slots s2
    where s2.proposal_id = v_proposal.id and s2.proposed_date = v_slot.proposed_date
      and s2.calendar_row_type = v_slot.calendar_row_type;
    if v_placed > 1 and v_placed + v_existing > 2 then
      raise exception 'IDEATION_COMMIT_CALENDAR_CONFLICT: %', v_slot.proposal_slot_key;
    end if;
  end loop;

  -- 9. Open the commit run. It reaches 'completed' inside this same transaction,
  -- so 'running' is never externally observable; it exists for audit only.
  insert into public.client_ideation_commit_runs (
    client_id, ideation_cycle_id, scoring_run_id, proposal_id, status,
    idempotency_key, configuration_hash, commit_input_snapshot, calendar_digest,
    proposal_version, proposal_edit_revision,
    target_manifest_version, mapping_version, reference_allocator_version,
    output_schema_version, module_version,
    period_start, period_end, expected_item_count, created_by
  ) values (
    p_client_id, v_cycle.id, v_scoring.id, v_proposal.id, 'running',
    p_idempotency_key, p_configuration_hash, coalesce(p_commit_input_snapshot, '{}'::jsonb), p_calendar_digest,
    v_proposal.proposal_version, v_proposal.edit_revision,
    p_target_manifest_version, p_mapping_version, p_reference_allocator_version,
    p_output_schema_version, p_module_version,
    v_proposal.period_start, v_proposal.period_end, v_proposal.expected_slot_count, p_actor_id
  ) returning id into v_run_id;

  -- 10. Create the operational content, deterministically ordered.
  for v_slot in
    select s.*, t.type_code, t.master_table, t.calendar_row_type as target_row_type
    from public.client_ideation_calendar_proposal_slots s
    cross join lateral public.ideation_commit_target(s.required_asset_type) t
    where s.proposal_id = v_proposal.id
    order by s.proposed_date, s.proposal_slot_key
  loop
    select * into v_candidate from public.client_ideation_candidates
    where id = v_slot.candidate_id and client_id = p_client_id and ideation_cycle_id = v_cycle.id;
    if not found then raise exception 'IDEATION_COMMIT_CANDIDATE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key; end if;
    if v_candidate.asset_type <> v_slot.required_asset_type
      or v_candidate.asset_type <> v_slot.candidate_asset_type_snapshot
      or v_candidate.input_hash <> v_slot.candidate_content_hash then
      raise exception 'IDEATION_COMMIT_CANDIDATE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key;
    end if;

    select * into v_score from public.client_ideation_candidate_scores
    where id = v_slot.candidate_score_id and scoring_run_id = v_scoring.id and client_id = p_client_id;
    if not found then raise exception 'IDEATION_COMMIT_SCORE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key; end if;
    if v_score.candidate_id <> v_slot.candidate_id
      or v_score.rank is distinct from v_slot.candidate_rank_snapshot
      or v_score.overall_score <> v_slot.candidate_score_snapshot
      or v_score.candidate_content_hash <> v_slot.candidate_content_hash then
      raise exception 'IDEATION_COMMIT_SCORE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key;
    end if;

    -- Mandatory operational content must already exist on the candidate. It is
    -- never invented here, and a gap fails the whole commit before insertion.
    if coalesce(nullif(trim(v_candidate.working_title), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: working_title (%)', v_slot.proposal_slot_key;
    end if;
    if coalesce(nullif(trim(v_candidate.hook), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: hook (%)', v_slot.proposal_slot_key;
    end if;
    if coalesce(nullif(trim(v_candidate.core_message), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: core_message (%)', v_slot.proposal_slot_key;
    end if;
    if coalesce(nullif(trim(v_candidate.cta), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: cta (%)', v_slot.proposal_slot_key;
    end if;

    v_month := to_char(v_slot.proposed_date, 'YYYY-MM');

    -- Canonical operational reference, allocated under the existing Phase 3
    -- advisory lock. The rare UNIQUE race re-allocates rather than failing.
    v_master_id := null;
    for v_attempt in 1..5 loop
      v_ref := public.allocate_phase3_ref(p_client_id, v_slot.proposed_date, v_slot.type_code);
      if v_ref is null then raise exception 'IDEATION_COMMIT_REFERENCE_ALLOCATION_FAILED: %', v_slot.proposal_slot_key; end if;
      if v_ref = any(v_refs) then continue; end if;
      begin
        if v_slot.master_table = 'story_master' then
          insert into public.story_master (
            client_id, month, ref, review_state, status, story_type,
            story_theme, frame_1, frame_2, frame_3, cta_engagement_prompt,
            source_origin, distribution_date
          ) values (
            p_client_id, v_month, v_ref, 'needs_review', 'idea', 'daily',
            v_candidate.working_title, v_candidate.hook, v_candidate.core_message,
            v_candidate.psychological_angle, v_candidate.cta,
            'Ideation ' || left(v_cycle.id::text, 8), v_slot.proposed_date
          ) returning id into v_master_id;
        else
          insert into public.organic_master (
            client_id, month, ref, review_state, status, content_type,
            working_title, hook, core_message, cta, psychological_angle,
            source_origin, distribution_date, format_proven
          ) values (
            p_client_id, v_month, v_ref, 'needs_review', 'idea', v_slot.type_code,
            v_candidate.working_title, v_candidate.hook, v_candidate.core_message,
            v_candidate.cta, v_candidate.psychological_angle,
            'Ideation ' || left(v_cycle.id::text, 8), v_slot.proposed_date, false
          ) returning id into v_master_id;
        end if;
        exit;
      exception when unique_violation then
        v_master_id := null;
      end;
    end loop;
    if v_master_id is null then
      raise exception 'IDEATION_COMMIT_REFERENCE_ALLOCATION_FAILED: %', v_slot.proposal_slot_key;
    end if;
    v_refs := v_refs || v_ref;

    insert into public.calendar_cells (client_id, month, date, row_type, ref, review_state)
    values (p_client_id, v_month, v_slot.proposed_date, v_slot.calendar_row_type::public.calendar_row_type,
            v_ref, 'needs_review')
    returning id into v_cell_id;

    v_master_payload := jsonb_build_object(
      'master_table', v_slot.master_table, 'client_id', p_client_id, 'month', v_month, 'ref', v_ref,
      'review_state', 'needs_review', 'status', 'idea', 'asset_type', v_slot.required_asset_type,
      'type_code', v_slot.type_code, 'distribution_date', v_slot.proposed_date,
      'candidate_id', v_candidate.id, 'candidate_content_hash', v_candidate.input_hash,
      'mapping_version', p_mapping_version,
      -- Story type provenance. Approved authority defines no deterministic
      -- candidate-to-story-type rule, so Stage 4 uses the same neutral canonical
      -- default Phase 3 falls back to. Recording it here makes the choice, and
      -- the fact that it is a default rather than derived authority, auditable.
      'story_type', case when v_slot.master_table = 'story_master' then 'daily' else null end,
      'story_type_source', case when v_slot.master_table = 'story_master'
        then 'neutral_canonical_default' else null end);
    v_calendar_payload := jsonb_build_object(
      'client_id', p_client_id, 'month', v_month, 'date', v_slot.proposed_date,
      'row_type', v_slot.calendar_row_type, 'ref', v_ref, 'review_state', 'needs_review');

    insert into public.client_ideation_commit_items (
      client_id, commit_run_id, ideation_cycle_id, scoring_run_id, proposal_id,
      proposal_slot_id, proposal_slot_key, candidate_id, candidate_score_id,
      candidate_content_hash, candidate_rank_snapshot, candidate_score_snapshot,
      asset_type, target_master_table, target_master_id, target_calendar_cell_id,
      calendar_row_type, operational_ref, committed_date, execution_month,
      master_payload_hash, calendar_payload_hash
    ) values (
      p_client_id, v_run_id, v_cycle.id, v_scoring.id, v_proposal.id,
      v_slot.id, v_slot.proposal_slot_key, v_candidate.id, v_score.id,
      v_slot.candidate_content_hash, v_slot.candidate_rank_snapshot, v_slot.candidate_score_snapshot,
      v_slot.required_asset_type, v_slot.master_table, v_master_id, v_cell_id,
      v_slot.calendar_row_type, v_ref, v_slot.proposed_date, v_month,
      -- Built-in sha256(bytea); no pgcrypto dependency is introduced.
      encode(sha256(convert_to(v_master_payload::text, 'UTF8')), 'hex'),
      encode(sha256(convert_to(v_calendar_payload::text, 'UTF8')), 'hex')
    );

    if v_slot.master_table = 'story_master' then
      v_story := v_story + 1;
    else
      v_organic := v_organic + 1;
    end if;
  end loop;

  -- 11. Exact reconciliation, per record and never by aggregate alone.
  if v_organic + v_story <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;
  if (select count(*) from public.client_ideation_commit_items where commit_run_id = v_run_id)
     <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots s
    where s.proposal_id = v_proposal.id
      and not exists (
        select 1 from public.client_ideation_commit_items i
        where i.commit_run_id = v_run_id and i.proposal_slot_id = s.id
      )
  ) then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;
  if (select count(distinct candidate_id) from public.client_ideation_commit_items where commit_run_id = v_run_id)
     <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;

  update public.client_ideation_commit_runs
  set status = 'completed',
      committed_item_count = v_organic + v_story,
      organic_item_count = v_organic,
      story_item_count = v_story,
      failed_item_count = 0,
      completed_at = now(),
      updated_at = now()
  where id = v_run_id;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_content_committed',
    'Ideation content was committed: ' || (v_organic + v_story)::text ||
      ' operational Content records and ' || (v_organic + v_story)::text ||
      ' Calendar records were created for ' || v_proposal.period_start::text || ' to ' ||
      v_proposal.period_end::text || '. They enter the normal review workflow; no production, publishing, or distribution was started.',
    'client_ideation_commit_run', v_run_id::text,
    jsonb_build_object(
      'proposal_id', v_proposal.id, 'commit_run_id', v_run_id,
      'ideation_cycle_id', v_cycle.id, 'scoring_run_id', v_scoring.id,
      'item_count', v_organic + v_story, 'organic_count', v_organic, 'story_count', v_story,
      'period_start', v_proposal.period_start, 'period_end', v_proposal.period_end,
      'operational_refs', to_jsonb(v_refs[1:50]))
  );

  return jsonb_build_object('replayed', false, 'commit_run_id', v_run_id);
end;
$$;


ALTER FUNCTION "public"."commit_ideation_content"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid", "p_configuration_hash" "text", "p_commit_input_snapshot" "jsonb", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."commit_ideation_content"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid", "p_configuration_hash" "text", "p_commit_input_snapshot" "jsonb", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") IS 'Ideation Stage 4: the one atomic transaction that turns an approved proposal into operational masters and calendar_cells. Never writes ads_master, briefs, assets, distribution, or analytics.';



CREATE TABLE IF NOT EXISTS "public"."video_project_deliverables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "video_project_id" "uuid" NOT NULL,
    "client_production_brief_id" "uuid",
    "source_table" "text",
    "source_row_id" "uuid",
    "storage_bucket" "text" DEFAULT 'video-assets'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "original_filename" "text",
    "mime_type" "text" DEFAULT 'video/mp4'::"text" NOT NULL,
    "file_format" "text" DEFAULT 'mp4'::"text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "width" integer,
    "height" integer,
    "duration_sec" numeric,
    "media_metadata_source" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "version" integer NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    "upload_state" "text" DEFAULT 'reserved'::"text" NOT NULL,
    "status" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_feedback" "text",
    "uploaded_by" "uuid",
    "upload_completed_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    "superseded_by_deliverable_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "video_project_deliverables_bucket_check" CHECK (("storage_bucket" = 'video-assets'::"text")),
    CONSTRAINT "video_project_deliverables_duration_check" CHECK ((("duration_sec" IS NULL) OR ("duration_sec" > (0)::numeric))),
    CONSTRAINT "video_project_deliverables_format_check" CHECK (("file_format" = 'mp4'::"text")),
    CONSTRAINT "video_project_deliverables_height_check" CHECK ((("height" IS NULL) OR ("height" > 0))),
    CONSTRAINT "video_project_deliverables_metadata_source_check" CHECK (("media_metadata_source" = ANY (ARRAY['unknown'::"text", 'client_reported'::"text", 'server_probed'::"text"]))),
    CONSTRAINT "video_project_deliverables_mime_check" CHECK (("mime_type" = 'video/mp4'::"text")),
    CONSTRAINT "video_project_deliverables_path_check" CHECK (("btrim"("storage_path") <> ''::"text")),
    CONSTRAINT "video_project_deliverables_reserved_not_current" CHECK ((("upload_state" = 'uploaded'::"text") OR (("is_current" = false) AND ("superseded_at" IS NULL)))),
    CONSTRAINT "video_project_deliverables_size_check" CHECK (("file_size_bytes" > 0)),
    CONSTRAINT "video_project_deliverables_upload_state_check" CHECK (("upload_state" = ANY (ARRAY['reserved'::"text", 'uploaded'::"text"]))),
    CONSTRAINT "video_project_deliverables_version_check" CHECK (("version" > 0)),
    CONSTRAINT "video_project_deliverables_width_check" CHECK ((("width" IS NULL) OR ("width" > 0)))
);


ALTER TABLE "public"."video_project_deliverables" OWNER TO "postgres";


COMMENT ON TABLE "public"."video_project_deliverables" IS 'Authoritative record of a final edited Reel MP4 produced by an external editor and uploaded back into Cockpit. One row per version; exactly one is_current per project.';



CREATE OR REPLACE FUNCTION "public"."complete_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_verified_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_duration_sec" numeric, "p_metadata_source" "text") RETURNS "public"."video_project_deliverables"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_row public.video_project_deliverables;
  v_previous public.video_project_deliverables;
  v_completed timestamptz := now();
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;

  select * into v_row
    from public.video_project_deliverables
   where id = p_deliverable_id and video_project_id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_DELIVERABLE_NOT_FOUND: Final Reel upload slot does not belong to this project.';
  end if;
  if v_row.upload_state = 'uploaded' then
    -- Idempotent: a duplicate completion call returns the row unchanged.
    return v_row;
  end if;

  select * into v_previous
    from public.video_project_deliverables
   where video_project_id = p_video_project_id and is_current
   for update;

  if found then
    if exists (
      select 1 from public.client_distribution_records d
       where d.video_deliverable_id = v_previous.id and d.publish_status in ('publishing', 'published')
    ) then
      raise exception 'REEL_CURRENT_VERSION_PUBLISHING: The current version is publishing or published and cannot be superseded.';
    end if;
    update public.video_project_deliverables
       set is_current = false, superseded_at = v_completed,
           superseded_by_deliverable_id = p_deliverable_id, updated_at = v_completed
     where id = v_previous.id;
  end if;

  update public.video_project_deliverables
     set upload_state = 'uploaded',
         is_current = true,
         upload_completed_at = v_completed,
         file_size_bytes = coalesce(p_verified_size_bytes, file_size_bytes),
         width = p_width,
         height = p_height,
         duration_sec = p_duration_sec,
         media_metadata_source = coalesce(p_metadata_source, 'unknown'),
         status = 'needs_review'::public.review_state,
         updated_at = v_completed
   where id = p_deliverable_id
  returning * into v_row;

  update public.video_projects
     set current_deliverable_id = p_deliverable_id, updated_at = v_completed
   where id = p_video_project_id;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id, 'reel_studio_final_version_created',
    'Final Reel version ' || v_row.version::text || ' was uploaded and is awaiting review.',
    'video_project', p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id, 'deliverable_id', p_deliverable_id, 'version', v_row.version,
      'production_brief_id', v_row.client_production_brief_id,
      'superseded_version', case when v_previous.id is not null then v_previous.version else null end,
      'file_size_bytes', v_row.file_size_bytes,
      'media_metadata_source', v_row.media_metadata_source
    )
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."complete_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_verified_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_duration_sec" numeric, "p_metadata_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_warnings" "jsonb", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_expected uuid[];
  v_assigned uuid[];
  v_slot_keys integer;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'running' or v_proposal.lease_owner <> p_lease_owner
    or v_proposal.lease_expires_at <= now() then
    raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST';
  end if;

  -- Exact reconciliation, never an aggregate count.
  select array_agg((value->>'candidate_id')::uuid order by value->>'candidate_id')
  into v_expected from jsonb_array_elements(v_proposal.candidate_snapshot);
  select array_agg(candidate_id order by candidate_id)
  into v_assigned from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal.id and candidate_id is not null;
  if v_expected is distinct from v_assigned then
    raise exception 'PROPOSAL_CANDIDATE_RECONCILIATION_FAILED';
  end if;

  select count(*) into v_slot_keys from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal.id;
  if v_slot_keys <> v_proposal.expected_slot_count then raise exception 'PROPOSAL_SLOT_RECONCILIATION_FAILED'; end if;
  if exists (select 1 from public.client_ideation_calendar_proposal_slots
             where proposal_id = v_proposal.id and candidate_id is null) then
    raise exception 'PROPOSAL_INCOMPLETE';
  end if;

  update public.client_ideation_calendar_proposals
  set status = 'draft', retryable = false, warnings = coalesce(p_warnings, '[]'::jsonb),
      failure_code = null, failure_message = null, failed_at = null,
      generated_at = now(), lease_owner = null, lease_expires_at = null
  where id = v_proposal.id returning * into v_proposal;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_drafted',
    'A proposed Ideation Calendar is ready for review.',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('assigned_slots', v_proposal.assigned_slot_count,
      'conflicts', v_proposal.conflict_count, 'unresolved', v_proposal.unresolved_conflict_count)
  );
  return to_jsonb(v_proposal);
end
$$;


ALTER FUNCTION "public"."complete_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_warnings" "jsonb", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_research_results" "jsonb", "p_candidates" "jsonb", "p_run_results" "jsonb", "p_provider" "text", "p_model" "text", "p_prompt_version" "text", "p_output_schema_version" "text", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_run public.client_ideation_technique_runs%rowtype;
  v_item jsonb;
  v_run_id uuid;
  v_research_id uuid;
  v_candidate_index integer;
  v_expected_asset_type text;
  v_candidate_count integer;
  v_generated integer;
  v_failed integer;
  v_run_count integer;
  v_distinct_results integer;
  v_max_attempts integer;
  v_any_retryable boolean := false;
  v_any_non_retryable boolean := false;
  v_all_slots_fulfilled boolean := false;
begin
  select * into v_cycle
  from public.client_ideation_cycles
  where id = p_cycle_id
  for update;
  if v_cycle.id is null then raise exception 'RUN_NOT_FOUND'; end if;
  if v_cycle.status <> 'running'
    or v_cycle.lease_owner <> p_lease_owner
    or v_cycle.lease_expires_at <= now() then
    raise exception 'LEASE_OWNERSHIP_LOST';
  end if;
  begin
    v_max_attempts := (v_cycle.configuration_snapshot #>> '{retry_policy,max_attempts}')::integer;
  exception when others then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end;
  if v_max_attempts is null or v_max_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_research_results, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_candidates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_run_results, '[]'::jsonb)) <> 'array' then
    raise exception 'COMPLETION_PAYLOAD_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_candidates) candidate
    group by candidate->>'technique_slug', candidate->>'candidate_index'
    having count(*) > 1
  ) then
    raise exception 'CANDIDATE_SLOT_DUPLICATE';
  end if;
  select count(*) into v_run_count from public.client_ideation_technique_runs where ideation_cycle_id = p_cycle_id;
  select count(distinct value->>'technique_slug') into v_distinct_results
  from jsonb_array_elements(coalesce(p_run_results, '[]'::jsonb));
  if v_run_count <> 7 or jsonb_array_length(coalesce(p_run_results, '[]'::jsonb)) <> 7
    or v_distinct_results <> 7
    or exists (
      select 1
      from jsonb_array_elements(p_run_results) result
      left join public.client_ideation_technique_runs run
        on run.ideation_cycle_id = p_cycle_id and run.technique_slug = result->>'technique_slug'
      where run.id is null
    )
    or exists (
      select 1 from public.client_ideation_technique_runs run
      where run.ideation_cycle_id = p_cycle_id
        and not exists (
          select 1 from jsonb_array_elements(p_run_results) result
          where result->>'technique_slug' = run.technique_slug
        )
    )
    or exists (
      select 1 from jsonb_array_elements(p_run_results) result
      where coalesce(result->>'status', '') not in (
        'complete','ready','reference_ready','no_source','inactive','shortfall','failed'
      )
    ) then
    raise exception 'RUN_RESULT_SET_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_research_results, '[]'::jsonb))
  loop
    select r.* into v_run
    from public.client_ideation_technique_runs r
    where r.ideation_cycle_id = p_cycle_id and r.technique_slug = v_item->>'technique_slug';
    if v_run.id is null or v_run.client_id <> v_cycle.client_id then
      raise exception 'RESEARCH_RUN_INVALID';
    end if;
    if (v_item ? 'technique_run_id') and (v_item->>'technique_run_id')::uuid <> v_run.id then
      raise exception 'RESEARCH_RUN_INVALID';
    end if;
    if (v_item ? 'client_id') and (v_item->>'client_id')::uuid <> v_cycle.client_id then
      raise exception 'RESEARCH_CLIENT_INVALID';
    end if;
    if exists (
      select 1
      from public.client_ideation_research_results existing
      where existing.ideation_cycle_id = p_cycle_id
        and existing.research_key = v_item->>'research_key'
        and (
          existing.technique_run_id <> v_run.id
          or existing.client_id <> v_cycle.client_id
        )
    ) then
      raise exception 'RESEARCH_PROVENANCE_CONFLICT';
    end if;
    insert into public.client_ideation_research_results (
      client_id, ideation_cycle_id, technique_run_id,
      research_key, source_identifier, source_type, source_url, source_title,
      source_excerpt, source_provider, retrieved_at, content_hash, status,
      source_findings, analysis_provider, analysis_model, analysis_prompt_version,
      analysis_output_schema_version, analyzed_at, analysis_findings,
      analysis_source_references
    ) values (
      v_cycle.client_id, p_cycle_id, v_run.id,
      v_item->>'research_key', v_item->>'source_identifier', v_item->>'source_type',
      v_item->>'source_url', v_item->>'source_title', v_item->>'source_excerpt',
      v_item->>'source_provider', (v_item->>'retrieved_at')::timestamptz,
      v_item->>'content_hash', coalesce(v_item->>'status', 'processed'),
      coalesce(v_item->'source_findings', '{}'::jsonb),
      v_item->>'analysis_provider', v_item->>'analysis_model',
      v_item->>'analysis_prompt_version', v_item->>'analysis_output_schema_version',
      (v_item->>'analyzed_at')::timestamptz,
      coalesce(v_item->'analysis_findings', '{}'::jsonb),
      coalesce(v_item->'analysis_source_references', '[]'::jsonb)
    )
    on conflict (ideation_cycle_id, research_key) do update set
      analysis_provider = excluded.analysis_provider,
      analysis_model = excluded.analysis_model,
      analysis_prompt_version = excluded.analysis_prompt_version,
      analysis_output_schema_version = excluded.analysis_output_schema_version,
      analyzed_at = excluded.analyzed_at,
      analysis_findings = excluded.analysis_findings,
      analysis_source_references = excluded.analysis_source_references,
      updated_at = now();
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb))
  loop
    select r.* into v_run
    from public.client_ideation_technique_runs r
    where r.ideation_cycle_id = p_cycle_id and r.technique_slug = v_item->>'technique_slug';
    if v_run.id is null or v_run.client_id <> v_cycle.client_id then
      raise exception 'CANDIDATE_RUN_INVALID';
    end if;
    if (v_item ? 'technique_run_id') and (v_item->>'technique_run_id')::uuid <> v_run.id then
      raise exception 'CANDIDATE_RUN_INVALID';
    end if;
    if (v_item ? 'client_id') and (v_item->>'client_id')::uuid <> v_cycle.client_id then
      raise exception 'CANDIDATE_CLIENT_INVALID';
    end if;
    begin
      v_candidate_index := (v_item->>'candidate_index')::integer;
    exception when others then
      raise exception 'CANDIDATE_SLOT_INVALID';
    end;
    if v_candidate_index < 0
      or v_candidate_index >= jsonb_array_length(v_run.requested_slots) then
      raise exception 'CANDIDATE_SLOT_INVALID';
    end if;
    v_expected_asset_type := v_run.requested_slots ->> v_candidate_index;
    if coalesce(v_item->>'asset_type', '') <> v_expected_asset_type then
      raise exception 'CANDIDATE_ASSET_ALLOCATION_INVALID';
    end if;
    select id into v_research_id
    from public.client_ideation_research_results
    where ideation_cycle_id = p_cycle_id
      and client_id = v_cycle.client_id
      and technique_run_id = v_run.id
      and research_key = v_item->>'research_key';
    if v_research_id is null then raise exception 'CANDIDATE_PROVENANCE_INVALID'; end if;
    if (v_item ? 'research_result_id')
      and (v_item->>'research_result_id')::uuid <> v_research_id then
      raise exception 'CANDIDATE_PROVENANCE_INVALID';
    end if;
    if exists (
      select 1 from public.client_ideation_candidates
      where technique_run_id = v_run.id and candidate_index = v_candidate_index
    ) then
      raise exception 'CANDIDATE_SLOT_ALREADY_FILLED';
    end if;
    insert into public.client_ideation_candidates (
      client_id, ideation_cycle_id, technique_run_id,
      research_result_id, candidate_index, asset_type, status,
      working_title, hook, core_message, psychological_angle, cta,
      evidence_references, draft_payload, model_provider, model_name,
      prompt_version, output_schema_version, input_hash, created_by
    ) values (
      v_cycle.client_id, p_cycle_id, v_run.id,
      v_research_id, v_candidate_index,
      v_item->>'asset_type', 'needs_review',
      v_item->>'working_title', v_item->>'hook', v_item->>'core_message',
      nullif(v_item->>'psychological_angle', ''), v_item->>'cta',
      coalesce(v_item->'evidence_references', '[]'::jsonb),
      coalesce(v_item->'draft_payload', '{}'::jsonb),
      p_provider, p_model, p_prompt_version, p_output_schema_version,
      v_cycle.input_hash, p_actor_id
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_run_results)
  loop
    select * into v_run
    from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id and technique_slug = v_item->>'technique_slug';
    select count(*) into v_generated
    from public.client_ideation_candidates where technique_run_id = v_run.id;
    if exists (
      select 1
      from public.client_ideation_candidates candidate
      where candidate.technique_run_id = v_run.id
        and (
          candidate.ideation_cycle_id <> p_cycle_id
          or candidate.client_id <> v_cycle.client_id
          or candidate.candidate_index < 0
          or candidate.candidate_index >= jsonb_array_length(v_run.requested_slots)
          or candidate.asset_type <> (v_run.requested_slots ->> candidate.candidate_index)
        )
    ) then
      raise exception 'PERSISTED_CANDIDATE_ALLOCATION_INVALID';
    end if;
    v_failed := greatest(jsonb_array_length(v_run.requested_slots) - v_generated, 0);
    if v_failed = 0 then
      update public.client_ideation_technique_runs
      set status = case
            when jsonb_array_length(v_run.requested_slots) = 0
              and coalesce(v_item->>'status', 'complete') = 'no_source' then 'no_source'
            when jsonb_array_length(v_run.requested_slots) = 0
              and coalesce(v_item->>'status', 'complete') = 'inactive' then 'inactive'
            else 'complete'
          end,
          provider = p_provider, model = p_model,
          prompt_version = p_prompt_version,
          proposed_output = coalesce(v_item->'summary', '{}'::jsonb),
          technique_snapshot = technique_snapshot
            || jsonb_build_object('result_status', coalesce(v_item->>'status', 'complete')),
          generated_slots = v_generated, failed_slots = 0, retryable = false,
          finished_at = now(), error_code = null, error_message = null
      where id = v_run.id;
    else
      update public.client_ideation_technique_runs
      set status = case
            when coalesce((v_item->>'retryable')::boolean, false)
              and v_cycle.attempt_count < v_max_attempts then 'shortfall'
            else 'failed'
          end,
          provider = p_provider, model = p_model,
          prompt_version = p_prompt_version, generated_slots = v_generated,
          failed_slots = v_failed,
          retryable = coalesce((v_item->>'retryable')::boolean, false)
            and v_cycle.attempt_count < v_max_attempts,
          finished_at = now(),
          error_code = coalesce(v_item->>'error_code', 'TECHNIQUE_SHORTFALL'),
          error_message = coalesce(v_item->>'error_message', 'Technique did not fill its requested slots.')
      where id = v_run.id;
    end if;
  end loop;
  if exists (
    select 1 from public.client_ideation_technique_runs where ideation_cycle_id = p_cycle_id and status = 'running'
  ) then raise exception 'NON_TERMINAL_TECHNIQUE_RUN'; end if;

  select count(*) into v_candidate_count
  from public.client_ideation_candidates where ideation_cycle_id = p_cycle_id;
  if (
    select coalesce(sum(jsonb_array_length(requested_slots)), 0)
    from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id
  ) <> v_cycle.expected_candidate_count
    or coalesce((v_cycle.quantity_plan->>'total')::integer, -1) <> v_cycle.expected_candidate_count
    or v_candidate_count > v_cycle.expected_candidate_count then
    raise exception 'IMMUTABLE_QUANTITY_RECONCILIATION_FAILED';
  end if;
  select exists (
    select 1 from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id and failed_slots > 0 and retryable
  ) into v_any_retryable;
  select exists (
    select 1 from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id and failed_slots > 0 and not retryable
  ) into v_any_non_retryable;
  select not exists (
    select 1
    from public.client_ideation_technique_runs run
    where run.ideation_cycle_id = p_cycle_id
      and (
        run.generated_slots <> jsonb_array_length(run.requested_slots)
        or run.failed_slots <> 0
        or exists (
          select 1
          from generate_series(0, jsonb_array_length(run.requested_slots) - 1) slot_index
          where not exists (
            select 1
            from public.client_ideation_candidates candidate
            where candidate.technique_run_id = run.id
              and candidate.candidate_index = slot_index
              and candidate.asset_type = run.requested_slots ->> slot_index
          )
        )
      )
  ) into v_all_slots_fulfilled;
  update public.client_ideation_cycles
  set status = case
        when v_candidate_count = expected_candidate_count
          and v_all_slots_fulfilled
          and not v_any_retryable
          and not v_any_non_retryable then 'completed'
        when v_any_non_retryable then 'failed'
        when v_any_retryable then 'retryable'
        else 'failed'
      end,
      candidate_count = v_candidate_count,
      shortfall_count = greatest(expected_candidate_count - v_candidate_count, 0),
      retryable = v_any_retryable and not v_any_non_retryable,
      technique_summary = p_run_results,
      finished_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      error_code = case
        when v_candidate_count = expected_candidate_count
          and v_all_slots_fulfilled
          and not v_any_retryable
          and not v_any_non_retryable then null
        when v_any_non_retryable then 'NON_RETRYABLE_TECHNIQUE_SHORTFALL'
        when v_any_retryable then 'RETRYABLE_TECHNIQUE_SHORTFALL'
        else 'NON_RETRYABLE_TECHNIQUE_SHORTFALL'
      end,
      error_message = case
        when v_candidate_count = expected_candidate_count
          and v_all_slots_fulfilled
          and not v_any_retryable
          and not v_any_non_retryable then null
        when v_any_non_retryable then 'A required technique has a terminal non-retryable shortfall.'
        when v_any_retryable then 'One or more techniques can be retried to fill missing candidate slots.'
        else 'The required candidate quantity could not be generated within the retry policy.'
      end
  where id = p_cycle_id
  returning * into v_cycle;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_cycle.client_id, p_actor_id,
    case v_cycle.status
      when 'completed' then 'ideation_run_completed'
      when 'retryable' then 'ideation_run_retryable'
      else 'ideation_run_failed'
    end,
    case v_cycle.status
      when 'completed' then 'Ideation generated all ' || v_candidate_count || ' required candidate ideas.'
      when 'retryable' then 'Ideation retained successful candidates and can retry ' || v_cycle.shortfall_count || ' missing ideas.'
      else 'Ideation ended with a non-retryable shortfall of ' || v_cycle.shortfall_count || ' ideas.'
    end,
    'client_ideation_cycle', v_cycle.id::text,
    jsonb_build_object(
      'candidate_count', v_candidate_count,
      'expected_candidate_count', v_cycle.expected_candidate_count,
      'shortfall_count', v_cycle.shortfall_count,
      'attempt_count', v_cycle.attempt_count
    )
  );
  return jsonb_build_object('cycle', to_jsonb(v_cycle), 'created', true);
end
$$;


ALTER FUNCTION "public"."complete_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_research_results" "jsonb", "p_candidates" "jsonb", "p_run_results" "jsonb", "p_provider" "text", "p_model" "text", "p_prompt_version" "text", "p_output_schema_version" "text", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_ranks" "jsonb", "p_warnings" "jsonb", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_run public.client_ideation_scoring_runs%rowtype;
  v_scored integer;
  v_expected_ids uuid[];
  v_scored_ids uuid[];
  v_rank_count integer;
  v_max_rank integer;
begin
  select * into v_run
  from public.client_ideation_scoring_runs
  where id = p_scoring_run_id
  for update;
  if v_run.id is null then raise exception 'SCORING_RUN_NOT_FOUND'; end if;
  if v_run.status <> 'running'
    or v_run.lease_owner <> p_lease_owner
    or v_run.lease_expires_at <= now() then
    raise exception 'SCORING_LEASE_OWNERSHIP_LOST';
  end if;

  -- Exact reconciliation, never an aggregate count: the scored candidate set
  -- must equal the immutable snapshot set exactly.
  select array_agg((value->>'candidate_id')::uuid order by value->>'candidate_id')
  into v_expected_ids
  from jsonb_array_elements(v_run.candidate_snapshot);
  select array_agg(candidate_id order by candidate_id), count(*)
  into v_scored_ids, v_scored
  from public.client_ideation_candidate_scores
  where scoring_run_id = v_run.id;

  if v_scored is null or v_scored <> v_run.expected_candidate_count then
    raise exception 'SCORING_INCOMPLETE';
  end if;
  if v_expected_ids is distinct from v_scored_ids then
    raise exception 'SCORING_CANDIDATE_RECONCILIATION_FAILED';
  end if;

  if jsonb_typeof(coalesce(p_ranks, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_ranks) <> v_run.expected_candidate_count then
    raise exception 'SCORING_RANK_PAYLOAD_INVALID';
  end if;

  -- Clear then set, so a reclaimed run cannot collide with stale ranks.
  update public.client_ideation_candidate_scores
  set rank = null
  where scoring_run_id = v_run.id;

  update public.client_ideation_candidate_scores as scores
  set rank = (payload.value->>'rank')::integer
  from jsonb_array_elements(p_ranks) as payload
  where scores.scoring_run_id = v_run.id
    and scores.candidate_id = (payload.value->>'candidate_id')::uuid;

  select count(rank), max(rank) into v_rank_count, v_max_rank
  from public.client_ideation_candidate_scores
  where scoring_run_id = v_run.id;
  if v_rank_count <> v_run.expected_candidate_count
    or v_max_rank <> v_run.expected_candidate_count then
    raise exception 'SCORING_RANK_ASSIGNMENT_INVALID';
  end if;
  if exists (
    select 1 from public.client_ideation_candidate_scores
    where scoring_run_id = v_run.id and rank < 1
  ) then
    raise exception 'SCORING_RANK_ASSIGNMENT_INVALID';
  end if;

  update public.client_ideation_scoring_runs
  set status = 'completed',
      retryable = false,
      -- Re-derived from the reconciled row count rather than trusted from an
      -- earlier statement, so the completed-run CHECK can never be satisfied by
      -- a stale counter.
      scored_candidate_count = v_scored,
      failed_candidate_count = 0,
      warnings = coalesce(p_warnings, '[]'::jsonb),
      error_code = null,
      error_message = null,
      completed_at = now(),
      failed_at = null,
      lease_owner = null,
      lease_expires_at = null
  where id = v_run.id
  returning * into v_run;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_run.client_id, p_actor_id, 'ideation_scoring_completed',
    'Ideation candidates were scored and ranked.',
    'client_ideation_scoring_run', v_run.id::text,
    jsonb_build_object(
      'ideation_cycle_id', v_run.ideation_cycle_id,
      'scored_candidates', v_run.scored_candidate_count,
      'rubric_version', v_run.rubric_version
    )
  );
  return to_jsonb(v_run);
end
$$;


ALTER FUNCTION "public"."complete_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_ranks" "jsonb", "p_warnings" "jsonb", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_performance_analysis_run"("p_run_id" "uuid", "p_records_scored" integer, "p_insights_created" integer, "p_skipped_count" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare r public.client_performance_analysis_runs; c text;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  update public.client_performance_analysis_runs set status='completed',finished_at=now(),records_scored=p_records_scored,insights_created=p_insights_created,skipped_count=p_skipped_count where id=p_run_id and status='running' returning * into r;
  if not found then raise exception 'NOT_FOUND: active analysis run'; end if;
  select name into c from public.clients where id=r.client_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(r.client_id,'performance_analysis_completed','Performance analysis completed for '||coalesce(c,'client')||'.','client_performance_analysis_run',r.id,jsonb_build_object('records_scored',p_records_scored,'insights_created',p_insights_created));
end $$;


ALTER FUNCTION "public"."complete_performance_analysis_run"("p_run_id" "uuid", "p_records_scored" integer, "p_insights_created" integer, "p_skipped_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_ai_background_prompt"("p_client_id" "uuid", "p_production_brief_id" "uuid", "p_source_ref" "text", "p_format" "text", "p_frame_index" integer DEFAULT NULL::integer, "p_operator_notes" "text" DEFAULT NULL::"text", "p_prompt_text" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_brief public.client_production_briefs; v_id uuid; v_prompt text; v_fingerprint text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into v_brief from public.client_production_briefs where id=p_production_brief_id and client_id=p_client_id;
  if not found then raise exception 'VALIDATION: production brief does not belong to client'; end if;
  if v_brief.source_ref is distinct from trim(p_source_ref) then raise exception 'VALIDATION: production brief does not belong to source ref'; end if;
  if v_brief.asset_format is distinct from p_format then raise exception 'VALIDATION: format does not match production brief'; end if;
  if v_brief.status is distinct from 'approved'::public.review_state then raise exception 'VALIDATION: production brief must be approved'; end if;
  if p_format not in ('feed_post','carousel','story_sequence') then raise exception 'VALIDATION: format is not supported for AI backgrounds'; end if;
  if p_prompt_text is not null and length(btrim(p_prompt_text))=0 then raise exception 'VALIDATION: prompt text cannot be blank'; end if;
  if p_prompt_text is null then
    v_prompt := concat_ws(E'\n',
      'Create a background image only; do not render text, logos, UI, or watermarks.',
      'Client asset: '||v_brief.title||' ('||v_brief.source_ref||').',
      'Format: '||p_format||case when p_frame_index is null then '.' else ', frame '||p_frame_index||'.' end,
      'Use the approved production brief as creative direction while preserving clear space and contrast for later typography.',
      left(v_brief.content_md,3000),
      case when nullif(trim(p_operator_notes),'') is null then null else 'Operator notes: '||trim(p_operator_notes) end
    );
  else
    v_prompt := btrim(p_prompt_text);
  end if;
  v_fingerprint := md5(concat_ws(E'\n',v_brief.title,v_brief.source_ref,v_brief.asset_format,v_brief.content_md,v_brief.version::text));
  insert into public.client_ai_background_image_generations(client_id,production_brief_id,source_ref,format,frame_index,prompt_text,prompt_created_by,brief_fingerprint_at_prompt)
  values(p_client_id,p_production_brief_id,trim(p_source_ref),p_format,p_frame_index,v_prompt,case when auth.role()='service_role' then 'system' else auth.uid()::text end,v_fingerprint)
  returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(p_client_id,'ai_background_prompt_created','AI background prompt draft created for '||trim(p_source_ref)||'.','client_ai_background_image_generation',v_id,jsonb_build_object('source_ref',trim(p_source_ref),'format',p_format,'frame_index',p_frame_index));
  return v_id;
end $$;


ALTER FUNCTION "public"."create_ai_background_prompt"("p_client_id" "uuid", "p_production_brief_id" "uuid", "p_source_ref" "text", "p_format" "text", "p_frame_index" integer, "p_operator_notes" "text", "p_prompt_text" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_ai_background_prompt"("p_client_id" "uuid", "p_production_brief_id" "uuid", "p_source_ref" "text", "p_format" "text", "p_frame_index" integer, "p_operator_notes" "text", "p_prompt_text" "text") IS 'Creates a deterministic prompt when prompt text is NULL; rejects explicitly blank prompt text and preserves approved-brief ownership and fingerprint validation.';



CREATE OR REPLACE FUNCTION "public"."create_bound_reel_video_project"("p_client_id" "uuid", "p_source_table" "text", "p_source_row_id" "uuid", "p_client_production_brief_id" "uuid", "p_title" "text", "p_archetype" "text", "p_awareness_stage" "text", "p_target_duration_sec" integer, "p_brand_prompt_block_id" "uuid", "p_created_by" "uuid") RETURNS "public"."video_projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_brief public.client_production_briefs;
  v_brand public.brand_prompt_blocks;
  v_project public.video_projects;
  v_source_client_id uuid;
begin
  select *
    into v_brief
    from public.client_production_briefs
   where id = p_client_production_brief_id
   for share;

  if not found then
    raise exception 'REEL_BRIEF_NOT_FOUND: Production brief does not exist.';
  end if;
  if v_brief.client_id is distinct from p_client_id then
    raise exception 'REEL_BRIEF_CLIENT_MISMATCH: Production brief does not belong to client_id.';
  end if;
  if v_brief.status is distinct from 'approved'::public.review_state then
    raise exception 'REEL_BRIEF_NOT_APPROVED: Production brief must be approved.';
  end if;
  if v_brief.asset_format is distinct from 'reel_video' then
    raise exception 'REEL_BRIEF_FORMAT_MISMATCH: Production brief must have asset_format reel_video.';
  end if;
  if v_brief.source_table is distinct from p_source_table then
    raise exception 'REEL_BRIEF_SOURCE_TABLE_MISMATCH: Production brief source_table does not match.';
  end if;
  if v_brief.source_row_id is distinct from p_source_row_id then
    raise exception 'REEL_BRIEF_SOURCE_ROW_MISMATCH: Production brief source_row_id does not match.';
  end if;

  if p_source_table = 'organic_master' then
    select client_id into v_source_client_id from public.organic_master where id = p_source_row_id;
  elsif p_source_table = 'ads_master' then
    select client_id into v_source_client_id from public.ads_master where id = p_source_row_id;
  else
    raise exception 'REEL_SOURCE_TABLE_INVALID: source_table must be organic_master or ads_master.';
  end if;

  if v_source_client_id is null then
    raise exception 'REEL_SOURCE_NOT_FOUND: Source row does not exist.';
  end if;
  if v_source_client_id is distinct from p_client_id then
    raise exception 'REEL_SOURCE_CLIENT_MISMATCH: Source row does not belong to client_id.';
  end if;

  select *
    into v_brand
    from public.brand_prompt_blocks
   where id = p_brand_prompt_block_id;
  if not found then
    raise exception 'REEL_BRAND_NOT_FOUND: Brand prompt block does not exist.';
  end if;

  insert into public.video_projects (
    client_id,
    organic_master_id,
    ads_master_id,
    client_production_brief_id,
    archetype,
    awareness_stage,
    target_duration_sec,
    brand_prompt_block_id,
    brand_prompt_block_version,
    title,
    created_by
  )
  values (
    p_client_id,
    case when p_source_table = 'organic_master' then p_source_row_id else null end,
    case when p_source_table = 'ads_master' then p_source_row_id else null end,
    p_client_production_brief_id,
    p_archetype,
    p_awareness_stage,
    p_target_duration_sec,
    p_brand_prompt_block_id,
    v_brand.version,
    btrim(p_title),
    p_created_by
  )
  returning * into v_project;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_bound_project_created',
    'Reel Studio project created from approved production brief.',
    'video_project',
    v_project.id,
    jsonb_build_object(
      'video_project_id', v_project.id,
      'production_brief_id', p_client_production_brief_id,
      'source_table', p_source_table,
      'source_row_id', p_source_row_id
    )
  );

  return v_project;
end;
$$;


ALTER FUNCTION "public"."create_bound_reel_video_project"("p_client_id" "uuid", "p_source_table" "text", "p_source_row_id" "uuid", "p_client_production_brief_id" "uuid", "p_title" "text", "p_archetype" "text", "p_awareness_stage" "text", "p_target_duration_sec" integer, "p_brand_prompt_block_id" "uuid", "p_created_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_context_patch_draft"("p_client_id" "uuid", "p_context_update_proposal_id" "uuid", "p_proposal_item_id" "uuid", "p_target_file_id" "uuid", "p_target_section" "text", "p_patch_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_current_state_summary" "text", "p_proposed_change_summary" "text", "p_proposed_content" "text", "p_proposed_diff" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_id uuid;
  v_proposal public.client_context_update_proposals;
  v_item public.client_context_update_proposal_items;
  v_file public.client_context_files;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  if p_created_from not in ('context_update_proposal','manual') then raise exception 'VALIDATION: invalid created_from'; end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: evidence must be an object'; end if;

  select * into v_proposal from public.client_context_update_proposals
    where id=p_context_update_proposal_id and client_id=p_client_id;
  if not found then raise exception 'VALIDATION: context update proposal does not belong to client'; end if;
  if v_proposal.status <> 'approved' then raise exception 'VALIDATION: context update proposal must be approved'; end if;

  if p_proposal_item_id is not null then
    select * into v_item from public.client_context_update_proposal_items
      where id=p_proposal_item_id and proposal_id=v_proposal.id and client_id=p_client_id;
    if not found then raise exception 'VALIDATION: proposal item does not belong to proposal'; end if;
    if v_item.target_file_id is not null and v_item.target_file_id <> p_target_file_id then
      raise exception 'VALIDATION: proposal item does not belong to target context file';
    end if;
  end if;

  select * into v_file from public.client_context_files where id=p_target_file_id and client_id=p_client_id for share;
  if not found then raise exception 'VALIDATION: target context file does not belong to client'; end if;

  insert into public.client_context_patch_drafts(
    client_id,context_update_proposal_id,proposal_item_id,target_file_id,target_file_name,target_file_path,target_section,
    patch_type,title,summary,rationale,current_state_summary,proposed_change_summary,base_file_version,base_content_hash,
    proposed_content,proposed_diff,evidence,confidence,priority,status,created_from,created_by
  ) values (
    p_client_id,v_proposal.id,p_proposal_item_id,v_file.id,v_file.file_name,v_file.storage_path,nullif(trim(p_target_section),''),
    p_patch_type,trim(p_title),trim(p_summary),trim(p_rationale),nullif(trim(p_current_state_summary),''),trim(p_proposed_change_summary),
    v_file.version,md5(coalesce(v_file.content_md,'')),nullif(p_proposed_content,''),nullif(p_proposed_diff,''),coalesce(p_evidence,'{}'::jsonb),
    p_confidence,p_priority,'draft',p_created_from,case when auth.role()='service_role' then 'system' else 'operator' end
  ) returning id into v_id;

  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(p_client_id,'context_patch_draft_created','Context patch draft created for '||v_file.file_name||'.','client_context_patch_draft',v_id,
    jsonb_build_object('proposal_id',v_proposal.id,'proposal_item_id',p_proposal_item_id,'target_file_id',v_file.id,'base_file_version',v_file.version));
  return v_id;
end $$;


ALTER FUNCTION "public"."create_context_patch_draft"("p_client_id" "uuid", "p_context_update_proposal_id" "uuid", "p_proposal_item_id" "uuid", "p_target_file_id" "uuid", "p_target_section" "text", "p_patch_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_current_state_summary" "text", "p_proposed_change_summary" "text", "p_proposed_content" "text", "p_proposed_diff" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_context_patch_draft"("p_client_id" "uuid", "p_context_update_proposal_id" "uuid", "p_proposal_item_id" "uuid", "p_target_file_id" "uuid", "p_target_section" "text", "p_patch_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_current_state_summary" "text", "p_proposed_change_summary" "text", "p_proposed_content" "text", "p_proposed_diff" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") IS 'Creates a draft and captures current context file version/hash without editing the file.';



CREATE OR REPLACE FUNCTION "public"."create_context_update_proposal"("p_client_id" "uuid", "p_iteration_candidate_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_proposal_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text", "p_proposal_items" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_id uuid;
  v_candidate public.client_iteration_candidates;
  v_distribution public.client_distribution_records;
  v_source text := nullif(trim(p_source_ref),'');
  v_distribution_id uuid := p_distribution_record_id;
  v_item jsonb;
  v_target_file_id uuid;
  v_target_file public.client_context_files;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  if p_created_from not in ('iteration_candidate','manual') then raise exception 'VALIDATION: invalid created_from'; end if;
  if p_created_from = 'iteration_candidate' and p_iteration_candidate_id is null then raise exception 'VALIDATION: approved iteration candidate required'; end if;
  if p_created_from = 'manual' and p_iteration_candidate_id is not null then raise exception 'VALIDATION: manual proposal cannot link an iteration candidate'; end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: evidence must be an object'; end if;
  if jsonb_typeof(coalesce(p_proposal_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_proposal_items,'[]'::jsonb)) = 0 then
    raise exception 'VALIDATION: at least one proposal item is required';
  end if;

  if p_iteration_candidate_id is not null then
    select * into v_candidate from public.client_iteration_candidates where id = p_iteration_candidate_id and client_id = p_client_id;
    if not found then raise exception 'VALIDATION: iteration candidate does not belong to client'; end if;
    if v_candidate.status <> 'approved' then raise exception 'VALIDATION: iteration candidate must be approved'; end if;
    if v_distribution_id is not null and v_candidate.distribution_record_id is distinct from v_distribution_id then raise exception 'VALIDATION: iteration candidate does not belong to distribution record'; end if;
    if v_source is not null and v_candidate.source_ref is distinct from v_source then raise exception 'VALIDATION: iteration candidate does not belong to source ref'; end if;
    v_distribution_id := coalesce(v_distribution_id,v_candidate.distribution_record_id);
    v_source := coalesce(v_source,v_candidate.source_ref);
  end if;

  if v_distribution_id is not null then
    select * into v_distribution from public.client_distribution_records where id = v_distribution_id and client_id = p_client_id;
    if not found then raise exception 'VALIDATION: distribution record does not belong to client'; end if;
    if v_source is not null and v_distribution.source_ref is distinct from v_source then raise exception 'VALIDATION: distribution record does not belong to source ref'; end if;
    v_source := coalesce(v_source,v_distribution.source_ref);
  end if;

  insert into public.client_context_update_proposals(
    client_id,iteration_candidate_id,source_ref,distribution_record_id,proposal_type,title,summary,rationale,evidence,
    confidence,priority,status,created_from,created_by
  ) values (
    p_client_id,p_iteration_candidate_id,v_source,v_distribution_id,p_proposal_type,trim(p_title),trim(p_summary),trim(p_rationale),coalesce(p_evidence,'{}'::jsonb),
    p_confidence,p_priority,'needs_review',p_created_from,case when auth.role()='service_role' then 'system' else 'operator' end
  ) returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_proposal_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'VALIDATION: proposal item must be an object'; end if;
    if jsonb_typeof(coalesce(v_item->'evidence','{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: proposal item evidence must be an object'; end if;
    v_target_file_id := nullif(trim(v_item->>'target_file_id'),'')::uuid;
    if v_target_file_id is not null then
      select * into v_target_file from public.client_context_files where id = v_target_file_id and client_id = p_client_id;
      if not found then raise exception 'VALIDATION: target context file does not belong to client'; end if;
    else
      v_target_file := null;
    end if;
    insert into public.client_context_update_proposal_items(
      client_id,proposal_id,target_type,target_file_id,target_file_name,target_file_path,target_section,current_state_summary,
      proposed_change_summary,change_intent,evidence
    ) values (
      p_client_id,v_id,v_item->>'target_type',v_target_file_id,
      coalesce(nullif(trim(v_item->>'target_file_name'),''),v_target_file.file_name),
      coalesce(nullif(trim(v_item->>'target_file_path'),''),v_target_file.storage_path),
      nullif(trim(v_item->>'target_section'),''),nullif(trim(v_item->>'current_state_summary'),''),
      trim(v_item->>'proposed_change_summary'),v_item->>'change_intent',coalesce(v_item->'evidence','{}'::jsonb)
    );
  end loop;

  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(p_client_id,'context_update_proposal_created','Context update proposal created'||case when v_source is null then '.' else ' for '||v_source||'.' end,
    'client_context_update_proposal',v_id,jsonb_build_object('source_ref',v_source,'proposal_type',p_proposal_type,'iteration_candidate_id',p_iteration_candidate_id));
  return v_id;
end $$;


ALTER FUNCTION "public"."create_context_update_proposal"("p_client_id" "uuid", "p_iteration_candidate_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_proposal_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text", "p_proposal_items" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_context_update_proposal"("p_client_id" "uuid", "p_iteration_candidate_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_proposal_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text", "p_proposal_items" "jsonb") IS 'Creates proposal metadata and target summaries atomically without applying any file change.';



CREATE OR REPLACE FUNCTION "public"."create_iteration_candidate"("p_client_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_performance_score_id" "uuid", "p_performance_insight_id" "uuid", "p_candidate_type" "text", "p_recommendation" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_id uuid; d public.client_distribution_records; s public.client_performance_scores; i public.client_performance_insights; v_source text:=nullif(trim(p_source_ref),''); v_distribution uuid:=p_distribution_record_id;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  if p_created_from='performance_score' and p_performance_score_id is null then raise exception 'VALIDATION: performance score required'; end if;
  if p_created_from='performance_insight' and p_performance_insight_id is null then raise exception 'VALIDATION: performance insight required'; end if;
  if v_distribution is not null then select * into d from public.client_distribution_records where id=v_distribution and client_id=p_client_id; if not found then raise exception 'VALIDATION: distribution record does not belong to client'; end if; v_source:=coalesce(v_source,d.source_ref); end if;
  if p_performance_score_id is not null then
    select * into s from public.client_performance_scores where id=p_performance_score_id and client_id=p_client_id; if not found then raise exception 'VALIDATION: performance score does not belong to client'; end if;
    if v_distribution is not null and s.distribution_record_id<>v_distribution then raise exception 'VALIDATION: performance score does not belong to distribution record'; end if;
    if v_source is not null and s.source_ref<>v_source then raise exception 'VALIDATION: performance score does not belong to source ref'; end if;
    v_distribution:=coalesce(v_distribution,s.distribution_record_id); v_source:=coalesce(v_source,s.source_ref);
  end if;
  if p_performance_insight_id is not null then
    select * into i from public.client_performance_insights where id=p_performance_insight_id and client_id=p_client_id; if not found then raise exception 'VALIDATION: performance insight does not belong to client'; end if;
    if v_distribution is not null and i.distribution_record_id is distinct from v_distribution then raise exception 'VALIDATION: performance insight does not belong to distribution record'; end if;
    if v_source is not null and i.source_ref is distinct from v_source then raise exception 'VALIDATION: performance insight does not belong to source ref'; end if;
    v_distribution:=coalesce(v_distribution,i.distribution_record_id); v_source:=coalesce(v_source,i.source_ref);
  end if;
  insert into public.client_iteration_candidates(client_id,source_ref,distribution_record_id,performance_score_id,performance_insight_id,candidate_type,recommendation,rationale,evidence,confidence,priority,created_by,created_from)
  values(p_client_id,v_source,v_distribution,p_performance_score_id,p_performance_insight_id,p_candidate_type,trim(p_recommendation),trim(p_rationale),coalesce(p_evidence,'{}'::jsonb),p_confidence,p_priority,case when auth.role()='service_role' then 'system' else 'operator' end,p_created_from)
  returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(p_client_id,'iteration_candidate_created','Iteration candidate created'||case when v_source is null then '.' else ' for '||v_source||'.' end,'client_iteration_candidate',v_id,jsonb_build_object('source_ref',v_source,'candidate_type',p_candidate_type));
  return v_id;
end $$;


ALTER FUNCTION "public"."create_iteration_candidate"("p_client_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_performance_score_id" "uuid", "p_performance_insight_id" "uuid", "p_candidate_type" "text", "p_recommendation" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_performance_insight"("p_distribution_record_id" "uuid", "p_insight_type" "text", "p_severity" "text", "p_confidence" "text", "p_title" "text", "p_summary" "text", "p_evidence" "jsonb", "p_recommended_action" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d public.client_distribution_records; v_id uuid;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into d from public.client_distribution_records where id=p_distribution_record_id and publish_status='published'; if not found then raise exception 'REFUSED: published record required'; end if;
  select id into v_id from public.client_performance_insights where distribution_record_id=d.id and insight_type=p_insight_type and title=trim(p_title) and status='open';
  if v_id is not null then return v_id; end if;
  insert into public.client_performance_insights(client_id,distribution_record_id,source_ref,insight_type,severity,confidence,title,summary,evidence,recommended_action,created_by)
  values(d.client_id,d.id,d.source_ref,p_insight_type,p_severity,p_confidence,trim(p_title),trim(p_summary),coalesce(p_evidence,'{}'::jsonb),nullif(trim(p_recommended_action),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end) returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(d.client_id,'performance_signal_detected','Performance signal detected for '||d.source_ref||'.','client_performance_insight',v_id,jsonb_build_object('source_ref',d.source_ref,'insight_type',p_insight_type));
  return v_id;
end $$;


ALTER FUNCTION "public"."create_performance_insight"("p_distribution_record_id" "uuid", "p_insight_type" "text", "p_severity" "text", "p_confidence" "text", "p_title" "text", "p_summary" "text", "p_evidence" "jsonb", "p_recommended_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_reel_distribution_draft"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") RETURNS "public"."client_distribution_records"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_deliverable public.video_project_deliverables;
  v_existing public.client_distribution_records;
  v_group_ref text;
  v_row public.client_distribution_records;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;

  select * into v_deliverable
    from public.video_project_deliverables
   where id = p_deliverable_id and video_project_id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_DELIVERABLE_NOT_FOUND: Final Reel does not belong to this project.';
  end if;
  if v_project.current_deliverable_id is distinct from p_deliverable_id or not v_deliverable.is_current then
    raise exception 'REEL_DELIVERABLE_NOT_CURRENT: Only the project''s current final Reel can be distributed.';
  end if;
  if v_deliverable.upload_state is distinct from 'uploaded' then
    raise exception 'REEL_DELIVERABLE_NOT_UPLOADED: This version has no completed upload.';
  end if;
  if v_deliverable.status is distinct from 'approved'::public.review_state then
    raise exception 'REEL_DELIVERABLE_NOT_APPROVED: The final Reel must be approved before a distribution draft can be created.';
  end if;

  -- Idempotent: an existing active record for this exact version is returned.
  select * into v_existing
    from public.client_distribution_records
   where video_deliverable_id = p_deliverable_id
     and publish_status in ('ready', 'scheduled', 'publishing', 'published', 'needs_reconciliation')
   limit 1;
  if found then
    return v_existing;
  end if;

  v_group_ref := p_source_ref || '-final-reel-v' || v_deliverable.version::text;

  insert into public.client_distribution_records (
    client_id, execution_month, source_ref, asset_group_ref, sequence_index, sequence_count,
    production_brief_id, asset_format, title, publish_status, platform, planned_publish_date,
    publish_payload, publish_settings, video_project_id, video_deliverable_id
  ) values (
    p_client_id, p_execution_month, p_source_ref, v_group_ref, 1, 1,
    v_deliverable.client_production_brief_id, 'reel_video', p_title, 'ready', 'instagram', p_planned_date,
    coalesce(p_publish_payload, '{}'::jsonb), coalesce(p_publish_settings, '{}'::jsonb),
    p_video_project_id, p_deliverable_id
  )
  returning * into v_row;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id, 'reel_studio_distribution_draft_created',
    p_source_ref || ': distribution draft created from approved final Reel v' || v_deliverable.version::text || '.',
    'client_distribution_record', v_row.id,
    jsonb_build_object(
      'distribution_record_id', v_row.id, 'video_project_id', p_video_project_id,
      'deliverable_id', p_deliverable_id, 'version', v_deliverable.version,
      'production_brief_id', v_deliverable.client_production_brief_id, 'source_ref', p_source_ref
    )
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_reel_distribution_draft"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_shot public.video_shots;
begin
  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
     and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;

  select *
    into v_shot
    from public.video_shots
   where id = p_shot_id
     and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.status is distinct from 'pending'
     or v_shot.still_image_job_id is not null
     or v_shot.still_image_url is not null
     or v_shot.higgsfield_job_id is not null
     or v_shot.clip_url is not null then
    raise exception 'REEL_SHOT_NOT_PENDING: Only a pending shot with no media job or object can be deleted.';
  end if;

  delete from public.video_shots where id = p_shot_id;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_shot_deleted',
    'One pending Reel Studio shot was deleted.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'production_brief_id', v_project.client_production_brief_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number
    )
  );

  return p_shot_id;
end;
$$;


ALTER FUNCTION "public"."delete_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select public.distribution_publication_supported(p_asset_format, p_publish_settings, p_publish_payload, null::uuid);
$$;


ALTER FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb", "p_video_deliverable_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_content_type text := upper(coalesce(p_publish_settings ->> 'content_type', 'IMAGE'));
  v_deliverable public.video_project_deliverables;
begin
  if v_content_type = 'REELS' or p_asset_format = 'reel_video' then
    if p_video_deliverable_id is null then
      return 'Individual Reel Studio shot clips cannot be published. Upload the finished edit to the Reel Studio project, approve it, and publish that instead.';
    end if;
    select * into v_deliverable from public.video_project_deliverables where id = p_video_deliverable_id;
    if not found then
      return 'The linked final Reel no longer exists.';
    end if;
    if v_deliverable.upload_state is distinct from 'uploaded' then
      return 'The linked final Reel has no completed upload.';
    end if;
    if not v_deliverable.is_current or v_deliverable.superseded_at is not null then
      return 'This final Reel version has been superseded by a newer upload; only the current version can be published.';
    end if;
    if v_deliverable.status is distinct from 'approved'::public.review_state then
      return 'The final Reel must be approved before it can be scheduled or published.';
    end if;
    if v_deliverable.mime_type is distinct from 'video/mp4' then
      return 'An Instagram Reel must be an MP4 video.';
    end if;
    return null;
  end if;

  if v_content_type not in ('IMAGE', 'CAROUSEL', 'STORIES') then
    return 'Content type ' || v_content_type || ' is not supported by the current publisher.';
  end if;
  if p_asset_format not in ('feed_post', 'carousel', 'story_sequence', 'ad_static') then
    return 'Asset format ' || p_asset_format || ' is not supported by the current publisher.';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_publish_payload -> 'media', '[]'::jsonb)) item
     where lower(coalesce(item ->> 'mime_type', '')) like 'video/%'
  ) then
    return 'Video publishing is not implemented; only image posts, image carousels and image Stories can be published.';
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb", "p_video_deliverable_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."edit_ideation_proposal_assignment"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_action" "text", "p_from_slot_key" "text", "p_to_slot_key" "text", "p_candidate_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_from public.client_ideation_calendar_proposal_slots%rowtype;
  v_to public.client_ideation_calendar_proposal_slots%rowtype;
  v_candidate public.client_ideation_candidates%rowtype;
  v_score public.client_ideation_candidate_scores%rowtype;
begin
  if p_action not in ('move','swap','unassign','assign') then
    raise exception 'PROPOSAL_EDIT_ACTION_INVALID';
  end if;
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.client_id <> p_client_id then raise exception 'PROPOSAL_CLIENT_MISMATCH'; end if;
  if v_proposal.status <> 'draft' then raise exception 'PROPOSAL_NOT_EDITABLE'; end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'PROPOSAL_EDIT_REVISION_CONFLICT';
  end if;

  if p_action in ('move','swap','unassign') then
    select * into v_from from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and proposal_slot_key = p_from_slot_key for update;
    if v_from.id is null then raise exception 'PROPOSAL_SLOT_NOT_FOUND'; end if;
    if v_from.candidate_id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_ASSIGNED'; end if;
  end if;
  if p_action in ('move','swap','assign') then
    select * into v_to from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and proposal_slot_key = p_to_slot_key for update;
    if v_to.id is null then raise exception 'PROPOSAL_SLOT_NOT_FOUND'; end if;
  end if;

  if p_action = 'move' then
    -- Type incompatibility is reported before occupancy: it is the more
    -- fundamental reason the move can never succeed.
    if v_from.candidate_asset_type_snapshot <> v_to.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;
    if v_to.candidate_id is not null then raise exception 'PROPOSAL_SLOT_ALREADY_OCCUPIED'; end if;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_from.candidate_id, candidate_score_id = v_from.candidate_score_id,
      candidate_asset_type_snapshot = v_from.candidate_asset_type_snapshot,
      candidate_content_hash = v_from.candidate_content_hash,
      candidate_rank_snapshot = v_from.candidate_rank_snapshot,
      candidate_score_snapshot = v_from.candidate_score_snapshot,
      candidate_display_reference = v_from.candidate_display_reference,
      placement_rationale = v_from.placement_rationale,
      authority_references = v_from.authority_references,
      evidence_references = v_from.evidence_references,
      slot_warnings = v_from.slot_warnings,
      placement_source = 'manual', manually_edited = true
    where id = v_to.id;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = null, candidate_score_id = null, candidate_asset_type_snapshot = null,
      candidate_content_hash = null, candidate_rank_snapshot = null,
      candidate_score_snapshot = null, candidate_display_reference = null,
      placement_rationale = null, authority_references = '[]'::jsonb,
      evidence_references = '[]'::jsonb, slot_warnings = '[]'::jsonb,
      placement_source = null, manually_edited = true
    where id = v_from.id;

  elsif p_action = 'swap' then
    if v_to.candidate_id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_ASSIGNED'; end if;
    if v_from.candidate_asset_type_snapshot <> v_to.required_asset_type
      or v_to.candidate_asset_type_snapshot <> v_from.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;
    -- Park the source slot so the (proposal_id, candidate_id) uniqueness never
    -- transiently collides mid-swap.
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = null, candidate_score_id = null, candidate_asset_type_snapshot = null,
      candidate_content_hash = null, candidate_rank_snapshot = null, candidate_score_snapshot = null,
      candidate_display_reference = null, placement_rationale = null,
      authority_references = '[]'::jsonb, evidence_references = '[]'::jsonb,
      slot_warnings = '[]'::jsonb, placement_source = null
    where id = v_from.id;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_from.candidate_id, candidate_score_id = v_from.candidate_score_id,
      candidate_asset_type_snapshot = v_from.candidate_asset_type_snapshot,
      candidate_content_hash = v_from.candidate_content_hash,
      candidate_rank_snapshot = v_from.candidate_rank_snapshot,
      candidate_score_snapshot = v_from.candidate_score_snapshot,
      candidate_display_reference = v_from.candidate_display_reference,
      placement_rationale = v_from.placement_rationale,
      authority_references = v_from.authority_references,
      evidence_references = v_from.evidence_references,
      slot_warnings = v_from.slot_warnings,
      placement_source = 'manual', manually_edited = true
    where id = v_to.id;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_to.candidate_id, candidate_score_id = v_to.candidate_score_id,
      candidate_asset_type_snapshot = v_to.candidate_asset_type_snapshot,
      candidate_content_hash = v_to.candidate_content_hash,
      candidate_rank_snapshot = v_to.candidate_rank_snapshot,
      candidate_score_snapshot = v_to.candidate_score_snapshot,
      candidate_display_reference = v_to.candidate_display_reference,
      placement_rationale = v_to.placement_rationale,
      authority_references = v_to.authority_references,
      evidence_references = v_to.evidence_references,
      slot_warnings = v_to.slot_warnings,
      placement_source = 'manual', manually_edited = true
    where id = v_from.id;

  elsif p_action = 'unassign' then
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = null, candidate_score_id = null, candidate_asset_type_snapshot = null,
      candidate_content_hash = null, candidate_rank_snapshot = null, candidate_score_snapshot = null,
      candidate_display_reference = null, placement_rationale = null,
      authority_references = '[]'::jsonb, evidence_references = '[]'::jsonb,
      slot_warnings = '[]'::jsonb, placement_source = null, manually_edited = true
    where id = v_from.id;

  else -- assign
    if v_to.candidate_id is not null then raise exception 'PROPOSAL_SLOT_ALREADY_OCCUPIED'; end if;
    if exists (select 1 from public.client_ideation_calendar_proposal_slots
               where proposal_id = v_proposal.id and candidate_id = p_candidate_id) then
      raise exception 'PROPOSAL_CANDIDATE_ALREADY_ASSIGNED';
    end if;
    select * into v_candidate from public.client_ideation_candidates where id = p_candidate_id;
    if v_candidate.id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_FOUND'; end if;
    if v_candidate.client_id <> v_proposal.client_id
      or v_candidate.ideation_cycle_id <> v_proposal.ideation_cycle_id then
      raise exception 'PROPOSAL_CANDIDATE_CLIENT_MISMATCH';
    end if;
    if v_candidate.asset_type <> v_to.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;
    select * into v_score from public.client_ideation_candidate_scores
    where scoring_run_id = v_proposal.scoring_run_id and candidate_id = v_candidate.id;
    if v_score.id is null then raise exception 'PROPOSAL_SCORE_NOT_FOUND'; end if;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_candidate.id, candidate_score_id = v_score.id,
      candidate_asset_type_snapshot = v_candidate.asset_type,
      candidate_content_hash = v_score.candidate_content_hash,
      candidate_rank_snapshot = v_score.rank, candidate_score_snapshot = v_score.overall_score,
      candidate_display_reference = coalesce(
        (select value->>'display_reference' from jsonb_array_elements(v_proposal.candidate_snapshot) value
         where value->>'candidate_id' = p_candidate_id::text),
        'IDEATION/restored'),
      placement_rationale = 'Restored to this slot by an operator.',
      authority_references = '[]'::jsonb, evidence_references = '[]'::jsonb,
      slot_warnings = '[]'::jsonb, placement_source = 'restored', manually_edited = true
    where id = v_to.id;
  end if;

  update public.client_ideation_calendar_proposals
  set edit_revision = edit_revision + 1 where id = v_proposal.id;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_edited',
    'A proposed Ideation Calendar placement was edited (' || p_action || ').',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('action', p_action, 'from_slot', p_from_slot_key,
      'to_slot', p_to_slot_key, 'candidate_id', p_candidate_id,
      'edit_revision', v_proposal.edit_revision)
  );
  return to_jsonb(v_proposal);
end
$$;


ALTER FUNCTION "public"."edit_ideation_proposal_assignment"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_action" "text", "p_from_slot_key" "text", "p_to_slot_key" "text", "p_candidate_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_distribution_publish_capability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_block text;
begin
  if new.publish_status not in ('scheduled', 'publishing') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.publish_status = new.publish_status then
    return new;
  end if;

  v_block := public.distribution_publication_supported(
    new.asset_format, new.publish_settings, new.publish_payload, new.video_deliverable_id);
  if v_block is null then
    return new;
  end if;

  raise exception 'UNSUPPORTED_PUBLICATION: %', v_block
    using errcode = 'check_violation',
          hint = 'A Reel can only be scheduled from an approved, current final Reel uploaded to its Reel Studio project.';
end;
$$;


ALTER FUNCTION "public"."enforce_distribution_publish_capability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_failure_code" "text", "p_failure_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_retryable boolean;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'running' or v_proposal.lease_owner <> p_lease_owner
    or v_proposal.lease_expires_at <= now() then
    raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST';
  end if;
  v_retryable := coalesce(p_retryable, false) and v_proposal.attempt_count < v_proposal.maximum_attempts;

  update public.client_ideation_calendar_proposals
  set status = case when v_retryable then 'retryable' else 'failed' end,
      retryable = v_retryable, warnings = coalesce(p_warnings, '[]'::jsonb),
      failure_code = p_failure_code, failure_message = left(p_failure_message, 2000),
      failed_at = case when v_retryable then null else now() end,
      lease_owner = null, lease_expires_at = null
  where id = v_proposal.id returning * into v_proposal;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id,
    case when v_retryable then 'ideation_calendar_proposal_retryable' else 'ideation_calendar_proposal_failed' end,
    'Proposed Ideation Calendar did not complete: ' || left(coalesce(p_failure_message, 'unknown'), 500),
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('failure_code', p_failure_code, 'attempt_count', v_proposal.attempt_count)
  );
  return to_jsonb(v_proposal);
end
$$;


ALTER FUNCTION "public"."fail_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_failure_code" "text", "p_failure_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
begin
  select * into v_cycle
  from public.client_ideation_cycles
  where id = p_cycle_id
  for update;
  if v_cycle.id is null then raise exception 'RUN_NOT_FOUND'; end if;
  if v_cycle.status <> 'running'
    or v_cycle.lease_owner <> p_lease_owner
    or v_cycle.lease_expires_at <= now() then
    raise exception 'LEASE_OWNERSHIP_LOST';
  end if;
  update public.client_ideation_technique_runs
  set status = 'failed', error_code = p_error_code,
      error_message = left(p_error_message, 2000), finished_at = now(),
      retryable = false
  where ideation_cycle_id = p_cycle_id and status = 'running';
  update public.client_ideation_cycles
  set status = 'failed', retryable = false,
      error_code = p_error_code, error_message = left(p_error_message, 2000),
      finished_at = now(), lease_owner = null, lease_expires_at = null
  where id = p_cycle_id
  returning * into v_cycle;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_cycle.client_id, p_actor_id, 'ideation_run_failed',
    'Ideation generation failed: ' || left(p_error_message, 500),
    'client_ideation_cycle', v_cycle.id::text,
    jsonb_build_object('error_code', p_error_code, 'attempt_count', v_cycle.attempt_count)
  );
  return to_jsonb(v_cycle);
end
$$;


ALTER FUNCTION "public"."fail_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_run public.client_ideation_scoring_runs%rowtype;
  v_scored integer;
  v_retryable boolean;
begin
  select * into v_run
  from public.client_ideation_scoring_runs
  where id = p_scoring_run_id
  for update;
  if v_run.id is null then raise exception 'SCORING_RUN_NOT_FOUND'; end if;
  if v_run.status <> 'running'
    or v_run.lease_owner <> p_lease_owner
    or v_run.lease_expires_at <= now() then
    raise exception 'SCORING_LEASE_OWNERSHIP_LOST';
  end if;

  select count(*) into v_scored
  from public.client_ideation_candidate_scores
  where scoring_run_id = v_run.id;

  -- A run is only retryable while attempts remain. Attempt 3 is terminal.
  v_retryable := coalesce(p_retryable, false) and v_run.attempt_count < v_run.maximum_attempts;

  update public.client_ideation_scoring_runs
  set status = case when v_retryable then 'retryable' else 'failed' end,
      retryable = v_retryable,
      scored_candidate_count = v_scored,
      failed_candidate_count = greatest(v_run.expected_candidate_count - v_scored, 0),
      warnings = coalesce(p_warnings, '[]'::jsonb),
      error_code = p_error_code,
      error_message = left(p_error_message, 2000),
      failed_at = case when v_retryable then null else now() end,
      completed_at = null,
      lease_owner = null,
      lease_expires_at = null
  where id = v_run.id
  returning * into v_run;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_run.client_id, p_actor_id,
    case when v_retryable then 'ideation_scoring_retryable' else 'ideation_scoring_failed' end,
    'Ideation scoring did not complete: ' || left(coalesce(p_error_message, 'unknown'), 500),
    'client_ideation_scoring_run', v_run.id::text,
    jsonb_build_object(
      'error_code', p_error_code,
      'attempt_count', v_run.attempt_count,
      'scored_candidates', v_scored
    )
  );
  return to_jsonb(v_run);
end
$$;


ALTER FUNCTION "public"."fail_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_ai_background_image_generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "production_brief_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "format" "text" NOT NULL,
    "frame_index" integer,
    "prompt_text" "text" NOT NULL,
    "prompt_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "prompt_created_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "prompt_approved_by" "text",
    "prompt_approved_at" timestamp with time zone,
    "brief_fingerprint_at_prompt" "text" NOT NULL,
    "brief_fingerprint_at_approval" "text",
    "image_model" "text",
    "image_size" "text",
    "image_quality" "text",
    "storage_bucket" "text",
    "storage_path" "text",
    "public_url" "text",
    "provider_response" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "generated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_request_id" "text",
    "provider_input_file_id" "text",
    "provider_status" "text",
    "provider_submitted_at" timestamp with time zone,
    "provider_checked_at" timestamp with time zone,
    "provider_completed_at" timestamp with time zone,
    "provider_expires_at" timestamp with time zone,
    "last_provider_error" "text",
    "check_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "client_ai_background_image_generations_check" CHECK ((("prompt_status" <> 'generated'::"text") OR (("storage_path" IS NOT NULL) AND ("generated_at" IS NOT NULL)))),
    CONSTRAINT "client_ai_background_image_generations_check_count_check" CHECK (("check_count" >= 0)),
    CONSTRAINT "client_ai_background_image_generations_format_check" CHECK (("format" = ANY (ARRAY['feed_post'::"text", 'carousel'::"text", 'story_sequence'::"text"]))),
    CONSTRAINT "client_ai_background_image_generations_frame_index_check" CHECK ((("frame_index" IS NULL) OR ("frame_index" > 0))),
    CONSTRAINT "client_ai_background_image_generations_prompt_status_check" CHECK (("prompt_status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'approved'::"text", 'rejected'::"text", 'generating'::"text", 'provider_submitted'::"text", 'checking'::"text", 'generated'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_ai_background_image_generations_prompt_text_check" CHECK (("length"(TRIM(BOTH FROM "prompt_text")) > 0)),
    CONSTRAINT "client_ai_background_image_generations_provider_response_check" CHECK (("jsonb_typeof"("provider_response") = 'object'::"text")),
    CONSTRAINT "client_ai_background_image_generations_source_ref_check" CHECK (("length"(TRIM(BOTH FROM "source_ref")) > 0))
);


ALTER TABLE "public"."client_ai_background_image_generations" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ai_background_image_generations" IS 'Human-reviewed prompt and durable generated background metadata. Generated images do not start final asset generation or publishing.';



CREATE OR REPLACE FUNCTION "public"."generate_ai_background_image"("p_generation_id" "uuid", "p_client_id" "uuid", "p_image_size" "text" DEFAULT NULL::"text", "p_image_quality" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."client_ai_background_image_generations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'AUTH: service role required'; end if;
  return query update public.client_ai_background_image_generations
    set prompt_status='generating',image_size=nullif(trim(p_image_size),''),
      image_quality=nullif(trim(p_image_quality),''),error_message=null,updated_at=now()
    where id=p_generation_id and client_id=p_client_id and prompt_status='approved'
      and production_brief_id is not null and brief_fingerprint_at_approval is not null
      and exists(select 1 from public.client_production_briefs b where b.id=client_ai_background_image_generations.production_brief_id and b.client_id=client_ai_background_image_generations.client_id and b.source_ref=client_ai_background_image_generations.source_ref and b.asset_format=client_ai_background_image_generations.format and b.status='approved'::public.review_state and md5(concat_ws(E'\n',b.title,b.source_ref,b.asset_format,b.content_md,b.version::text))=client_ai_background_image_generations.brief_fingerprint_at_approval)
      and not exists(select 1 from public.client_ai_background_image_generations x where x.id<>p_generation_id and x.client_id=client_ai_background_image_generations.client_id and x.production_brief_id=client_ai_background_image_generations.production_brief_id and coalesce(x.frame_index,0)=coalesce(client_ai_background_image_generations.frame_index,0) and x.prompt_status='generating')
    returning *;
  if not found then raise exception 'STALE_BRIEF: prompt must be approved, current, client-owned, and have no active generation; create or re-approve a fresh prompt'; end if;
end $$;


ALTER FUNCTION "public"."generate_ai_background_image"("p_generation_id" "uuid", "p_client_id" "uuid", "p_image_size" "text", "p_image_quality" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."generate_ai_background_image"("p_generation_id" "uuid", "p_client_id" "uuid", "p_image_size" "text", "p_image_quality" "text") IS 'Service-role atomic claim that revalidates client ownership, approved production brief state, and the approval-time brief fingerprint before provider work.';



CREATE OR REPLACE FUNCTION "public"."generate_ref"("p_client_id" "uuid", "p_month_code" "text", "p_channel" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.ref_counters (client_id, month, channel, current_count)
  VALUES (p_client_id, p_month_code, p_channel, 1)
  ON CONFLICT (client_id, month, channel)
  DO UPDATE SET current_count = ref_counters.current_count + 1
  RETURNING current_count INTO v_count;
  RETURN p_month_code || '-' || p_channel || '-' || LPAD(v_count::text, 3, '0');
END;
$$;


ALTER FUNCTION "public"."generate_ref"("p_client_id" "uuid", "p_month_code" "text", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ideation_commit_target"("p_asset_type" "text") RETURNS TABLE("type_code" "text", "master_table" "text", "calendar_row_type" "text")
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select t.type_code, t.master_table, t.calendar_row_type
  from (values
    ('reel',     'RL', 'organic_master', 'reel'),
    ('carousel', 'CR', 'organic_master', 'carousels'),
    ('static',   'FP', 'organic_master', 'feed_posts'),
    ('story',    'ST', 'story_master',   'stories')
  ) as t(asset_type, type_code, master_table, calendar_row_type)
  where t.asset_type = p_asset_type;
$$;


ALTER FUNCTION "public"."ideation_commit_target"("p_asset_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ideation_commit_target"("p_asset_type" "text") IS 'aa.ideation.commit-targets.v1 — Ideation asset type to operational master and Calendar lane. Never maps to ads_master.';



CREATE TABLE IF NOT EXISTS "public"."video_shots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "video_project_id" "uuid" NOT NULL,
    "shot_number" integer NOT NULL,
    "beat_description" "text" NOT NULL,
    "compiled_prompt" "text" NOT NULL,
    "shot_class" "text" NOT NULL,
    "human_presence" "text" DEFAULT 'none'::"text" NOT NULL,
    "model" "text",
    "render_tier" "text" DEFAULT 'draft'::"text" NOT NULL,
    "higgsfield_job_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "clip_url" "text",
    "source_url" "text",
    "duration_sec" numeric(5,2),
    "credits_spent" integer DEFAULT 0 NOT NULL,
    "approved_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "still_image_url" "text",
    "still_image_job_id" "text",
    "still_image_model" "text",
    "motion_type" "text",
    "motion_strength" numeric(3,2),
    "failure_stage" "text",
    "failed_at" timestamp with time zone,
    "still_attempt_count" integer DEFAULT 0 NOT NULL,
    "video_attempt_count" integer DEFAULT 0 NOT NULL,
    "last_still_attempt_at" timestamp with time zone,
    "last_video_attempt_at" timestamp with time zone,
    "story_role" "text",
    "narrative_beat" "text",
    "message_supported" "text",
    "transition_from_previous" "text",
    "transition_to_next" "text",
    "visual_continuity" "jsonb",
    "emotional_intent" "text",
    CONSTRAINT "video_shots_beat_description_check" CHECK (("btrim"("beat_description") <> ''::"text")),
    CONSTRAINT "video_shots_compiled_prompt_check" CHECK (("btrim"("compiled_prompt") <> ''::"text")),
    CONSTRAINT "video_shots_credits_spent_check" CHECK (("credits_spent" >= 0)),
    CONSTRAINT "video_shots_duration_sec_check" CHECK ((("duration_sec" IS NULL) OR ("duration_sec" > (0)::numeric))),
    CONSTRAINT "video_shots_failure_stage_check" CHECK ((("failure_stage" IS NULL) OR ("failure_stage" = ANY (ARRAY['still_submit'::"text", 'still_render'::"text", 'still_download'::"text", 'video_submit'::"text", 'video_render'::"text", 'video_download'::"text"])))),
    CONSTRAINT "video_shots_human_presence_check" CHECK (("human_presence" = ANY (ARRAY['none'::"text", 'hands_only'::"text"]))),
    CONSTRAINT "video_shots_motion_strength_check" CHECK ((("motion_strength" IS NULL) OR (("motion_strength" >= (0)::numeric) AND ("motion_strength" <= (1)::numeric)))),
    CONSTRAINT "video_shots_motion_type_check" CHECK ((("motion_type" IS NULL) OR ("btrim"("motion_type") <> ''::"text"))),
    CONSTRAINT "video_shots_render_tier_check" CHECK (("render_tier" = ANY (ARRAY['draft'::"text", 'final'::"text"]))),
    CONSTRAINT "video_shots_shot_class_check" CHECK (("shot_class" = ANY (ARRAY['metaphor'::"text", 'atmosphere'::"text", 'abstract'::"text"]))),
    CONSTRAINT "video_shots_shot_number_check" CHECK (("shot_number" > 0)),
    CONSTRAINT "video_shots_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'still_submitted'::"text", 'still_rendering'::"text", 'still_complete'::"text", 'submitted'::"text", 'rendering'::"text", 'complete'::"text", 'failed'::"text"]))),
    CONSTRAINT "video_shots_still_attempt_count_check" CHECK (("still_attempt_count" >= 0)),
    CONSTRAINT "video_shots_still_image_model_check" CHECK ((("still_image_model" IS NULL) OR ("btrim"("still_image_model") <> ''::"text"))),
    CONSTRAINT "video_shots_story_role_check" CHECK ((("story_role" IS NULL) OR ("story_role" = ANY (ARRAY['hook'::"text", 'problem'::"text", 'escalation'::"text", 'insight'::"text", 'proof'::"text", 'transformation'::"text", 'payoff'::"text", 'cta'::"text"])))),
    CONSTRAINT "video_shots_video_attempt_count_check" CHECK (("video_attempt_count" >= 0))
);


ALTER TABLE "public"."video_shots" OWNER TO "postgres";


COMMENT ON COLUMN "public"."video_shots"."failure_stage" IS 'Which provider phase produced the current failed status. NULL on pre-Phase-2 failures; derive with reel_shot_failure_phase().';



COMMENT ON COLUMN "public"."video_shots"."story_role" IS 'Narrative job this shot performs in the sequence. Null for shots created before the sequence-first generator.';



COMMENT ON COLUMN "public"."video_shots"."visual_continuity" IS 'JSON array of continuity anchors this frame must carry, repeated into the compiled prompt.';



CREATE OR REPLACE FUNCTION "public"."insert_reel_storyboard_if_empty"("p_video_project_id" "uuid", "p_client_id" "uuid", "p_client_production_brief_id" "uuid", "p_shots" "jsonb", "p_story_strategy" "jsonb" DEFAULT NULL::"jsonb", "p_continuity_plan" "jsonb" DEFAULT NULL::"jsonb", "p_provenance" "jsonb" DEFAULT NULL::"jsonb", "p_prompt_version" "text" DEFAULT NULL::"text", "p_model" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."video_shots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_shot_count integer;
  v_distinct_numbers integer;
  v_min_number integer;
  v_max_number integer;
begin
  if jsonb_typeof(p_shots) is distinct from 'array' then
    raise exception 'REEL_STORYBOARD_INVALID: p_shots must be a JSON array.';
  end if;

  v_shot_count := jsonb_array_length(p_shots);
  if v_shot_count < 4 or v_shot_count > 12 then
    raise exception 'REEL_STORYBOARD_INVALID: Storyboard must contain 4-12 shots.';
  end if;

  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
     and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.client_production_brief_id is distinct from p_client_production_brief_id then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Project is not bound to the supplied production brief.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Storyboard can only be generated before review.';
  end if;

  select *
    into v_brief
    from public.client_production_briefs
   where id = p_client_production_brief_id
   for share;
  if not found
     or v_brief.client_id is distinct from v_project.client_id
     or v_brief.asset_format is distinct from 'reel_video'
     or v_brief.status is distinct from 'approved'::public.review_state
     or v_brief.source_table is distinct from (
       case when v_project.organic_master_id is not null then 'organic_master' else 'ads_master' end
     )
     or v_brief.source_row_id is distinct from coalesce(v_project.organic_master_id, v_project.ads_master_id) then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Bound production brief is no longer valid for this project.';
  end if;

  if exists (select 1 from public.video_shots where video_project_id = p_video_project_id) then
    raise exception 'REEL_STORYBOARD_NOT_EMPTY: Project already has shots.';
  end if;

  select
    count(distinct (item ->> 'shot_number')::integer),
    min((item ->> 'shot_number')::integer),
    max((item ->> 'shot_number')::integer)
    into v_distinct_numbers, v_min_number, v_max_number
    from jsonb_array_elements(p_shots) item;

  if v_distinct_numbers <> v_shot_count or v_min_number <> 1 or v_max_number <> v_shot_count then
    raise exception 'REEL_STORYBOARD_INVALID: Shot numbers must be unique and contiguous from 1 through N.';
  end if;

  insert into public.video_shots (
    video_project_id,
    shot_number,
    beat_description,
    compiled_prompt,
    shot_class,
    human_presence,
    render_tier,
    motion_type,
    motion_strength,
    status,
    story_role,
    narrative_beat,
    message_supported,
    transition_from_previous,
    transition_to_next,
    visual_continuity,
    emotional_intent
  )
  select
    p_video_project_id,
    (item ->> 'shot_number')::integer,
    btrim(item ->> 'beat_description'),
    btrim(item ->> 'compiled_prompt'),
    btrim(item ->> 'shot_class'),
    btrim(item ->> 'human_presence'),
    btrim(item ->> 'render_tier'),
    null,
    null,
    'pending',
    nullif(btrim(coalesce(item ->> 'story_role', '')), ''),
    nullif(btrim(coalesce(item ->> 'narrative_beat', '')), ''),
    nullif(btrim(coalesce(item ->> 'message_supported', '')), ''),
    nullif(btrim(coalesce(item ->> 'transition_from_previous', '')), ''),
    nullif(btrim(coalesce(item ->> 'transition_to_next', '')), ''),
    case when item ? 'visual_continuity' then item -> 'visual_continuity' else null end,
    nullif(btrim(coalesce(item ->> 'emotional_intent', '')), '')
  from jsonb_array_elements(p_shots) item
  order by (item ->> 'shot_number')::integer;

  -- The story spine is written in the same transaction as the shots it
  -- produced, so a project can never hold shots whose plan is missing.
  update public.video_projects
     set story_strategy = coalesce(p_story_strategy, story_strategy),
         continuity_plan = coalesce(p_continuity_plan, continuity_plan),
         storyboard_provenance = coalesce(p_provenance, storyboard_provenance),
         storyboard_prompt_version = coalesce(p_prompt_version, storyboard_prompt_version),
         storyboard_model = coalesce(p_model, storyboard_model),
         storyboard_generated_at = case when p_story_strategy is not null then now() else storyboard_generated_at end,
         updated_at = now()
   where id = p_video_project_id;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_storyboard_generated',
    'AI generated a validated Reel Studio storyboard.',
    'video_project',
    p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'production_brief_id', p_client_production_brief_id,
      'shot_count', v_shot_count,
      'storyboard_prompt_version', p_prompt_version
    )
  );

  return query
    select *
      from public.video_shots
     where video_project_id = p_video_project_id
     order by shot_number;
end;
$$;


ALTER FUNCTION "public"."insert_reel_storyboard_if_empty"("p_video_project_id" "uuid", "p_client_id" "uuid", "p_client_production_brief_id" "uuid", "p_shots" "jsonb", "p_story_strategy" "jsonb", "p_continuity_plan" "jsonb", "p_provenance" "jsonb", "p_prompt_version" "text", "p_model" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_ideation_commit_replay"("p_client_id" "uuid", "p_commit_run_id" "uuid", "p_actor_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- coalesce: a caller with no role claim at all must fail closed, not slip
  -- through on a NULL comparison.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'IDEATION_COMMIT_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.client_ideation_commit_runs
    where id = p_commit_run_id and client_id = p_client_id and status = 'completed'
  ) then
    return;
  end if;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_content_commit_replayed',
    'An already-completed Ideation content commit was requested again; the existing result was returned and nothing new was created.',
    'client_ideation_commit_run', p_commit_run_id::text,
    jsonb_build_object('commit_run_id', p_commit_run_id)
  );
end;
$$;


ALTER FUNCTION "public"."log_ideation_commit_replay"("p_client_id" "uuid", "p_commit_run_id" "uuid", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."persist_asset_generation_result"("p_generation_job_id" "uuid", "p_generation_item_id" "uuid", "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") RETURNS TABLE("client_asset_id" "uuid", "item_status" "text", "completed_output_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_job public.client_asset_generation_jobs;
  v_item public.client_asset_generation_items;
  v_asset_id uuid;
  v_completed integer;
  v_title text;
begin
  select * into v_job
  from public.client_asset_generation_jobs
  where id = p_generation_job_id
  for update;
  if not found then raise exception 'generation job not found'; end if;

  select * into v_item
  from public.client_asset_generation_items
  where id = p_generation_item_id
  for update;
  if not found then raise exception 'generation item not found'; end if;
  if v_item.generation_job_id <> v_job.id then raise exception 'item/job mismatch'; end if;
  if v_job.closed_at is not null
     or coalesce(v_job.accepted_partial, false)
     or coalesce(v_job.closure_type, '') in ('cancelled','partial_accepted') then
    raise exception 'GENERATION_CLOSED: generation job is closed';
  end if;
  if v_item.status <> 'processing' then raise exception 'GENERATION_ITEM_NOT_PROCESSING: item is not processing'; end if;
  if exists (
    select 1 from public.client_asset_group_completeness_overrides o
    where o.client_id = v_job.client_id and o.asset_group_ref = v_job.asset_group_ref and o.is_active and o.revoked_at is null
  ) then raise exception 'GENERATION_CLOSED: asset group has an active partial override'; end if;
  if exists (
    select 1 from public.client_assets a
    where a.client_id = v_job.client_id
      and a.asset_group_ref = v_job.asset_group_ref
      and coalesce(a.is_current, true)
      and a.status = 'approved'
  ) then raise exception 'asset group is already approved'; end if;
  if exists (
    select 1 from public.client_distribution_records d
    where d.client_id = v_job.client_id
      and d.asset_group_ref = v_job.asset_group_ref
      and d.publish_status in ('ready','scheduled','publishing','published','needs_reconciliation')
  ) then raise exception 'asset group has a publication conflict'; end if;

  v_title := case
    when v_job.expected_output_count = 1 then coalesce(v_job.generation_config->>'brief_title', v_job.source_ref)
    else coalesce(v_job.generation_config->>'brief_title', v_job.source_ref) || ' — ' ||
      case when v_job.asset_format = 'carousel' then 'Slide ' else 'Frame ' end || v_item.sequence_index::text
  end;

  insert into public.client_assets (
    client_id, production_brief_id, source_ref, asset_format, asset_group_ref,
    sequence_index, title, storage_bucket, storage_path, mime_type, width, height,
    status, generation_provider, generation_model, prompt_md, metadata
  ) values (
    v_job.client_id, v_job.production_brief_id, v_job.source_ref, v_job.asset_format, v_job.asset_group_ref,
    v_item.sequence_index, v_title, 'client-assets', p_storage_path, p_mime_type, p_width, p_height,
    'needs_review', p_generation_provider, p_generation_model, p_prompt_md, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_asset_id;

  update public.client_asset_generation_items
  set status = 'complete',
      storage_path = p_storage_path,
      client_asset_id = v_asset_id,
      last_error = null,
      updated_at = now()
  where id = v_item.id and status = 'processing';

  if not found then raise exception 'GENERATION_ITEM_NOT_PROCESSING: item completion refused'; end if;

  select count(*)::int into v_completed
  from public.client_asset_generation_items
  where generation_job_id = v_job.id and status = 'complete';

  update public.client_asset_generation_jobs
  set completed_output_count = v_completed, updated_at = now()
  where id = v_job.id;

  return query select v_asset_id, 'complete'::text, v_completed;
end $$;


ALTER FUNCTION "public"."persist_asset_generation_result"("p_generation_job_id" "uuid", "p_generation_item_id" "uuid", "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."persist_ideation_proposal_batch"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_assignments" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_item jsonb;
  v_candidate public.client_ideation_candidates%rowtype;
  v_score public.client_ideation_candidate_scores%rowtype;
  v_slot public.client_ideation_calendar_proposal_slots%rowtype;
  v_snapshot jsonb;
  v_applied integer := 0;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'running' or v_proposal.lease_owner <> p_lease_owner
    or v_proposal.lease_expires_at <= now() then
    raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST';
  end if;
  if jsonb_typeof(coalesce(p_assignments, 'null'::jsonb)) <> 'array' then
    raise exception 'PROPOSAL_BATCH_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    select * into v_slot from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and proposal_slot_key = v_item->>'proposal_slot_key';
    if v_slot.id is null then raise exception 'PROPOSAL_SLOT_NOT_FOUND'; end if;
    if v_slot.candidate_id is not null then raise exception 'PROPOSAL_SLOT_ALREADY_OCCUPIED'; end if;

    select * into v_candidate from public.client_ideation_candidates
    where id = (v_item->>'candidate_id')::uuid;
    if v_candidate.id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_FOUND'; end if;
    if v_candidate.client_id <> v_proposal.client_id then raise exception 'PROPOSAL_CANDIDATE_CLIENT_MISMATCH'; end if;
    if v_candidate.ideation_cycle_id <> v_proposal.ideation_cycle_id then
      raise exception 'PROPOSAL_CANDIDATE_CYCLE_MISMATCH';
    end if;
    if v_candidate.asset_type <> v_slot.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;

    select * into v_score from public.client_ideation_candidate_scores
    where scoring_run_id = v_proposal.scoring_run_id and candidate_id = v_candidate.id;
    if v_score.id is null then raise exception 'PROPOSAL_SCORE_NOT_FOUND'; end if;

    -- The candidate must still be the exact proposal input the run began with.
    select value into v_snapshot from jsonb_array_elements(v_proposal.candidate_snapshot)
    where value->>'candidate_id' = v_item->>'candidate_id';
    if v_snapshot is null then raise exception 'PROPOSAL_CANDIDATE_NOT_IN_SNAPSHOT'; end if;
    if v_snapshot->>'content_hash' <> v_score.candidate_content_hash then
      raise exception 'PROPOSAL_CANDIDATE_HASH_MISMATCH';
    end if;
    if (v_snapshot->>'rank')::integer is distinct from v_score.rank
      or (v_snapshot->>'overall_score')::integer is distinct from v_score.overall_score then
      raise exception 'PROPOSAL_SCORE_DRIFTED';
    end if;

    update public.client_ideation_calendar_proposal_slots
    set candidate_id = v_candidate.id,
        candidate_score_id = v_score.id,
        candidate_asset_type_snapshot = v_candidate.asset_type,
        candidate_content_hash = v_score.candidate_content_hash,
        candidate_rank_snapshot = v_score.rank,
        candidate_score_snapshot = v_score.overall_score,
        candidate_display_reference = v_item->>'candidate_display_reference',
        placement_rationale = v_item->>'placement_rationale',
        authority_references = coalesce(v_item->'authority_references', '[]'::jsonb),
        evidence_references = coalesce(v_item->'evidence_references', '[]'::jsonb),
        slot_warnings = coalesce(v_item->'warnings', '[]'::jsonb),
        placement_source = 'model'
    where id = v_slot.id;
    v_applied := v_applied + 1;
  end loop;

  v_proposal := public.recount_ideation_proposal(v_proposal.id);
  return jsonb_build_object('applied', v_applied, 'proposal', to_jsonb(v_proposal));
end
$$;


ALTER FUNCTION "public"."persist_ideation_proposal_batch"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_assignments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."persist_ideation_score_batch"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_scores" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_run public.client_ideation_scoring_runs%rowtype;
  v_item jsonb;
  v_candidate public.client_ideation_candidates%rowtype;
  v_snapshot jsonb;
  v_inserted integer := 0;
begin
  select * into v_run
  from public.client_ideation_scoring_runs
  where id = p_scoring_run_id
  for update;
  if v_run.id is null then raise exception 'SCORING_RUN_NOT_FOUND'; end if;
  if v_run.status <> 'running'
    or v_run.lease_owner <> p_lease_owner
    or v_run.lease_expires_at <= now() then
    raise exception 'SCORING_LEASE_OWNERSHIP_LOST';
  end if;
  if jsonb_typeof(coalesce(p_scores, 'null'::jsonb)) <> 'array' then
    raise exception 'SCORE_BATCH_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_scores)
  loop
    select * into v_candidate
    from public.client_ideation_candidates
    where id = (v_item->>'candidate_id')::uuid;
    if v_candidate.id is null then raise exception 'SCORE_CANDIDATE_NOT_FOUND'; end if;
    if v_candidate.client_id <> v_run.client_id then raise exception 'SCORE_CANDIDATE_CLIENT_MISMATCH'; end if;
    if v_candidate.ideation_cycle_id <> v_run.ideation_cycle_id then
      raise exception 'SCORE_CANDIDATE_CYCLE_MISMATCH';
    end if;

    -- The candidate must still be the exact scoring input the run was created
    -- for. A candidate edited after the run began fails closed here.
    select value into v_snapshot
    from jsonb_array_elements(v_run.candidate_snapshot)
    where value->>'candidate_id' = v_item->>'candidate_id';
    if v_snapshot is null then raise exception 'SCORE_CANDIDATE_NOT_IN_SNAPSHOT'; end if;
    if v_snapshot->>'content_hash' <> v_item->>'candidate_content_hash'
      or v_snapshot->>'evidence_hash' <> v_item->>'candidate_evidence_hash' then
      raise exception 'SCORE_CANDIDATE_HASH_MISMATCH';
    end if;

    insert into public.client_ideation_candidate_scores (
      client_id, ideation_cycle_id, scoring_run_id, candidate_id,
      candidate_content_hash, candidate_evidence_hash,
      execution_plan_alignment, business_and_positioning_alignment,
      audience_and_pain_relevance, proof_and_evidence_strength,
      hook_and_attention_strength, commercial_potential,
      specificity_and_clarity, originality_and_distinctiveness,
      platform_and_format_fit, production_feasibility,
      overall_score, priority_band, rationale, strengths, risks,
      authority_references, evidence_references,
      provider, model, rubric_slug, rubric_version, prompt_version, output_schema_version
    ) values (
      v_run.client_id, v_run.ideation_cycle_id, v_run.id, (v_item->>'candidate_id')::uuid,
      v_item->>'candidate_content_hash', v_item->>'candidate_evidence_hash',
      (v_item->>'execution_plan_alignment')::smallint,
      (v_item->>'business_and_positioning_alignment')::smallint,
      (v_item->>'audience_and_pain_relevance')::smallint,
      (v_item->>'proof_and_evidence_strength')::smallint,
      (v_item->>'hook_and_attention_strength')::smallint,
      (v_item->>'commercial_potential')::smallint,
      (v_item->>'specificity_and_clarity')::smallint,
      (v_item->>'originality_and_distinctiveness')::smallint,
      (v_item->>'platform_and_format_fit')::smallint,
      (v_item->>'production_feasibility')::smallint,
      (v_item->>'overall_score')::smallint,
      v_item->>'priority_band',
      v_item->>'rationale',
      coalesce(v_item->'strengths', '[]'::jsonb),
      coalesce(v_item->'risks', '[]'::jsonb),
      coalesce(v_item->'authority_references', '[]'::jsonb),
      coalesce(v_item->'evidence_references', '[]'::jsonb),
      v_run.provider, v_run.model, v_run.rubric_slug, v_run.rubric_version,
      v_item->>'prompt_version', v_run.output_schema_version
    )
    on conflict (scoring_run_id, candidate_id) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  update public.client_ideation_scoring_runs
  set scored_candidate_count = (
        select count(*) from public.client_ideation_candidate_scores
        where scoring_run_id = v_run.id
      )
  where id = v_run.id
  returning * into v_run;

  return jsonb_build_object('inserted', v_inserted, 'run', to_jsonb(v_run));
end
$$;


ALTER FUNCTION "public"."persist_ideation_score_batch"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_scores" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."persist_instagram_insights_collection"("p_run_id" "uuid", "p_distribution_record_id" "uuid", "p_snapshot_label" "text", "p_metrics_requested" "text"[], "p_metrics_collected" "jsonb", "p_unsupported_metrics" "text"[] DEFAULT '{}'::"text"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d public.client_distribution_records; v_snapshot_id uuid;
begin
  select * into d from public.client_distribution_records where id=p_distribution_record_id for share;
  if not found then raise exception 'NOT_FOUND: distribution record %',p_distribution_record_id; end if;
  if d.publish_status <> 'published' or d.external_post_id is null or d.published_at is null or lower(coalesce(d.platform,'')) <> 'instagram' then
    raise exception 'REFUSED: automatic insights require published Instagram evidence';
  end if;
  if p_snapshot_label not in ('t_plus_1h','t_plus_6h','t_plus_24h','t_plus_48h','t_plus_7d','story_t_plus_1h','story_t_plus_6h','story_t_plus_23h') then raise exception 'VALIDATION: invalid automatic snapshot label'; end if;
  if jsonb_typeof(coalesce(p_metrics_collected,'{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: metrics must be an object'; end if;
  if not exists (select 1 from public.client_insights_collection_runs where id=p_run_id and status='running' and mode='live') then raise exception 'REFUSED: active live collection run required'; end if;
  insert into public.client_metric_snapshots (client_id,distribution_record_id,source_ref,platform,content_format,snapshot_at,snapshot_label,collection_method,metrics)
  values (d.client_id,d.id,d.source_ref,'instagram',d.asset_format,now(),p_snapshot_label,'api',coalesce(p_metrics_collected,'{}'::jsonb)) returning id into v_snapshot_id;
  insert into public.client_insights_collection_attempts (run_id,distribution_record_id,client_id,source_ref,external_post_id,snapshot_label,status,metrics_requested,metrics_collected,unsupported_metrics)
  values (p_run_id,d.id,d.client_id,d.source_ref,d.external_post_id,p_snapshot_label,'collected',coalesce(p_metrics_requested,'{}'),coalesce(p_metrics_collected,'{}'::jsonb),coalesce(p_unsupported_metrics,'{}'));
  insert into public.activity_log (client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values (d.client_id,'instagram_insights_collected','Instagram insights collected for '||d.source_ref||'.','client_metric_snapshot',v_snapshot_id,
    jsonb_build_object('distribution_record_id',d.id,'source_ref',d.source_ref,'snapshot_label',p_snapshot_label,'collection_method','api'));
  return v_snapshot_id;
end; $$;


ALTER FUNCTION "public"."persist_instagram_insights_collection"("p_run_id" "uuid", "p_distribution_record_id" "uuid", "p_snapshot_label" "text", "p_metrics_requested" "text"[], "p_metrics_collected" "jsonb", "p_unsupported_metrics" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."persist_regenerated_asset_frame"("p_current_asset_id" "uuid", "p_expected_new_version" integer, "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") RETURNS "public"."client_assets"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_current public.client_assets;
  v_job public.client_asset_generation_jobs;
  v_new_version integer;
  v_inserted public.client_assets;
begin
  select * into v_current
  from public.client_assets
  where id = p_current_asset_id
  for update;
  if not found then raise exception 'current asset not found'; end if;
  if not coalesce(v_current.is_current, true) then raise exception 'current version changed; reload before regenerating'; end if;

  if exists (
    select 1 from public.client_asset_group_completeness_overrides o
    where o.client_id = v_current.client_id and o.asset_group_ref = v_current.asset_group_ref and o.is_active and o.revoked_at is null
  ) then raise exception 'REGENERATION_CLOSED: asset group has an active partial override'; end if;

  select * into v_job
  from public.client_asset_generation_jobs j
  where j.client_id = v_current.client_id and j.asset_group_ref = v_current.asset_group_ref
  order by j.created_at desc
  limit 1
  for update;
  if found and (v_job.closed_at is not null or coalesce(v_job.accepted_partial, false) or coalesce(v_job.closure_type, '') in ('cancelled','partial_accepted')) then
    raise exception 'REGENERATION_CLOSED: generation job is closed';
  end if;

  if exists (
    select 1 from public.client_distribution_records d
    where d.client_id = v_current.client_id
      and d.asset_group_ref = v_current.asset_group_ref
      and d.publish_status in ('ready','scheduled','publishing','published','needs_reconciliation')
  ) then raise exception 'asset group has a publication conflict'; end if;

  select coalesce(max(version), 1) + 1 into v_new_version
  from public.client_assets
  where production_brief_id = v_current.production_brief_id
    and asset_group_ref = v_current.asset_group_ref
    and sequence_index = v_current.sequence_index;
  if v_new_version <> p_expected_new_version then raise exception 'current version changed; reload before regenerating'; end if;

  insert into public.client_assets (
    client_id, production_brief_id, source_ref, asset_format, asset_group_ref,
    sequence_index, version, is_current, title, storage_bucket, storage_path,
    mime_type, width, height, status, generation_provider, generation_model, prompt_md, metadata
  ) values (
    v_current.client_id, v_current.production_brief_id, v_current.source_ref, v_current.asset_format, v_current.asset_group_ref,
    v_current.sequence_index, v_new_version, false, v_current.title, 'client-assets', p_storage_path,
    p_mime_type, p_width, p_height, 'needs_review', p_generation_provider, p_generation_model, p_prompt_md, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_inserted;

  update public.client_assets
  set is_current = false, regen_started_at = null, updated_at = now()
  where id = v_current.id;

  update public.client_assets
  set is_current = true, updated_at = now()
  where id = v_inserted.id
  returning * into v_inserted;

  return v_inserted;
end $$;


ALTER FUNCTION "public"."persist_regenerated_asset_frame"("p_current_asset_id" "uuid", "p_expected_new_version" integer, "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phase_ref_is_published"("p_client_id" "uuid", "p_source_ref" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_distribution_records
    WHERE client_id = p_client_id AND source_ref = p_source_ref
      AND (publish_status = 'published' OR external_post_id IS NOT NULL OR published_at IS NOT NULL OR published_url IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.client_analytics_records
    WHERE client_id = p_client_id AND source_ref = p_source_ref
      AND (external_post_id IS NOT NULL OR published_at IS NOT NULL OR published_url IS NOT NULL)
  );
$$;


ALTER FUNCTION "public"."phase_ref_is_published"("p_client_id" "uuid", "p_source_ref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_distribution_record"("p_record_id" "uuid", "p_action" "text", "p_external_id" "text" DEFAULT NULL::"text", "p_confirm" boolean DEFAULT false) RETURNS TABLE("success" boolean, "record_id" "uuid", "previous_status" "text", "new_status" "text", "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare rec public.client_distribution_records; v_prev text; v_has_evidence boolean; v_ext text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_action not in ('confirm_published','reset_scheduled','cancel') then raise exception 'REFUSED: unknown reconcile action %', p_action; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.publish_status <> 'needs_reconciliation' then raise exception 'REFUSED: reconcile only applies to needs_reconciliation (got %)', rec.publish_status; end if;
  v_has_evidence := rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null;
  if p_action = 'confirm_published' then
    if not p_confirm then raise exception 'REFUSED: confirm_published requires explicit operator confirmation'; end if;
    if not v_has_evidence then
      if p_external_id is null or p_external_id !~ '^\d+$' then raise exception 'REFUSED: confirm_published needs existing evidence or a valid numeric external media id'; end if;
      v_ext := p_external_id;
    else v_ext := rec.external_post_id; end if;
    update public.client_distribution_records
    set publish_status='published', external_post_id=coalesce(external_post_id, v_ext), published_at=coalesce(published_at, now()), claimed_at=null, claimed_by=null, last_error=null, updated_at=now()
    where id=p_record_id;
    perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'reconcile_confirm_published', v_prev, 'published', v_ext);
    return query select true, p_record_id, v_prev, 'published'::text, 'Confirmed published.'::text;
  elsif p_action = 'reset_scheduled' then
    if v_has_evidence then raise exception 'REFUSED: evidence exists — cannot reset to scheduled (use confirm_published)'; end if;
    update public.client_distribution_records
    set publish_status='scheduled', next_attempt_at=now(), claimed_at=null, claimed_by=null, permanent_failure=false, last_error=null, updated_at=now()
    where id=p_record_id;
    perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'reconcile_reset_scheduled', v_prev, 'scheduled', null);
    return query select true, p_record_id, v_prev, 'scheduled'::text, 'Re-queued after reconciliation.'::text;
  else
    update public.client_distribution_records set publish_status='cancelled', claimed_at=null, claimed_by=null, updated_at=now() where id=p_record_id;
    perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'reconcile_cancel', v_prev, 'cancelled', null);
    return query select true, p_record_id, v_prev, 'cancelled'::text, 'Cancelled after reconciliation.'::text;
  end if;
end; $_$;


ALTER FUNCTION "public"."reconcile_distribution_record"("p_record_id" "uuid", "p_action" "text", "p_external_id" "text", "p_confirm" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_ideation_commit_failure"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_actor_id" "uuid", "p_failure_code" "text", "p_failure_message" "text", "p_failed_proposal_slot_key" "text", "p_configuration_hash" "text", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals;
  v_run_id uuid;
begin
  -- coalesce: a caller with no role claim at all must fail closed, not slip
  -- through on a NULL comparison.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'IDEATION_COMMIT_FORBIDDEN';
  end if;

  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id and client_id = p_client_id;
  if not found then return null; end if;

  -- Never record a failure over a proposal that did in fact commit.
  if exists (select 1 from public.client_ideation_commit_runs
             where proposal_id = v_proposal.id and status = 'completed') then
    return null;
  end if;

  insert into public.client_ideation_commit_runs (
    client_id, ideation_cycle_id, scoring_run_id, proposal_id, status,
    idempotency_key, configuration_hash, commit_input_snapshot, calendar_digest,
    proposal_version, proposal_edit_revision,
    target_manifest_version, mapping_version, reference_allocator_version,
    output_schema_version, module_version,
    period_start, period_end, expected_item_count,
    failure_code, failure_message, failed_proposal_slot_key, failed_at, created_by
  ) values (
    p_client_id, v_proposal.ideation_cycle_id, v_proposal.scoring_run_id, v_proposal.id, 'failed',
    p_idempotency_key, p_configuration_hash, '{}'::jsonb, p_calendar_digest,
    v_proposal.proposal_version, v_proposal.edit_revision,
    p_target_manifest_version, p_mapping_version, p_reference_allocator_version,
    p_output_schema_version, p_module_version,
    v_proposal.period_start, v_proposal.period_end, greatest(v_proposal.expected_slot_count, 1),
    p_failure_code, left(coalesce(p_failure_message, ''), 2000), p_failed_proposal_slot_key, now(), p_actor_id
  ) returning id into v_run_id;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_content_commit_failed',
    'An Ideation content commit was refused. No operational Content or Calendar records were created.',
    'client_ideation_commit_run', v_run_id::text,
    jsonb_build_object('proposal_id', v_proposal.id, 'commit_run_id', v_run_id, 'failure_code', p_failure_code)
  );

  return v_run_id;
end;
$$;


ALTER FUNCTION "public"."record_ideation_commit_failure"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_actor_id" "uuid", "p_failure_code" "text", "p_failure_message" "text", "p_failed_proposal_slot_key" "text", "p_configuration_hash" "text", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_ideation_calendar_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "scoring_run_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "proposal_version" integer DEFAULT 1 NOT NULL,
    "supersedes_proposal_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "configuration_hash" "text" NOT NULL,
    "configuration_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "authority_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "candidate_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "scoring_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "slot_manifest_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "calendar_conflict_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "calendar_conflict_digest" "text" NOT NULL,
    "slot_planner_version" "text" NOT NULL,
    "prompt_digest" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "output_schema_version" "text" NOT NULL,
    "module_version" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "expected_slot_count" integer NOT NULL,
    "assigned_slot_count" integer DEFAULT 0 NOT NULL,
    "unassigned_candidate_count" integer DEFAULT 0 NOT NULL,
    "conflict_count" integer DEFAULT 0 NOT NULL,
    "unresolved_conflict_count" integer DEFAULT 0 NOT NULL,
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "maximum_attempts" integer DEFAULT 3 NOT NULL,
    "retryable" boolean DEFAULT false NOT NULL,
    "warnings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "failure_code" "text",
    "failure_message" "text",
    "lease_owner" "text",
    "lease_expires_at" timestamp with time zone,
    "last_heartbeat_at" timestamp with time zone,
    "edit_revision" integer DEFAULT 0 NOT NULL,
    "generated_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "failed_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_calendar_proposals_approved_check" CHECK ((("status" <> 'approved'::"text") OR (("approved_at" IS NOT NULL) AND ("approved_by" IS NOT NULL) AND ("assigned_slot_count" = "expected_slot_count") AND ("unassigned_candidate_count" = 0) AND ("unresolved_conflict_count" = 0)))),
    CONSTRAINT "client_ideation_calendar_proposals_attempts_check" CHECK ((("attempt_count" >= 1) AND (("maximum_attempts" >= 1) AND ("maximum_attempts" <= 10)) AND ("attempt_count" <= "maximum_attempts"))),
    CONSTRAINT "client_ideation_calendar_proposals_counts_check" CHECK ((("expected_slot_count" >= 1) AND (("assigned_slot_count" >= 0) AND ("assigned_slot_count" <= "expected_slot_count")) AND ("unassigned_candidate_count" >= 0) AND ("conflict_count" >= 0) AND ("unresolved_conflict_count" >= 0) AND ("unresolved_conflict_count" <= "conflict_count"))),
    CONSTRAINT "client_ideation_calendar_proposals_draft_check" CHECK ((("status" <> ALL (ARRAY['draft'::"text", 'approved'::"text", 'superseded'::"text"])) OR ("generated_at" IS NOT NULL))),
    CONSTRAINT "client_ideation_calendar_proposals_edit_revision_check" CHECK (("edit_revision" >= 0)),
    CONSTRAINT "client_ideation_calendar_proposals_failed_check" CHECK (((("status" = 'failed'::"text") AND ("failed_at" IS NOT NULL)) OR (("status" <> 'failed'::"text") AND ("failed_at" IS NULL)))),
    CONSTRAINT "client_ideation_calendar_proposals_hash_check" CHECK ((("configuration_hash" ~ '^[0-9a-f]{64}$'::"text") AND ("calendar_conflict_digest" ~ '^[0-9a-f]{64}$'::"text") AND ("prompt_digest" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "client_ideation_calendar_proposals_idempotency_check" CHECK ((("length"("idempotency_key") >= 1) AND ("length"("idempotency_key") <= 160))),
    CONSTRAINT "client_ideation_calendar_proposals_lease_check" CHECK (((("status" = 'running'::"text") AND ("lease_owner" IS NOT NULL) AND ("lease_expires_at" IS NOT NULL) AND ("last_heartbeat_at" IS NOT NULL)) OR (("status" <> 'running'::"text") AND ("lease_owner" IS NULL) AND ("lease_expires_at" IS NULL)))),
    CONSTRAINT "client_ideation_calendar_proposals_manifest_length_check" CHECK (("jsonb_array_length"("slot_manifest_snapshot") = "expected_slot_count")),
    CONSTRAINT "client_ideation_calendar_proposals_no_self_supersede_check" CHECK ((("supersedes_proposal_id" IS NULL) OR ("supersedes_proposal_id" <> "id"))),
    CONSTRAINT "client_ideation_calendar_proposals_period_check" CHECK ((("period_end" >= "period_start") AND ((("period_end" - "period_start") >= 0) AND (("period_end" - "period_start") <= 30)))),
    CONSTRAINT "client_ideation_calendar_proposals_provenance_check" CHECK (((("length"("provider") >= 1) AND ("length"("provider") <= 100)) AND (("length"("model") >= 1) AND ("length"("model") <= 200)) AND (("length"("slot_planner_version") >= 1) AND ("length"("slot_planner_version") <= 100)) AND (("length"("output_schema_version") >= 1) AND ("length"("output_schema_version") <= 100)) AND (("length"("module_version") >= 1) AND ("length"("module_version") <= 100)))),
    CONSTRAINT "client_ideation_calendar_proposals_retryable_check" CHECK ((NOT (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'superseded'::"text"])) AND "retryable"))),
    CONSTRAINT "client_ideation_calendar_proposals_snapshot_check" CHECK ((("jsonb_typeof"("configuration_snapshot") = 'object'::"text") AND ("jsonb_typeof"("authority_snapshot") = 'object'::"text") AND ("jsonb_typeof"("candidate_snapshot") = 'array'::"text") AND ("jsonb_typeof"("scoring_snapshot") = 'object'::"text") AND ("jsonb_typeof"("slot_manifest_snapshot") = 'array'::"text") AND ("jsonb_typeof"("calendar_conflict_snapshot") = 'object'::"text") AND ("jsonb_typeof"("warnings") = 'array'::"text"))),
    CONSTRAINT "client_ideation_calendar_proposals_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'retryable'::"text", 'failed'::"text", 'draft'::"text", 'approved'::"text", 'superseded'::"text"]))),
    CONSTRAINT "client_ideation_calendar_proposals_unapproved_check" CHECK ((("status" = ANY (ARRAY['approved'::"text", 'superseded'::"text"])) OR ("approved_at" IS NULL))),
    CONSTRAINT "client_ideation_calendar_proposals_version_check" CHECK (("proposal_version" >= 1))
);


ALTER TABLE "public"."client_ideation_calendar_proposals" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_calendar_proposals" IS 'Stage 3 proposed Calendar. Advisory and Ideation-owned: approval is not a commit and creates no operational Calendar or master row.';



CREATE OR REPLACE FUNCTION "public"."recount_ideation_proposal"("p_proposal_id" "uuid") RETURNS "public"."client_ideation_calendar_proposals"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_assigned integer;
  v_conflicts integer;
  v_unresolved integer;
begin
  select count(*) filter (where candidate_id is not null),
         count(*) filter (where conflict_status <> 'clear'),
         count(*) filter (where conflict_status in ('protected','date_capacity_exceeded','stale_calendar_snapshot'))
  into v_assigned, v_conflicts, v_unresolved
  from public.client_ideation_calendar_proposal_slots
  where proposal_id = p_proposal_id;

  update public.client_ideation_calendar_proposals
  set assigned_slot_count = coalesce(v_assigned, 0),
      unassigned_candidate_count = expected_slot_count - coalesce(v_assigned, 0),
      conflict_count = coalesce(v_conflicts, 0),
      unresolved_conflict_count = coalesce(v_unresolved, 0)
  where id = p_proposal_id
  returning * into v_proposal;
  return v_proposal;
end
$$;


ALTER FUNCTION "public"."recount_ideation_proposal"("p_proposal_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recover_stale_ai_background_generation"("p_generation_id" "uuid") RETURNS "public"."client_ai_background_image_generations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ declare v_row public.client_ai_background_image_generations; v_message constant text := 'Recovered after interrupted provider execution; no image was stored. Create a new prompt/generation if retry is required.'; begin
if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
update public.client_ai_background_image_generations set prompt_status='failed',error_message=v_message,last_provider_error=v_message,updated_at=now() where id=p_generation_id and prompt_status in ('generating','provider_submitted','checking') and storage_path is null and generated_at is null and provider_response='{}'::jsonb and updated_at<now()-interval '5 minutes' returning * into v_row;
if not found then raise exception 'RECOVERY_REJECTED: generation must be stale and have no stored or provider result'; end if;
insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(v_row.client_id,'ai_background_generation_recovered','Interrupted AI background generation recovered as failed for '||v_row.source_ref||'.','client_ai_background_image_generation',v_row.id,jsonb_build_object('source_ref',v_row.source_ref,'new_status','failed'));
return v_row; end $$;


ALTER FUNCTION "public"."recover_stale_ai_background_generation"("p_generation_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recover_stale_ai_background_generation"("p_generation_id" "uuid") IS 'Manually terminalizes one stale generating AI background row with no stored/provider result; never retries provider work.';



CREATE OR REPLACE FUNCTION "public"."recover_stale_publishing"("p_older_than" interval) RETURNS TABLE("recovered_published" integer, "flagged_reconcile" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_pub integer; v_rec integer;
begin
  with stale as (
    select id, (external_post_id is not null or published_at is not null or published_url is not null) as has_evidence
    from public.client_distribution_records
    where publish_status = 'publishing' and claimed_at is not null and claimed_at < now() - p_older_than
      -- Reels: an IN_PROGRESS container younger than Meta's 24h container expiry
      -- is still legitimately processing. Leave it for the polling path.
      and not (
        external_container_id is not null
        and container_status = 'IN_PROGRESS'
        and container_created_at is not null
        and container_created_at > now() - interval '24 hours'
      )
  ),
  pub as (
    update public.client_distribution_records d set publish_status = 'published',
        published_at = coalesce(d.published_at, now()), last_error = null, updated_at = now()
    from stale s where d.id = s.id and s.has_evidence returning d.id
  ),
  rec as (
    update public.client_distribution_records d set publish_status = 'needs_reconciliation',
        last_error = 'Stale publishing claim with no publication evidence — external Instagram state is uncertain; manual reconciliation required before any retry.', updated_at = now()
    from stale s where d.id = s.id and not s.has_evidence returning d.id
  )
  select (select count(*) from pub), (select count(*) from rec) into v_pub, v_rec;
  return query select coalesce(v_pub,0), coalesce(v_rec,0);
end;
$$;


ALTER FUNCTION "public"."recover_stale_publishing"("p_older_than" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reel_shot_failure_phase"("p_shot" "public"."video_shots") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when p_shot.status is distinct from 'failed' then null
    when p_shot.failure_stage like 'still\_%' then 'still'
    when p_shot.failure_stage like 'video\_%' then 'video'
    when p_shot.higgsfield_job_id is not null or p_shot.still_image_url is not null then 'video'
    else 'still'
  end;
$$;


ALTER FUNCTION "public"."reel_shot_failure_phase"("p_shot" "public"."video_shots") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_ideation_proposal_conflicts"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_conflicts" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_expected_edit_revision" integer, "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_item jsonb;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.client_id <> p_client_id then raise exception 'PROPOSAL_CLIENT_MISMATCH'; end if;
  if v_proposal.status <> 'draft' then raise exception 'PROPOSAL_NOT_EDITABLE'; end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'PROPOSAL_EDIT_REVISION_CONFLICT';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_conflicts, '[]'::jsonb))
  loop
    update public.client_ideation_calendar_proposal_slots
    set conflict_status = v_item->>'conflict_status',
        conflict_details = coalesce(v_item->'conflict_details', '{}'::jsonb)
    where proposal_id = v_proposal.id and proposal_slot_key = v_item->>'proposal_slot_key';
  end loop;

  update public.client_ideation_calendar_proposals
  set calendar_conflict_snapshot = coalesce(p_calendar_conflict_snapshot, calendar_conflict_snapshot),
      calendar_conflict_digest = coalesce(p_calendar_conflict_digest, calendar_conflict_digest),
      edit_revision = edit_revision + 1
  where id = v_proposal.id;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_conflicts_refreshed',
    'Proposed Ideation Calendar conflicts were refreshed against current Calendar state.',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('conflicts', v_proposal.conflict_count,
      'unresolved', v_proposal.unresolved_conflict_count, 'edit_revision', v_proposal.edit_revision)
  );
  return to_jsonb(v_proposal);
end
$$;


ALTER FUNCTION "public"."refresh_ideation_proposal_conflicts"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_conflicts" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_expected_edit_revision" integer, "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."regenerate_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_planning" "jsonb") RETURNS "public"."video_shots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_shot public.video_shots;
  v_updated public.video_shots;
begin
  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
     and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Shot regeneration is unavailable after review starts.';
  end if;
  if v_project.client_production_brief_id is null then
    raise exception 'REEL_BRIEF_NOT_BOUND: Project must have a bound production brief.';
  end if;

  select *
    into v_brief
    from public.client_production_briefs
   where id = v_project.client_production_brief_id
   for share;
  if not found
     or v_brief.client_id is distinct from v_project.client_id
     or v_brief.asset_format is distinct from 'reel_video'
     or v_brief.status is distinct from 'approved'::public.review_state
     or v_brief.source_table is distinct from (
       case when v_project.organic_master_id is not null then 'organic_master' else 'ads_master' end
     )
     or v_brief.source_row_id is distinct from coalesce(v_project.organic_master_id, v_project.ads_master_id) then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Bound production brief is no longer valid for this project.';
  end if;

  select *
    into v_shot
    from public.video_shots
   where id = p_shot_id
     and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_SHOT_STALE: Shot changed after regeneration started; reload before trying again.';
  end if;
  if v_shot.status is distinct from 'pending'
     or v_shot.still_image_job_id is not null
     or v_shot.still_image_url is not null
     or v_shot.higgsfield_job_id is not null
     or v_shot.clip_url is not null then
    raise exception 'REEL_SHOT_NOT_PENDING: Shot image or video generation has already started.';
  end if;

  -- A regenerated shot keeps its number and its narrative role: regeneration
  -- replaces how a beat is expressed, never what job it does in the sequence.
  if p_planning ? 'story_role'
     and v_shot.story_role is not null
     and btrim(p_planning ->> 'story_role') is distinct from v_shot.story_role then
    raise exception 'REEL_SHOT_ROLE_CHANGED: Regeneration must preserve the shot''s story role.';
  end if;

  update public.video_shots
     set beat_description = btrim(p_planning ->> 'beat_description'),
         compiled_prompt = btrim(p_planning ->> 'compiled_prompt'),
         shot_class = btrim(p_planning ->> 'shot_class'),
         human_presence = btrim(p_planning ->> 'human_presence'),
         render_tier = btrim(p_planning ->> 'render_tier'),
         story_role = coalesce(nullif(btrim(coalesce(p_planning ->> 'story_role', '')), ''), story_role),
         narrative_beat = coalesce(nullif(btrim(coalesce(p_planning ->> 'narrative_beat', '')), ''), narrative_beat),
         message_supported = coalesce(nullif(btrim(coalesce(p_planning ->> 'message_supported', '')), ''), message_supported),
         transition_from_previous = coalesce(
           nullif(btrim(coalesce(p_planning ->> 'transition_from_previous', '')), ''), transition_from_previous),
         transition_to_next = coalesce(
           nullif(btrim(coalesce(p_planning ->> 'transition_to_next', '')), ''), transition_to_next),
         visual_continuity = case
           when p_planning ? 'visual_continuity' then p_planning -> 'visual_continuity'
           else visual_continuity
         end,
         emotional_intent = coalesce(nullif(btrim(coalesce(p_planning ->> 'emotional_intent', '')), ''), emotional_intent),
         error = null,
         updated_at = now()
   where id = p_shot_id
  returning * into v_updated;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_shot_regenerated',
    'One pending Reel Studio shot was regenerated.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'production_brief_id', v_project.client_production_brief_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number,
      'story_role', v_updated.story_role
    )
  );

  return v_updated;
end;
$$;


ALTER FUNCTION "public"."regenerate_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_planning" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."renew_ideation_proposal_lease"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_proposal public.client_ideation_calendar_proposals%rowtype;
begin
  if p_lease_seconds not between 60 and 600 then raise exception 'LEASE_CONFIGURATION_INVALID'; end if;
  update public.client_ideation_calendar_proposals
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds), last_heartbeat_at = now()
  where id = p_proposal_id and status = 'running'
    and lease_owner = p_lease_owner and lease_expires_at > now()
  returning * into v_proposal;
  if v_proposal.id is null then raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST'; end if;
  return to_jsonb(v_proposal);
end
$$;


ALTER FUNCTION "public"."renew_ideation_proposal_lease"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."renew_ideation_run_lease"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
begin
  if p_lease_seconds not between 60 and 600 then raise exception 'LEASE_CONFIGURATION_INVALID'; end if;
  update public.client_ideation_cycles
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now()
  where id = p_cycle_id
    and status = 'running'
    and lease_owner = p_lease_owner
    and lease_expires_at > now()
  returning * into v_cycle;
  if v_cycle.id is null then raise exception 'LEASE_OWNERSHIP_LOST'; end if;
  return to_jsonb(v_cycle);
end
$$;


ALTER FUNCTION "public"."renew_ideation_run_lease"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."renew_ideation_scoring_lease"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_run public.client_ideation_scoring_runs%rowtype;
begin
  if p_lease_seconds not between 60 and 600 then raise exception 'LEASE_CONFIGURATION_INVALID'; end if;
  update public.client_ideation_scoring_runs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now()
  where id = p_scoring_run_id
    and status = 'running'
    and lease_owner = p_lease_owner
    and lease_expires_at > now()
  returning * into v_run;
  if v_run.id is null then raise exception 'SCORING_LEASE_OWNERSHIP_LOST'; end if;
  return to_jsonb(v_run);
end
$$;


ALTER FUNCTION "public"."renew_ideation_scoring_lease"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_phase3_master_if_safe"("p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ok boolean := false;
  v_brief int := 0; v_asset int := 0; v_dist int := 0; v_analytics int := 0; v_archive int := 0;
BEGIN
  IF p_master_table NOT IN ('organic_master','story_master','ads_master') THEN
    RAISE EXCEPTION 'invalid master table %', p_master_table;
  END IF;
  IF p_master_table = 'organic_master' THEN
    SELECT true INTO v_ok FROM public.organic_master WHERE client_id = p_client_id AND ref = p_ref AND review_state = 'needs_review';
  ELSIF p_master_table = 'story_master' THEN
    SELECT true INTO v_ok FROM public.story_master WHERE client_id = p_client_id AND ref = p_ref AND review_state = 'needs_review';
  ELSE
    SELECT true INTO v_ok FROM public.ads_master WHERE client_id = p_client_id AND ref = p_ref AND review_state = 'needs_review';
  END IF;
  IF v_ok IS NOT TRUE THEN RETURN false; END IF;

  SELECT count(*) INTO v_brief FROM public.client_production_briefs WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_asset FROM public.client_assets WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_dist FROM public.client_distribution_records WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_analytics FROM public.client_analytics_records WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_archive FROM public.client_asset_archive_snapshots WHERE client_id = p_client_id AND source_ref = p_ref;
  IF v_brief > 0 OR v_asset > 0 OR v_dist > 0 OR v_analytics > 0 OR v_archive > 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.calendar_cells WHERE client_id = p_client_id AND ref = p_ref;
  IF p_master_table = 'organic_master' THEN
    DELETE FROM public.organic_master WHERE client_id = p_client_id AND ref = p_ref;
  ELSIF p_master_table = 'story_master' THEN
    DELETE FROM public.story_master WHERE client_id = p_client_id AND ref = p_ref;
  ELSE
    DELETE FROM public.ads_master WHERE client_id = p_client_id AND ref = p_ref;
  END IF;
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."replace_phase3_master_if_safe"("p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requeue_stale_asset_generation_items"("p_job_id" "uuid", "p_older_than" interval) RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  with updated as (
    update public.client_asset_generation_items i
    set status = 'queued', updated_at = now()
    from public.client_asset_generation_jobs j
    where i.generation_job_id = p_job_id
      and j.id = i.generation_job_id
      and j.closed_at is null
      and coalesce(j.accepted_partial, false) = false
      and i.status = 'processing'
      and i.updated_at < now() - p_older_than
    returning 1
  )
  select count(*)::int from updated;
$$;


ALTER FUNCTION "public"."requeue_stale_asset_generation_items"("p_job_id" "uuid", "p_older_than" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_storage_path_prefix" "text", "p_safe_filename" "text", "p_mime_type" "text", "p_file_size_bytes" bigint, "p_original_filename" "text", "p_uploaded_by" "uuid", "p_acknowledge_replace_approved" boolean DEFAULT false) RETURNS "public"."video_project_deliverables"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_current public.video_project_deliverables;
  v_active_publish text;
  v_version integer;
  v_row public.video_project_deliverables;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status is distinct from 'handed_off' then
    raise exception 'REEL_PROJECT_NOT_HANDED_OFF: The shot clips must be handed off to Assets before a final Reel can be uploaded (project is %).', v_project.status;
  end if;
  if v_project.client_production_brief_id is null then
    raise exception 'REEL_BRIEF_NOT_BOUND: A final Reel can only be uploaded to a project bound to an approved production brief.';
  end if;

  select * into v_brief
    from public.client_production_briefs
   where id = v_project.client_production_brief_id
   for share;
  if not found or v_brief.client_id is distinct from p_client_id or v_brief.asset_format is distinct from 'reel_video' then
    raise exception 'REEL_BRIEF_BINDING_INVALID: The project''s bound production brief is no longer a valid reel_video brief.';
  end if;

  select * into v_current
    from public.video_project_deliverables
   where video_project_id = p_video_project_id and is_current
   for update;

  if found then
    select d.publish_status into v_active_publish
      from public.client_distribution_records d
     where d.video_deliverable_id = v_current.id
       and d.publish_status in ('publishing', 'published')
     limit 1;
    if v_active_publish is not null then
      raise exception 'REEL_CURRENT_VERSION_PUBLISHING: Version % is % and cannot be replaced.', v_current.version, v_active_publish;
    end if;
    if v_current.status = 'approved'::public.review_state and coalesce(p_acknowledge_replace_approved, false) = false then
      raise exception 'REEL_REPLACE_APPROVED_UNCONFIRMED: Version % is already approved; confirm the replacement explicitly.', v_current.version;
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.video_project_deliverables
   where video_project_id = p_video_project_id;

  insert into public.video_project_deliverables (
    client_id, video_project_id, client_production_brief_id,
    source_table, source_row_id,
    storage_bucket, storage_path, original_filename,
    mime_type, file_format, file_size_bytes,
    version, is_current, upload_state, status, uploaded_by
  ) values (
    p_client_id, p_video_project_id, v_project.client_production_brief_id,
    case when v_project.organic_master_id is not null then 'organic_master'
         when v_project.ads_master_id is not null then 'ads_master' else null end,
    coalesce(v_project.organic_master_id, v_project.ads_master_id),
    'video-assets',
    p_storage_path_prefix || 'v' || v_version::text || '/' || p_safe_filename,
    p_original_filename,
    p_mime_type, 'mp4', p_file_size_bytes,
    v_version, false, 'reserved', 'needs_review'::public.review_state, p_uploaded_by
  )
  returning * into v_row;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id, 'reel_studio_final_upload_started',
    'A final Reel upload slot was reserved for version ' || v_version::text || '.',
    'video_project', p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id, 'deliverable_id', v_row.id, 'version', v_version,
      'production_brief_id', v_project.client_production_brief_id,
      'file_size_bytes', p_file_size_bytes
    )
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."reserve_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_storage_path_prefix" "text", "p_safe_filename" "text", "p_mime_type" "text", "p_file_size_bytes" bigint, "p_original_filename" "text", "p_uploaded_by" "uuid", "p_acknowledge_replace_approved" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_failed_reel_shot_still"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone) RETURNS "public"."video_shots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_shot public.video_shots;
  v_updated public.video_shots;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Provider retries are unavailable once the project leaves generation.';
  end if;

  select * into v_shot
    from public.video_shots
   where id = p_shot_id and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_SHOT_STALE: Shot changed after this retry was prepared; reload before trying again.';
  end if;
  if v_shot.status is distinct from 'failed' then
    raise exception 'REEL_SHOT_NOT_FAILED: Only a failed shot can be retried (current status %).', v_shot.status;
  end if;
  if public.reel_shot_failure_phase(v_shot) is distinct from 'still' then
    raise exception 'REEL_FAILURE_PHASE_MISMATCH: This shot failed during video generation; use the video retry instead.';
  end if;
  if v_shot.still_image_url is not null then
    raise exception 'REEL_STILL_ALREADY_PRESENT: A still image is already stored for this shot.';
  end if;
  if v_shot.clip_url is not null or v_shot.higgsfield_job_id is not null then
    raise exception 'REEL_VIDEO_STATE_PRESENT: This shot already has video work; the image stage cannot be reset.';
  end if;

  update public.video_shots
     set status = 'pending',
         still_image_job_id = null,
         still_image_model = null,
         error = null,
         failure_stage = null,
         failed_at = null,
         still_attempt_count = v_shot.still_attempt_count + 1,
         last_still_attempt_at = now(),
         updated_at = now()
   where id = p_shot_id
     and status = 'failed'
     and updated_at = p_expected_updated_at
  returning * into v_updated;
  if not found then
    raise exception 'REEL_SHOT_STALE: Shot changed while the retry was being applied; reload before trying again.';
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id,
    'reel_studio_still_retry',
    'A failed Reel Studio image job was reset for retry.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number,
      'failure_stage', coalesce(v_shot.failure_stage, 'unrecorded'),
      'still_attempt_count', v_updated.still_attempt_count
    )
  );

  return v_updated;
end;
$$;


ALTER FUNCTION "public"."reset_failed_reel_shot_still"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_failed_reel_shot_video"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_motion_type" "text" DEFAULT NULL::"text", "p_motion_strength" numeric DEFAULT NULL::numeric) RETURNS "public"."video_shots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.video_projects;
  v_shot public.video_shots;
  v_updated public.video_shots;
  v_motion_type text;
  v_motion_strength numeric;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Provider retries are unavailable once the project leaves generation.';
  end if;

  select * into v_shot
    from public.video_shots
   where id = p_shot_id and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_SHOT_STALE: Shot changed after this retry was prepared; reload before trying again.';
  end if;
  if v_shot.status is distinct from 'failed' then
    raise exception 'REEL_SHOT_NOT_FAILED: Only a failed shot can be retried (current status %).', v_shot.status;
  end if;
  if public.reel_shot_failure_phase(v_shot) is distinct from 'video' then
    raise exception 'REEL_FAILURE_PHASE_MISMATCH: This shot failed during image generation; use the image retry instead.';
  end if;
  if v_shot.clip_url is not null then
    raise exception 'REEL_CLIP_ALREADY_PRESENT: A rendered clip already exists for this shot.';
  end if;
  if v_shot.still_image_url is null then
    raise exception 'REEL_STILL_MISSING: No stored still image exists; retry image generation first.';
  end if;

  -- Motion is preserved unless the operator deliberately changes it.
  v_motion_type := coalesce(nullif(btrim(coalesce(p_motion_type, '')), ''), v_shot.motion_type);
  v_motion_strength := coalesce(p_motion_strength, v_shot.motion_strength);
  if v_motion_type is null or v_motion_strength is null then
    raise exception 'REEL_MOTION_MISSING: A motion and strength must be selected before retrying video generation.';
  end if;
  if v_motion_strength < 0 or v_motion_strength > 1 then
    raise exception 'REEL_MOTION_INVALID: motion_strength must be between 0 and 1.';
  end if;

  update public.video_shots
     set status = 'still_complete',
         higgsfield_job_id = null,
         model = null,
         source_url = null,
         error = null,
         failure_stage = null,
         failed_at = null,
         motion_type = v_motion_type,
         motion_strength = v_motion_strength,
         video_attempt_count = v_shot.video_attempt_count + 1,
         last_video_attempt_at = now(),
         updated_at = now()
   where id = p_shot_id
     and status = 'failed'
     and updated_at = p_expected_updated_at
  returning * into v_updated;
  if not found then
    raise exception 'REEL_SHOT_STALE: Shot changed while the retry was being applied; reload before trying again.';
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id,
    'reel_studio_video_retry',
    'A failed Reel Studio video job was reset for retry; the existing still image was preserved.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number,
      'failure_stage', coalesce(v_shot.failure_stage, 'unrecorded'),
      'motion_changed', (v_motion_type is distinct from v_shot.motion_type)
                        or (v_motion_strength is distinct from v_shot.motion_strength),
      'video_attempt_count', v_updated.video_attempt_count
    )
  );

  return v_updated;
end;
$$;


ALTER FUNCTION "public"."reset_failed_reel_shot_video"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_motion_type" "text", "p_motion_strength" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."retry_distribution_record"("p_record_id" "uuid", "p_override_permanent" boolean DEFAULT false, "p_retry_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("success" boolean, "record_id" "uuid", "previous_status" "text", "new_status" "text", "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare rec public.client_distribution_records; v_prev text; v_next timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null then raise exception 'REFUSED: evidence-bearing record cannot be retried'; end if;
  if rec.publish_status <> 'failed' then raise exception 'REFUSED: retry is only allowed from failed (got %)', rec.publish_status; end if;
  if rec.permanent_failure and not p_override_permanent then raise exception 'REFUSED: permanent failure — an explicit override is required to retry'; end if;
  v_next := coalesce(p_retry_at, now());
  if v_next < now() - interval '60 seconds' then raise exception 'REFUSED: retry time must not be in the past'; end if;
  update public.client_distribution_records
  set publish_status='scheduled', next_attempt_at=v_next, claimed_at=null, claimed_by=null,
      permanent_failure = case when p_override_permanent then false else permanent_failure end,
      last_error = 'Operator retry requested.', updated_at=now()
  where id=p_record_id;
  perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'retry', v_prev, 'scheduled',
    case when p_override_permanent then 'override_permanent_failure' else null end);
  return query select true, p_record_id, v_prev, 'scheduled'::text, 'Re-queued for retry.'::text;
end; $$;


ALTER FUNCTION "public"."retry_distribution_record"("p_record_id" "uuid", "p_override_permanent" boolean, "p_retry_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_asset_group"("p_client_id" "uuid", "p_asset_group_ref" "text", "p_status" "public"."review_state") RETURNS SETOF "public"."client_assets"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user uuid := auth.uid();
  v_role text := public.auth_role();
  v_job public.client_asset_generation_jobs;
  v_expected integer;
  v_actual integer;
  v_override public.client_asset_group_completeness_overrides;
  v_dup integer;
  v_mismatch integer;
  v_current_sequence integer[];
begin
  if v_user is null then raise exception 'AUTH: login required'; end if;
  if coalesce(v_role, '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_status not in ('needs_review','approved','rejected','archived') then raise exception 'invalid review status'; end if;

  select * into v_job
  from public.client_asset_generation_jobs j
  where j.client_id = p_client_id and j.asset_group_ref = p_asset_group_ref
  order by j.created_at desc
  limit 1
  for update;

  perform 1
  from public.client_assets a
  where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true)
  for update;

  if p_status = 'approved' then
    select count(*)::int into v_actual
    from public.client_assets a
    where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true);
    if v_actual < 1 then raise exception 'asset group not found'; end if;

    select count(*)::int into v_dup
    from (
      select sequence_index from public.client_assets
      where client_id = p_client_id and asset_group_ref = p_asset_group_ref and coalesce(is_current, true)
      group by sequence_index having count(*) > 1
    ) d;
    if v_dup > 0 then raise exception 'duplicate current frame state blocks approval'; end if;

    select count(*)::int into v_mismatch
    from public.client_assets a
    where a.client_id = p_client_id
      and a.asset_group_ref = p_asset_group_ref
      and coalesce(a.is_current, true)
      and a.metadata->>'visual_mode' in ('uploaded_background','uploaded_insert')
      and a.metadata->>'image_input_used' = 'false';
    if v_mismatch > 0 then raise exception 'visual input mismatch blocks approval'; end if;

    v_expected := coalesce(v_job.expected_output_count, (
      select max((a.metadata->>'sequence_count')::integer)
      from public.client_assets a
      where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref
        and jsonb_typeof(a.metadata->'sequence_count') = 'number'
    ), v_actual);

    select * into v_override
    from public.client_asset_group_completeness_overrides o
    where o.client_id = p_client_id and o.asset_group_ref = p_asset_group_ref and o.is_active and o.revoked_at is null
    order by o.created_at desc
    limit 1
    for update;

    if exists (
      select 1 from public.client_distribution_records d
      where d.client_id = p_client_id
        and d.asset_group_ref = p_asset_group_ref
        and d.publish_status in ('scheduled','publishing','published','needs_reconciliation')
    ) then raise exception 'asset group has a publication conflict'; end if;

    if v_job.id is not null and v_job.status in ('queued','processing') and coalesce(v_job.closure_type, '') <> 'partial_accepted' then
      raise exception 'generation is still in progress';
    end if;

    select array_agg(a.sequence_index order by a.sequence_index) into v_current_sequence
    from public.client_assets a
    where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true);

    if v_actual < v_expected then
      if v_override.id is null then raise exception 'incomplete group requires partial acceptance before approval'; end if;
      if v_override.accepted_output_count <> v_actual then raise exception 'partial acceptance no longer matches current frame count'; end if;
      if v_override.accepted_sequence_indexes <> v_current_sequence then raise exception 'partial acceptance sequence no longer matches current frames'; end if;
      if exists (
        select 1 from unnest(v_override.accepted_sequence_indexes) seq
        where not exists (
          select 1 from public.client_assets a
          where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true) and a.sequence_index = seq
        )
      ) then raise exception 'partial acceptance sequence no longer matches current frames'; end if;
      if exists (
        select 1 from public.client_assets a
        where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true)
          and not (a.sequence_index = any(v_override.accepted_sequence_indexes))
      ) then raise exception 'unexpected current frame invalidates partial acceptance'; end if;
    elsif v_override.id is not null and v_override.accepted_sequence_indexes <> v_current_sequence then
      raise exception 'partial acceptance sequence no longer matches current frames';
    end if;
  end if;

  return query
    update public.client_assets
    set status = p_status, updated_at = now(),
        metadata = case when p_status = 'approved' then
          metadata || jsonb_build_object(
            'partial_acceptance_override_id', v_override.id,
            'original_expected_count', v_override.original_expected_count,
            'accepted_output_count', v_override.accepted_output_count,
            'accepted_sequence_indexes', v_override.accepted_sequence_indexes
          )
        else metadata end
    where client_id = p_client_id
      and asset_group_ref = p_asset_group_ref
      and coalesce(is_current, true)
    returning *;
end $$;


ALTER FUNCTION "public"."review_asset_group"("p_client_id" "uuid", "p_asset_group_ref" "text", "p_status" "public"."review_state") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_final_reel_deliverable"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_next_status" "text", "p_feedback" "text", "p_reviewed_by" "uuid") RETURNS "public"."video_project_deliverables"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_row public.video_project_deliverables;
  v_updated public.video_project_deliverables;
  v_now timestamptz := now();
begin
  if p_next_status not in ('approved', 'rejected') then
    raise exception 'REEL_REVIEW_STATUS_INVALID: Review status must be approved or rejected.';
  end if;

  select * into v_row
    from public.video_project_deliverables
   where id = p_deliverable_id and video_project_id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_DELIVERABLE_NOT_FOUND: Final Reel does not belong to this project.';
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_DELIVERABLE_STALE: The final Reel changed after this review started; reload before trying again.';
  end if;
  if v_row.upload_state is distinct from 'uploaded' then
    raise exception 'REEL_DELIVERABLE_NOT_UPLOADED: This version has no completed upload.';
  end if;
  if not v_row.is_current or v_row.superseded_at is not null then
    raise exception 'REEL_DELIVERABLE_NOT_CURRENT: Only the current final Reel version can be reviewed.';
  end if;
  if p_next_status = 'rejected' and length(btrim(coalesce(p_feedback, ''))) < 8 then
    raise exception 'REEL_REVIEW_FEEDBACK_REQUIRED: Revision feedback is required.';
  end if;
  if p_next_status = 'approved' and exists (
    select 1 from public.client_distribution_records d
     where d.video_deliverable_id = p_deliverable_id and d.publish_status = 'published'
  ) then
    raise exception 'REEL_ALREADY_PUBLISHED: This version is already published and cannot be re-reviewed.';
  end if;

  update public.video_project_deliverables
     set status = p_next_status::public.review_state,
         reviewed_by = p_reviewed_by,
         reviewed_at = v_now,
         review_feedback = case when p_next_status = 'rejected' then btrim(p_feedback) else null end,
         updated_at = v_now
   where id = p_deliverable_id
     and updated_at = p_expected_updated_at
  returning * into v_updated;
  if not found then
    raise exception 'REEL_DELIVERABLE_STALE: The final Reel changed while the review was being applied.';
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id,
    case when p_next_status = 'approved' then 'reel_studio_final_approved' else 'reel_studio_final_revision_requested' end,
    case when p_next_status = 'approved'
         then 'Final Reel version ' || v_updated.version::text || ' was approved for distribution.'
         else 'Final Reel version ' || v_updated.version::text || ' was returned for revision.' end,
    'video_project', p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id, 'deliverable_id', p_deliverable_id,
      'version', v_updated.version, 'production_brief_id', v_updated.client_production_brief_id,
      'new_status', p_next_status
    )
  );

  return v_updated;
end;
$$;


ALTER FUNCTION "public"."review_final_reel_deliverable"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_next_status" "text", "p_feedback" "text", "p_reviewed_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_performance_analysis_for_client"("p_client_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_id uuid;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  insert into public.client_performance_analysis_runs(client_id,run_mode,status) values(p_client_id,'manual','running') returning id into v_id;
  return v_id;
end $$;


ALTER FUNCTION "public"."run_performance_analysis_for_client"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."schedule_distribution_record"("p_record_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_timezone" "text" DEFAULT NULL::"text", "p_planned_date" "date" DEFAULT NULL::"date") RETURNS TABLE("success" boolean, "record_id" "uuid", "previous_status" "text", "new_status" "text", "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare rec public.client_distribution_records; v_prev text; v_settings jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.publish_status = 'published' or rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null then
    raise exception 'REFUSED: published or evidence-bearing record cannot be scheduled'; end if;
  if rec.publish_status not in ('ready','failed','cancelled','scheduled') then raise exception 'REFUSED: cannot schedule from status %', rec.publish_status; end if;
  if p_scheduled_at is null or p_scheduled_at < now() - interval '60 seconds' then raise exception 'REFUSED: scheduled time must be in the future'; end if;
  v_settings := coalesce(rec.publish_settings, '{}'::jsonb);
  if p_timezone is not null then v_settings := jsonb_set(v_settings, '{meta}', coalesce(v_settings->'meta','{}'::jsonb) || jsonb_build_object('timezone', p_timezone), true); end if;
  update public.client_distribution_records
  set publish_status='scheduled', publish_mode='scheduled', scheduled_publish_at=p_scheduled_at,
      planned_publish_date=coalesce(p_planned_date, planned_publish_date), publish_settings=v_settings,
      claimed_at=null, claimed_by=null, permanent_failure=false, next_attempt_at=null, last_error=null, updated_at=now()
  where id=p_record_id;
  perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'schedule', v_prev, 'scheduled', null);
  return query select true, p_record_id, v_prev, 'scheduled'::text, 'Scheduled.'::text;
end; $$;


ALTER FUNCTION "public"."schedule_distribution_record"("p_record_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_timezone" "text", "p_planned_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_ai_background_prompt"("p_generation_id" "uuid", "p_prompt_text" "text" DEFAULT NULL::"text", "p_new_status" "text" DEFAULT NULL::"text", "p_review_note" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_row public.client_ai_background_image_generations; v_brief public.client_production_briefs; v_prompt text; v_status text; v_fingerprint text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into v_row from public.client_ai_background_image_generations where id=p_generation_id for update;
  if not found then raise exception 'NOT_FOUND: AI background prompt'; end if;
  v_prompt := coalesce(nullif(trim(p_prompt_text),''),v_row.prompt_text);
  v_status := coalesce(nullif(trim(p_new_status),''),v_row.prompt_status);
  if p_prompt_text is not null and v_row.prompt_status not in ('draft','failed') then raise exception 'VALIDATION: only draft prompts can be edited'; end if;
  if length(trim(v_prompt))=0 then raise exception 'VALIDATION: prompt cannot be blank'; end if;
  if v_status is distinct from v_row.prompt_status and not (
    (v_row.prompt_status='draft' and v_status in ('needs_review','rejected')) or
    (v_row.prompt_status='needs_review' and v_status in ('approved','rejected')) or
    (v_row.prompt_status='approved' and v_status='rejected') or
    (v_row.prompt_status='failed' and v_status='draft')
  ) then raise exception 'VALIDATION: invalid prompt status transition'; end if;
  if v_status='approved' and v_status is distinct from v_row.prompt_status then
    select * into v_brief from public.client_production_briefs where id=v_row.production_brief_id and client_id=v_row.client_id for share;
    if not found or v_brief.source_ref is distinct from v_row.source_ref or v_brief.asset_format is distinct from v_row.format or v_brief.status is distinct from 'approved'::public.review_state then
      raise exception 'STALE_BRIEF: linked production brief is missing, mismatched, or not approved; create a new prompt draft';
    end if;
    v_fingerprint := md5(concat_ws(E'\n',v_brief.title,v_brief.source_ref,v_brief.asset_format,v_brief.content_md,v_brief.version::text));
    if v_fingerprint is distinct from v_row.brief_fingerprint_at_prompt then
      raise exception 'STALE_BRIEF: production brief changed after prompt creation; create a new prompt draft';
    end if;
  end if;
  update public.client_ai_background_image_generations set prompt_text=v_prompt,prompt_status=v_status,
    prompt_approved_by=case when v_status='approved' then case when auth.role()='service_role' then 'system' else auth.uid()::text end else prompt_approved_by end,
    prompt_approved_at=case when v_status='approved' then now() else prompt_approved_at end,
    brief_fingerprint_at_approval=case when v_status='approved' then v_fingerprint else brief_fingerprint_at_approval end,
    error_message=case when v_status='draft' then null else error_message end,updated_at=now()
  where id=v_row.id;
  if v_status is distinct from v_row.prompt_status then
    insert into public.client_ai_background_image_reviews(client_id,generation_id,previous_status,new_status,review_note,reviewed_by)
    values(v_row.client_id,v_row.id,v_row.prompt_status,v_status,nullif(trim(p_review_note),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);
    insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
    values(v_row.client_id,'ai_background_prompt_'||v_status,'AI background prompt marked '||replace(v_status,'_',' ')||' for '||v_row.source_ref||'.','client_ai_background_image_generation',v_row.id,jsonb_build_object('previous_status',v_row.prompt_status,'new_status',v_status));
  end if;
end $$;


ALTER FUNCTION "public"."update_ai_background_prompt"("p_generation_id" "uuid", "p_prompt_text" "text", "p_new_status" "text", "p_review_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_context_patch_draft_status"("p_patch_draft_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_patch public.client_context_patch_drafts;
  v_event text;
  v_label text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  select * into v_patch from public.client_context_patch_drafts where id=p_patch_draft_id for update;
  if not found then raise exception 'NOT_FOUND: context patch draft'; end if;
  if not (
    (v_patch.status='draft' and p_new_status in ('needs_review','dismissed')) or
    (v_patch.status='needs_review' and p_new_status in ('approved','dismissed')) or
    (v_patch.status='approved' and p_new_status='dismissed') or
    (v_patch.status='dismissed' and p_new_status='dismissed')
  ) then raise exception 'VALIDATION: invalid patch status transition'; end if;
  if p_new_status in ('needs_review','approved') and nullif(trim(coalesce(v_patch.proposed_content,'')),'') is null
     and nullif(trim(coalesce(v_patch.proposed_diff,'')),'') is null then
    raise exception 'VALIDATION: proposed content or diff required before review';
  end if;

  update public.client_context_patch_drafts set status=p_new_status,reviewer_notes=nullif(trim(p_reviewer_notes),''),
    reviewed_at=now(),updated_at=now() where id=v_patch.id;
  insert into public.client_context_patch_reviews(client_id,patch_draft_id,previous_status,new_status,review_note,reviewed_by)
  values(v_patch.client_id,v_patch.id,v_patch.status,p_new_status,nullif(trim(p_reviewer_notes),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);
  v_event:=case p_new_status when 'needs_review' then 'context_patch_draft_submitted' when 'approved' then 'context_patch_draft_approved' else 'context_patch_draft_dismissed' end;
  v_label:=case p_new_status when 'needs_review' then 'submitted for review' when 'approved' then 'approved' else 'dismissed' end;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(v_patch.client_id,v_event,'Context patch draft '||v_label||' for '||coalesce(v_patch.target_file_name,'context file')||'.','client_context_patch_draft',v_patch.id,
    jsonb_build_object('previous_status',v_patch.status,'new_status',p_new_status,'target_file_id',v_patch.target_file_id));
end $$;


ALTER FUNCTION "public"."update_context_patch_draft_status"("p_patch_draft_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_context_update_proposal_status"("p_proposal_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_proposal public.client_context_update_proposals;
  v_event text;
  v_label text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  select * into v_proposal from public.client_context_update_proposals where id = p_proposal_id for update;
  if not found then raise exception 'NOT_FOUND: context update proposal'; end if;
  if not (
    (v_proposal.status = 'needs_review' and p_new_status in ('approved','dismissed')) or
    (v_proposal.status = 'approved' and p_new_status in ('converted_to_patch','dismissed')) or
    (v_proposal.status = 'dismissed' and p_new_status = 'dismissed')
  ) then raise exception 'VALIDATION: invalid status transition'; end if;

  update public.client_context_update_proposals set
    status = p_new_status,
    reviewer_notes = nullif(trim(p_reviewer_notes),''),
    reviewed_at = now(),
    converted_at = case when p_new_status = 'converted_to_patch' then now() else converted_at end,
    updated_at = now()
  where id = v_proposal.id;

  insert into public.client_context_update_reviews(client_id,proposal_id,previous_status,new_status,review_note,reviewed_by)
  values(v_proposal.client_id,v_proposal.id,v_proposal.status,p_new_status,nullif(trim(p_reviewer_notes),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);

  v_event := case p_new_status when 'approved' then 'context_update_proposal_approved' when 'dismissed' then 'context_update_proposal_dismissed' else 'context_update_proposal_converted_to_patch' end;
  v_label := case p_new_status when 'approved' then 'approved in principle' when 'dismissed' then 'dismissed' else 'marked ready for a later patch gate' end;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(v_proposal.client_id,v_event,'Context update proposal '||v_label||case when v_proposal.source_ref is null then '.' else ' for '||v_proposal.source_ref||'.' end,
    'client_context_update_proposal',v_proposal.id,jsonb_build_object('previous_status',v_proposal.status,'new_status',p_new_status));
end $$;


ALTER FUNCTION "public"."update_context_update_proposal_status"("p_proposal_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_context_update_proposal_status"("p_proposal_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") IS 'Records review state only; converted_to_patch remains a marker and does not create or apply a patch.';



CREATE OR REPLACE FUNCTION "public"."update_iteration_candidate_status"("p_candidate_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare c public.client_iteration_candidates; v_event text; v_label text;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into c from public.client_iteration_candidates where id=p_candidate_id for update; if not found then raise exception 'NOT_FOUND: iteration candidate'; end if;
  if not ((c.status='needs_review' and p_new_status in ('approved','dismissed')) or (c.status='approved' and p_new_status in ('converted','dismissed')) or (c.status='dismissed' and p_new_status='dismissed')) then raise exception 'VALIDATION: invalid status transition'; end if;
  update public.client_iteration_candidates set status=p_new_status,reviewer_notes=nullif(trim(p_reviewer_notes),''),reviewed_at=now(),converted_at=case when p_new_status='converted' then now() else converted_at end,updated_at=now() where id=c.id;
  insert into public.client_iteration_reviews(client_id,iteration_candidate_id,previous_status,new_status,review_note,reviewed_by) values(c.client_id,c.id,c.status,p_new_status,nullif(trim(p_reviewer_notes),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);
  v_event:=case p_new_status when 'approved' then 'iteration_candidate_approved' when 'dismissed' then 'iteration_candidate_dismissed' else 'iteration_candidate_converted' end;
  v_label:=case p_new_status when 'approved' then 'approved' when 'dismissed' then 'dismissed' else 'marked converted for future workflow' end;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(c.client_id,v_event,'Iteration candidate '||v_label||case when c.source_ref is null then '.' else ' for '||c.source_ref||'.' end,'client_iteration_candidate',c.id,jsonb_build_object('previous_status',c.status,'new_status',p_new_status));
end $$;


ALTER FUNCTION "public"."update_iteration_candidate_status"("p_candidate_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_performance_insight_status"("p_insight_id" "uuid", "p_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_status not in ('open','accepted','dismissed','converted_to_iteration') then raise exception 'VALIDATION: invalid status'; end if;
  update public.client_performance_insights set status=p_status,updated_at=now() where id=p_insight_id; if not found then raise exception 'NOT_FOUND: insight'; end if;
end $$;


ALTER FUNCTION "public"."update_performance_insight_status"("p_insight_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_business_signal_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "distribution_record_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "signal_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile_visits" integer,
    "follows" integer,
    "inbound_dms" integer,
    "qualified_dms" integer,
    "conversations" integer,
    "qualified_conversations" integer,
    "appointments" integer,
    "qualified_appointments" integer,
    "show_ups" integer,
    "cash_collected" numeric(14,2),
    "operator_notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_business_signal_snapshots_appointments_check" CHECK ((("appointments" IS NULL) OR ("appointments" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_cash_collected_check" CHECK ((("cash_collected" IS NULL) OR ("cash_collected" >= (0)::numeric))),
    CONSTRAINT "client_business_signal_snapshots_conversations_check" CHECK ((("conversations" IS NULL) OR ("conversations" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_follows_check" CHECK ((("follows" IS NULL) OR ("follows" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_inbound_dms_check" CHECK ((("inbound_dms" IS NULL) OR ("inbound_dms" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_profile_visits_check" CHECK ((("profile_visits" IS NULL) OR ("profile_visits" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_qualified_appointments_check" CHECK ((("qualified_appointments" IS NULL) OR ("qualified_appointments" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_qualified_conversations_check" CHECK ((("qualified_conversations" IS NULL) OR ("qualified_conversations" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_qualified_dms_check" CHECK ((("qualified_dms" IS NULL) OR ("qualified_dms" >= 0))),
    CONSTRAINT "client_business_signal_snapshots_show_ups_check" CHECK ((("show_ups" IS NULL) OR ("show_ups" >= 0)))
);


ALTER TABLE "public"."client_business_signal_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_business_signal_snapshots" IS 'Manual commercial outcomes attributed to published distribution records.';



CREATE OR REPLACE FUNCTION "public"."upsert_business_signal_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid" DEFAULT NULL::"uuid", "p_signal_at" timestamp with time zone DEFAULT "now"(), "p_profile_visits" integer DEFAULT NULL::integer, "p_follows" integer DEFAULT NULL::integer, "p_inbound_dms" integer DEFAULT NULL::integer, "p_qualified_dms" integer DEFAULT NULL::integer, "p_conversations" integer DEFAULT NULL::integer, "p_qualified_conversations" integer DEFAULT NULL::integer, "p_appointments" integer DEFAULT NULL::integer, "p_qualified_appointments" integer DEFAULT NULL::integer, "p_show_ups" integer DEFAULT NULL::integer, "p_cash_collected" numeric DEFAULT NULL::numeric, "p_operator_notes" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."client_business_signal_snapshots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d public.client_distribution_records; v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into d from public.client_distribution_records where id=p_distribution_record_id for share;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_distribution_record_id; end if;
  if d.publish_status <> 'published' and d.external_post_id is null and d.published_at is null and d.published_url is null then raise exception 'REFUSED: business signals require published evidence'; end if;
  if p_signal_at is null then raise exception 'VALIDATION: signal_at is required'; end if;
  if p_profile_visits < 0 or p_follows < 0 or p_inbound_dms < 0 or p_qualified_dms < 0 or p_conversations < 0 or p_qualified_conversations < 0 or p_appointments < 0 or p_qualified_appointments < 0 or p_show_ups < 0 or p_cash_collected < 0 then raise exception 'VALIDATION: business signals must be non-negative'; end if;
  if p_snapshot_id is null then
    insert into public.client_business_signal_snapshots (client_id,distribution_record_id,source_ref,signal_at,profile_visits,follows,inbound_dms,qualified_dms,conversations,qualified_conversations,appointments,qualified_appointments,show_ups,cash_collected,operator_notes,created_by)
    values (d.client_id,d.id,d.source_ref,p_signal_at,p_profile_visits,p_follows,p_inbound_dms,p_qualified_dms,p_conversations,p_qualified_conversations,p_appointments,p_qualified_appointments,p_show_ups,p_cash_collected,nullif(trim(p_operator_notes),''),auth.uid()) returning id into v_id;
  else
    update public.client_business_signal_snapshots set signal_at=p_signal_at,profile_visits=p_profile_visits,follows=p_follows,inbound_dms=p_inbound_dms,qualified_dms=p_qualified_dms,conversations=p_conversations,qualified_conversations=p_qualified_conversations,appointments=p_appointments,qualified_appointments=p_qualified_appointments,show_ups=p_show_ups,cash_collected=p_cash_collected,operator_notes=nullif(trim(p_operator_notes),''),updated_at=now()
    where id=p_snapshot_id and client_id=d.client_id and distribution_record_id=d.id returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND: business signal snapshot %', p_snapshot_id; end if;
  end if;
  insert into public.activity_log (client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values (d.client_id,'business_signals_recorded','Business signals recorded for ' || d.source_ref || '.','client_business_signal_snapshot',v_id,
    jsonb_build_object('distribution_record_id',d.id,'source_ref',d.source_ref,'operator_user_id',auth.uid()));
  return query select * from public.client_business_signal_snapshots where id=v_id;
end; $$;


ALTER FUNCTION "public"."upsert_business_signal_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_signal_at" timestamp with time zone, "p_profile_visits" integer, "p_follows" integer, "p_inbound_dms" integer, "p_qualified_dms" integer, "p_conversations" integer, "p_qualified_conversations" integer, "p_appointments" integer, "p_qualified_appointments" integer, "p_show_ups" integer, "p_cash_collected" numeric, "p_operator_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_distribution_draft"("p_client_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_asset_group_ref" "text", "p_sequence_index" integer, "p_sequence_count" integer, "p_production_brief_id" "uuid", "p_asset_format" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") RETURNS "public"."client_distribution_records"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare rec public.client_distribution_records; existing public.client_distribution_records;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into existing from public.client_distribution_records
    where client_id=p_client_id and asset_group_ref=p_asset_group_ref and sequence_index=coalesce(p_sequence_index,1) for update;
  if found then
    if existing.publish_status <> 'ready' then return existing; end if;
    update public.client_distribution_records
    set production_brief_id=p_production_brief_id, asset_format=p_asset_format, title=p_title, sequence_count=p_sequence_count,
        planned_publish_date=p_planned_date, publish_payload=coalesce(p_publish_payload,'{}'::jsonb), publish_settings=coalesce(p_publish_settings,'{}'::jsonb),
        execution_month=p_execution_month, updated_at=now()
    where id=existing.id returning * into rec;
    return rec;
  end if;
  insert into public.client_distribution_records (
    client_id, execution_month, source_ref, asset_group_ref, sequence_index, sequence_count,
    production_brief_id, asset_format, title, publish_status, platform, planned_publish_date, publish_payload, publish_settings
  ) values (
    p_client_id, p_execution_month, p_source_ref, p_asset_group_ref, coalesce(p_sequence_index,1), p_sequence_count,
    p_production_brief_id, p_asset_format, p_title, 'ready', 'instagram', p_planned_date, coalesce(p_publish_payload,'{}'::jsonb), coalesce(p_publish_settings,'{}'::jsonb)
  ) returning * into rec;
  return rec;
end; $$;


ALTER FUNCTION "public"."upsert_distribution_draft"("p_client_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_asset_group_ref" "text", "p_sequence_index" integer, "p_sequence_count" integer, "p_production_brief_id" "uuid", "p_asset_format" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_metric_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "distribution_record_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "platform" "text" DEFAULT 'instagram'::"text" NOT NULL,
    "content_format" "text" NOT NULL,
    "snapshot_at" timestamp with time zone NOT NULL,
    "snapshot_label" "text" DEFAULT 'manual'::"text" NOT NULL,
    "collection_method" "text" DEFAULT 'manual'::"text" NOT NULL,
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "evidence_url" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_metric_snapshots_collection_method_check" CHECK (("collection_method" = ANY (ARRAY['manual'::"text", 'api_later'::"text", 'api'::"text"]))),
    CONSTRAINT "client_metric_snapshots_metrics_check" CHECK (("jsonb_typeof"("metrics") = 'object'::"text")),
    CONSTRAINT "client_metric_snapshots_snapshot_label_check" CHECK (("snapshot_label" = ANY (ARRAY['manual'::"text", 't_plus_1h'::"text", 't_plus_6h'::"text", 't_plus_24h'::"text", 't_plus_48h'::"text", 't_plus_7d'::"text", 'story_t_plus_1h'::"text", 'story_t_plus_6h'::"text", 'story_t_plus_23h'::"text"])))
);


ALTER TABLE "public"."client_metric_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_metric_snapshots" IS 'Point-in-time manual/API-later platform metrics for published distribution records.';



CREATE OR REPLACE FUNCTION "public"."upsert_manual_metric_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid" DEFAULT NULL::"uuid", "p_snapshot_at" timestamp with time zone DEFAULT "now"(), "p_snapshot_label" "text" DEFAULT 'manual'::"text", "p_metrics" "jsonb" DEFAULT '{}'::"jsonb", "p_notes" "text" DEFAULT NULL::"text", "p_evidence_url" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."client_metric_snapshots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  d public.client_distribution_records;
  v_id uuid;
  v_allowed text[];
  pair record;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into d from public.client_distribution_records where id = p_distribution_record_id for share;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_distribution_record_id; end if;
  if d.publish_status <> 'published' and d.external_post_id is null and d.published_at is null and d.published_url is null then
    raise exception 'REFUSED: analytics requires a published or evidence-bearing distribution record';
  end if;
  if p_snapshot_at is null then raise exception 'VALIDATION: snapshot_at is required'; end if;
  if p_snapshot_label not in ('manual','t_plus_1h','t_plus_6h','t_plus_24h','t_plus_48h','t_plus_7d') then raise exception 'VALIDATION: unsupported snapshot label'; end if;
  if jsonb_typeof(coalesce(p_metrics, '{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: metrics must be an object'; end if;
  v_allowed := case when upper(coalesce(d.publish_settings->>'content_type','')) = 'STORIES' or lower(d.asset_format) like '%story%'
    then array['impressions','reach','replies','shares','profile_visits','follows','taps_forward','taps_back','exits','completion_rate']
    else array['impressions','reach','likes','comments','shares','saves','profile_visits','follows','website_clicks'] end;
  for pair in select key, value from jsonb_each(coalesce(p_metrics, '{}'::jsonb)) loop
    if not (pair.key = any(v_allowed)) then raise exception 'VALIDATION: unsupported metric % for %', pair.key, d.asset_format; end if;
    if jsonb_typeof(pair.value) <> 'number' or (pair.value #>> '{}')::numeric < 0 then raise exception 'VALIDATION: metric % must be non-negative', pair.key; end if;
    if pair.key = 'completion_rate' and (pair.value #>> '{}')::numeric > 100 then raise exception 'VALIDATION: completion_rate must be 0-100'; end if;
  end loop;
  if p_snapshot_id is null then
    insert into public.client_metric_snapshots (client_id, distribution_record_id, source_ref, platform, content_format, snapshot_at, snapshot_label, collection_method, metrics, notes, evidence_url, created_by)
    values (d.client_id, d.id, d.source_ref, coalesce(d.platform,'instagram'), d.asset_format, p_snapshot_at, p_snapshot_label, 'manual', coalesce(p_metrics,'{}'::jsonb), nullif(trim(p_notes),''), nullif(trim(p_evidence_url),''), auth.uid()) returning id into v_id;
  else
    update public.client_metric_snapshots set snapshot_at=p_snapshot_at, snapshot_label=p_snapshot_label, metrics=coalesce(p_metrics,'{}'::jsonb), notes=nullif(trim(p_notes),''), evidence_url=nullif(trim(p_evidence_url),''), updated_at=now()
    where id=p_snapshot_id and client_id=d.client_id and distribution_record_id=d.id and collection_method='manual' returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND: editable manual metric snapshot %', p_snapshot_id; end if;
  end if;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (d.client_id, 'manual_metrics_recorded', 'Manual metrics recorded for ' || d.source_ref || '.', 'client_metric_snapshot', v_id,
    jsonb_build_object('distribution_record_id',d.id,'source_ref',d.source_ref,'snapshot_label',p_snapshot_label,'operator_user_id',auth.uid()));
  return query select * from public.client_metric_snapshots where id=v_id;
end; $$;


ALTER FUNCTION "public"."upsert_manual_metric_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_snapshot_at" timestamp with time zone, "p_snapshot_label" "text", "p_metrics" "jsonb", "p_notes" "text", "p_evidence_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_performance_score"("p_distribution_record_id" "uuid", "p_latest_metric_snapshot_id" "uuid", "p_latest_business_signal_snapshot_id" "uuid", "p_score_version" "text", "p_attention" numeric, "p_engagement" numeric, "p_trust" numeric, "p_conversion" numeric, "p_overall" numeric, "p_sample_quality" "text", "p_score_status" "text", "p_score_reasons" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  d public.client_distribution_records;
  v_id uuid;
begin
  if auth.role() <> 'service_role'
     and (auth.uid() is null or coalesce(public.auth_role(), '') not in ('admin', 'account_manager', 'editor')) then
    raise exception 'AUTH: staff role required';
  end if;

  select * into d
  from public.client_distribution_records
  where id = p_distribution_record_id
  for share;

  if not found or d.publish_status <> 'published' or d.external_post_id is null then
    raise exception 'REFUSED: published evidence required';
  end if;

  if p_latest_metric_snapshot_id is not null
     and not exists (
       select 1
       from public.client_metric_snapshots s
       where s.id = p_latest_metric_snapshot_id
         and s.client_id = d.client_id
         and s.distribution_record_id = d.id
     ) then
    raise exception 'VALIDATION: metric snapshot does not belong to this distribution record';
  end if;

  if p_latest_business_signal_snapshot_id is not null
     and not exists (
       select 1
       from public.client_business_signal_snapshots s
       where s.id = p_latest_business_signal_snapshot_id
         and s.client_id = d.client_id
         and s.distribution_record_id = d.id
     ) then
    raise exception 'VALIDATION: business signal snapshot does not belong to this distribution record';
  end if;

  if p_attention not between 0 and 100
     or p_engagement not between 0 and 100
     or p_trust not between 0 and 100
     or p_conversion not between 0 and 100
     or p_overall not between 0 and 100 then
    raise exception 'VALIDATION: scores must be 0-100';
  end if;

  insert into public.client_performance_scores (
    client_id, distribution_record_id, source_ref, content_format, platform,
    latest_metric_snapshot_id, latest_business_signal_snapshot_id, score_version,
    attention_score, engagement_score, trust_score, conversion_signal_score,
    overall_score, sample_quality, score_status, score_reasons, computed_at
  ) values (
    d.client_id, d.id, d.source_ref, d.asset_format, coalesce(d.platform, 'instagram'),
    p_latest_metric_snapshot_id, p_latest_business_signal_snapshot_id, p_score_version,
    p_attention, p_engagement, p_trust, p_conversion, p_overall,
    p_sample_quality, p_score_status, coalesce(p_score_reasons, '[]'::jsonb), now()
  )
  on conflict (distribution_record_id) do update set
    latest_metric_snapshot_id = excluded.latest_metric_snapshot_id,
    latest_business_signal_snapshot_id = excluded.latest_business_signal_snapshot_id,
    score_version = excluded.score_version,
    attention_score = excluded.attention_score,
    engagement_score = excluded.engagement_score,
    trust_score = excluded.trust_score,
    conversion_signal_score = excluded.conversion_signal_score,
    overall_score = excluded.overall_score,
    sample_quality = excluded.sample_quality,
    score_status = excluded.score_status,
    score_reasons = excluded.score_reasons,
    computed_at = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end
$$;


ALTER FUNCTION "public"."upsert_performance_score"("p_distribution_record_id" "uuid", "p_latest_metric_snapshot_id" "uuid", "p_latest_business_signal_snapshot_id" "uuid", "p_score_version" "text", "p_attention" numeric, "p_engagement" numeric, "p_trust" numeric, "p_conversion" numeric, "p_overall" numeric, "p_sample_quality" "text", "p_score_status" "text", "p_score_reasons" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_performance_score"("p_distribution_record_id" "uuid", "p_latest_metric_snapshot_id" "uuid", "p_latest_business_signal_snapshot_id" "uuid", "p_score_version" "text", "p_attention" numeric, "p_engagement" numeric, "p_trust" numeric, "p_conversion" numeric, "p_overall" numeric, "p_sample_quality" "text", "p_score_status" "text", "p_score_reasons" "jsonb") IS 'Upserts a deterministic score for published evidence and validates optional snapshots belong to the same client and distribution record.';



CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "actor_id" "uuid",
    "event_type" "text" NOT NULL,
    "plain_english_message" "text" NOT NULL,
    "object_type" "text",
    "object_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ad_creative" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "parent_ad_ref" "text" NOT NULL,
    "creative_id" "text" NOT NULL,
    "creative_source_type" "text",
    "creative_source_ref" "text",
    "hook_angle" "text",
    "format" "text",
    "status" "text",
    "spend" numeric(12,2),
    "impressions" integer,
    "clicks" integer,
    "leads" integer,
    "conversations" integer,
    "cpl" numeric(12,2),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ad_creative_creative_source_type_check" CHECK (("creative_source_type" = ANY (ARRAY['organic'::"text", 'uploaded'::"text", 'generated'::"text", 'proof'::"text"])))
);


ALTER TABLE "public"."ad_creative" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ads_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "ref" "text" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "status" "public"."ad_status" DEFAULT 'planned'::"public"."ad_status" NOT NULL,
    "lane" "text" NOT NULL,
    "stint_name" "text",
    "objective" "text",
    "funnel_stage" "text",
    "start_date" "date",
    "end_date" "date",
    "days" integer,
    "budget_split" "text",
    "primary_goal" "text",
    "conversion_action" "text",
    "meta_objective" "text",
    "audience" "text",
    "creative_source" "text",
    "hook_angle" "text",
    "kpi_watch" "text",
    "feeds_into" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ads_master_lane_check" CHECK (("lane" = ANY (ARRAY['Ad 1'::"text", 'Ad 2'::"text", 'Ad 3'::"text"])))
);


ALTER TABLE "public"."ads_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_brief_index" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "execution_month" "text" NOT NULL,
    "brief_id" "text" NOT NULL,
    "source_ref" "text" NOT NULL,
    "source_ref_type" "public"."source_ref_type" NOT NULL,
    "asset_type" "text",
    "platform" "text",
    "required_source_files" "jsonb" DEFAULT '[]'::"jsonb",
    "required_proof_ids" "jsonb" DEFAULT '[]'::"jsonb",
    "cta" "text",
    "production_status" "public"."production_status" DEFAULT 'not_started'::"public"."production_status" NOT NULL,
    "review_requirement" boolean DEFAULT true NOT NULL,
    "owner_user_id" "uuid",
    "notes" "text",
    "status" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "created_by" "uuid",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_brief_index" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "asset_id" "text" NOT NULL,
    "source" "text",
    "uploader" "uuid",
    "file_path" "text",
    "storage_bucket" "text",
    "asset_type" "text",
    "linked_ref" "text",
    "linked_proof_id" "text",
    "status" "text",
    "approval_status" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "table_name" "text" NOT NULL,
    "record_id" "text",
    "action" "text" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "automation_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "run_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status" "public"."automation_run_status" DEFAULT 'running'::"public"."automation_run_status" NOT NULL,
    "input" "jsonb" DEFAULT '{}'::"jsonb",
    "output" "jsonb" DEFAULT '{}'::"jsonb",
    "error_message" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."automation_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "automation_type" "public"."automation_type" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "required_secret_names" "jsonb" DEFAULT '[]'::"jsonb",
    "configured" boolean DEFAULT false NOT NULL,
    "schedule_cron" "text",
    "last_run_at" timestamp with time zone,
    "next_run_at" timestamp with time zone,
    "status" "text" DEFAULT 'idle'::"text",
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."automations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_prompt_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "block_type" "text" DEFAULT 'brand_dna'::"text" NOT NULL,
    "version" integer NOT NULL,
    "name" "text" NOT NULL,
    "grade_block" "text",
    "lens_block" "text",
    "mood_block" "text",
    "motion_block" "text",
    "negative_block" "text",
    "prompt_block" "text",
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "brand_prompt_blocks_block_type_check" CHECK (("block_type" = ANY (ARRAY['brand_dna'::"text", 'brand_sting'::"text"]))),
    CONSTRAINT "brand_prompt_blocks_dna_fields" CHECK ((("block_type" <> 'brand_dna'::"text") OR (("btrim"(COALESCE("grade_block", ''::"text")) <> ''::"text") AND ("btrim"(COALESCE("lens_block", ''::"text")) <> ''::"text") AND ("btrim"(COALESCE("mood_block", ''::"text")) <> ''::"text") AND ("btrim"(COALESCE("motion_block", ''::"text")) <> ''::"text") AND ("btrim"(COALESCE("negative_block", ''::"text")) <> ''::"text")))),
    CONSTRAINT "brand_prompt_blocks_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "brand_prompt_blocks_sting_fields" CHECK ((("block_type" <> 'brand_sting'::"text") OR ("btrim"(COALESCE("prompt_block", ''::"text")) <> ''::"text"))),
    CONSTRAINT "brand_prompt_blocks_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."brand_prompt_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_cells" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "date" "date" NOT NULL,
    "row_type" "public"."calendar_row_type" NOT NULL,
    "ref" "text" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'approved'::"public"."review_state" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."calendar_cells" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_ai_background_image_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "generation_id" "uuid" NOT NULL,
    "previous_status" "text",
    "new_status" "text" NOT NULL,
    "review_note" "text",
    "reviewed_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_ai_background_image_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ai_background_image_reviews" IS 'Audit trail for human prompt review transitions.';



CREATE TABLE IF NOT EXISTS "public"."client_analytics_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "execution_month" "text" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_group_ref" "text" NOT NULL,
    "distribution_record_id" "uuid",
    "production_brief_id" "uuid",
    "asset_format" "text",
    "title" "text",
    "platform" "text" DEFAULT 'instagram'::"text",
    "published_at" timestamp with time zone NOT NULL,
    "published_url" "text",
    "external_post_id" "text",
    "collection_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "analytics_status" "text" DEFAULT 'awaiting_metrics'::"text" NOT NULL,
    "notes" "text",
    "sequence_index" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "client_analytics_records_analytics_status_check" CHECK (("analytics_status" = ANY (ARRAY['awaiting_metrics'::"text", 'metrics_partial'::"text", 'complete'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_analytics_records_collection_status_check" CHECK (("collection_status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'closed'::"text"]))),
    CONSTRAINT "client_analytics_records_execution_month_check" CHECK (("execution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "client_analytics_records_sequence_index_check" CHECK (("sequence_index" > 0))
);


ALTER TABLE "public"."client_analytics_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_asset_archive_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "execution_month" "text" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_group_ref" "text",
    "stage" "text" NOT NULL,
    "title" "text",
    "asset_format" "text",
    "source_table" "text" NOT NULL,
    "source_row_id" "uuid",
    "snapshot_data" "jsonb" NOT NULL,
    "snapshot_md" "text",
    "snapshot_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "superseded_at" timestamp with time zone,
    "superseded_reason" "text",
    "superseded_by_operation_id" "uuid",
    CONSTRAINT "client_asset_archive_snapshots_execution_month_check" CHECK (("execution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "client_asset_archive_snapshots_stage_check" CHECK (("stage" = ANY (ARRAY['master'::"text", 'content_creation'::"text", 'assets'::"text", 'distribution'::"text", 'analytics'::"text", 'analysis'::"text"])))
);


ALTER TABLE "public"."client_asset_archive_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_asset_generation_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "production_brief_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_group_ref" "text" NOT NULL,
    "asset_format" "text" NOT NULL,
    "expected_output_count" integer NOT NULL,
    "completed_output_count" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "visual_mode" "text",
    "generation_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "closed_by" "uuid",
    "closure_reason" "text",
    "closure_type" "text",
    "accepted_partial" boolean DEFAULT false NOT NULL,
    "accepted_output_count" integer,
    "accepted_sequence_indexes" integer[],
    CONSTRAINT "client_asset_generation_jobs_accepted_output_count_check" CHECK ((("accepted_output_count" IS NULL) OR ("accepted_output_count" > 0))),
    CONSTRAINT "client_asset_generation_jobs_asset_format_check" CHECK (("asset_format" = ANY (ARRAY['carousel'::"text", 'story_sequence'::"text", 'feed_post'::"text", 'ad_static'::"text"]))),
    CONSTRAINT "client_asset_generation_jobs_closure_type_check" CHECK ((("closure_type" IS NULL) OR ("closure_type" = ANY (ARRAY['completed'::"text", 'cancelled'::"text", 'partial_accepted'::"text"])))),
    CONSTRAINT "client_asset_generation_jobs_completed_output_count_check" CHECK (("completed_output_count" >= 0)),
    CONSTRAINT "client_asset_generation_jobs_expected_output_count_check" CHECK (("expected_output_count" > 0)),
    CONSTRAINT "client_asset_generation_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'partial'::"text", 'complete'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "client_asset_generation_jobs_visual_mode_check" CHECK (("visual_mode" = ANY (ARRAY['text_only'::"text", 'uploaded_background'::"text", 'uploaded_insert'::"text", 'generated_background'::"text"])))
);


ALTER TABLE "public"."client_asset_generation_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_asset_pipeline_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "execution_month" "text" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_group_ref" "text",
    "production_brief_id" "uuid",
    "current_stage" "text" DEFAULT 'master'::"text" NOT NULL,
    "previous_stage" "text",
    "title" "text",
    "asset_format" "text",
    "active" boolean DEFAULT true NOT NULL,
    "stage_entered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_transition_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "transition_reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_asset_pipeline_state_current_stage_check" CHECK (("current_stage" = ANY (ARRAY['master'::"text", 'content_creation'::"text", 'assets'::"text", 'distribution'::"text", 'analytics'::"text", 'analysis'::"text", 'completed'::"text", 'archived'::"text"]))),
    CONSTRAINT "client_asset_pipeline_state_execution_month_check" CHECK (("execution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "client_asset_pipeline_state_previous_stage_check" CHECK ((("previous_stage" IS NULL) OR ("previous_stage" = ANY (ARRAY['master'::"text", 'content_creation'::"text", 'assets'::"text", 'distribution'::"text", 'analytics'::"text", 'analysis'::"text", 'completed'::"text", 'archived'::"text"]))))
);


ALTER TABLE "public"."client_asset_pipeline_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_context_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "file_number" integer NOT NULL,
    "file_name" "text" NOT NULL,
    "content_md" "text",
    "storage_path" "text",
    "status" "public"."context_file_status" DEFAULT 'not_started'::"public"."context_file_status" NOT NULL,
    "confidence_level" "text",
    "generated_by_function" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_context_files_file_number_check" CHECK ((("file_number" >= 0) AND ("file_number" <= 20)))
);


ALTER TABLE "public"."client_context_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_context_patch_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "patch_draft_id" "uuid" NOT NULL,
    "target_file_id" "uuid" NOT NULL,
    "previous_version" integer NOT NULL,
    "new_version" integer NOT NULL,
    "previous_content_hash" "text" NOT NULL,
    "new_content_hash" "text" NOT NULL,
    "previous_content_snapshot" "text",
    "applied_content_snapshot" "text" NOT NULL,
    "applied_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_context_patch_applications_check" CHECK (("new_version" = ("previous_version" + 1))),
    CONSTRAINT "client_context_patch_applications_new_content_hash_check" CHECK (("length"("new_content_hash") = 32)),
    CONSTRAINT "client_context_patch_applications_previous_content_hash_check" CHECK (("length"("previous_content_hash") = 32)),
    CONSTRAINT "client_context_patch_applications_previous_version_check" CHECK (("previous_version" > 0))
);


ALTER TABLE "public"."client_context_patch_applications" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_context_patch_applications" IS 'Immutable before/after audit of applied context file versions.';



CREATE TABLE IF NOT EXISTS "public"."client_context_patch_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "context_update_proposal_id" "uuid" NOT NULL,
    "proposal_item_id" "uuid",
    "target_file_id" "uuid" NOT NULL,
    "target_file_name" "text",
    "target_file_path" "text",
    "target_section" "text",
    "patch_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "rationale" "text" NOT NULL,
    "current_state_summary" "text",
    "proposed_change_summary" "text" NOT NULL,
    "base_file_version" integer NOT NULL,
    "base_content_hash" "text" NOT NULL,
    "proposed_content" "text",
    "proposed_diff" "text",
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "confidence" "text" NOT NULL,
    "priority" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_from" "text" NOT NULL,
    "created_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "reviewer_notes" "text",
    "reviewed_at" timestamp with time zone,
    "applied_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_context_patch_drafts_base_content_hash_check" CHECK (("length"("base_content_hash") = 32)),
    CONSTRAINT "client_context_patch_drafts_base_file_version_check" CHECK (("base_file_version" > 0)),
    CONSTRAINT "client_context_patch_drafts_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_context_patch_drafts_created_by_check" CHECK (("created_by" = ANY (ARRAY['operator'::"text", 'system'::"text"]))),
    CONSTRAINT "client_context_patch_drafts_created_from_check" CHECK (("created_from" = ANY (ARRAY['context_update_proposal'::"text", 'manual'::"text"]))),
    CONSTRAINT "client_context_patch_drafts_evidence_check" CHECK (("jsonb_typeof"("evidence") = 'object'::"text")),
    CONSTRAINT "client_context_patch_drafts_patch_type_check" CHECK (("patch_type" = ANY (ARRAY['add'::"text", 'revise'::"text", 'remove'::"text", 'clarify'::"text", 'emphasize'::"text", 'de_emphasize'::"text", 'replace_section'::"text", 'other'::"text"]))),
    CONSTRAINT "client_context_patch_drafts_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_context_patch_drafts_proposed_change_summary_check" CHECK (("length"(TRIM(BOTH FROM "proposed_change_summary")) > 0)),
    CONSTRAINT "client_context_patch_drafts_proposed_content_check" CHECK ((("proposed_content" IS NULL) OR ("length"(TRIM(BOTH FROM "proposed_content")) > 0))),
    CONSTRAINT "client_context_patch_drafts_proposed_diff_check" CHECK ((("proposed_diff" IS NULL) OR ("length"(TRIM(BOTH FROM "proposed_diff")) > 0))),
    CONSTRAINT "client_context_patch_drafts_rationale_check" CHECK (("length"(TRIM(BOTH FROM "rationale")) > 0)),
    CONSTRAINT "client_context_patch_drafts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'applied'::"text", 'superseded'::"text"]))),
    CONSTRAINT "client_context_patch_drafts_summary_check" CHECK (("length"(TRIM(BOTH FROM "summary")) > 0)),
    CONSTRAINT "client_context_patch_drafts_title_check" CHECK (("length"(TRIM(BOTH FROM "title")) > 0))
);


ALTER TABLE "public"."client_context_patch_drafts" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_context_patch_drafts" IS 'Reviewed patch drafts with optimistic base version/hash guards; rows do not affect Phase 3 until explicitly applied.';



CREATE TABLE IF NOT EXISTS "public"."client_context_patch_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "patch_draft_id" "uuid" NOT NULL,
    "previous_status" "text",
    "new_status" "text" NOT NULL,
    "review_note" "text",
    "reviewed_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_context_patch_reviews_new_status_check" CHECK (("new_status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'applied'::"text", 'superseded'::"text"]))),
    CONSTRAINT "client_context_patch_reviews_previous_status_check" CHECK ((("previous_status" IS NULL) OR ("previous_status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'applied'::"text", 'superseded'::"text"]))))
);


ALTER TABLE "public"."client_context_patch_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_context_patch_reviews" IS 'Append-only audit of context patch review decisions.';



CREATE TABLE IF NOT EXISTS "public"."client_context_update_proposal_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_file_id" "uuid",
    "target_file_name" "text",
    "target_file_path" "text",
    "target_section" "text",
    "current_state_summary" "text",
    "proposed_change_summary" "text" NOT NULL,
    "change_intent" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_context_update_proposal_it_proposed_change_summary_check" CHECK (("length"(TRIM(BOTH FROM "proposed_change_summary")) > 0)),
    CONSTRAINT "client_context_update_proposal_items_change_intent_check" CHECK (("change_intent" = ANY (ARRAY['add'::"text", 'revise'::"text", 'remove'::"text", 'clarify'::"text", 'emphasize'::"text", 'de_emphasize'::"text"]))),
    CONSTRAINT "client_context_update_proposal_items_evidence_check" CHECK (("jsonb_typeof"("evidence") = 'object'::"text")),
    CONSTRAINT "client_context_update_proposal_items_target_type_check" CHECK (("target_type" = ANY (ARRAY['context_file'::"text", 'master_context'::"text", 'playbook'::"text", 'content_rule'::"text", 'distribution_rule'::"text", 'approval_rule'::"text", 'offer'::"text", 'positioning'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."client_context_update_proposal_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_context_update_proposal_items" IS 'Target references and change summaries only; no replacement markdown or executable patch is stored.';



CREATE TABLE IF NOT EXISTS "public"."client_context_update_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "iteration_candidate_id" "uuid",
    "source_ref" "text",
    "distribution_record_id" "uuid",
    "proposal_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "rationale" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "confidence" "text" NOT NULL,
    "priority" "text" NOT NULL,
    "status" "text" DEFAULT 'needs_review'::"text" NOT NULL,
    "created_from" "text" NOT NULL,
    "created_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "reviewer_notes" "text",
    "reviewed_at" timestamp with time zone,
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_context_update_proposals_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_context_update_proposals_created_by_check" CHECK (("created_by" = ANY (ARRAY['operator'::"text", 'system'::"text"]))),
    CONSTRAINT "client_context_update_proposals_created_from_check" CHECK (("created_from" = ANY (ARRAY['iteration_candidate'::"text", 'manual'::"text"]))),
    CONSTRAINT "client_context_update_proposals_evidence_check" CHECK (("jsonb_typeof"("evidence") = 'object'::"text")),
    CONSTRAINT "client_context_update_proposals_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_context_update_proposals_proposal_type_check" CHECK (("proposal_type" = ANY (ARRAY['context_file_update'::"text", 'master_context_update'::"text", 'positioning_update'::"text", 'offer_update'::"text", 'proof_angle_update'::"text", 'cta_update'::"text", 'distribution_update'::"text", 'content_rule_update'::"text", 'calendar_rule_update'::"text", 'other'::"text"]))),
    CONSTRAINT "client_context_update_proposals_rationale_check" CHECK (("length"(TRIM(BOTH FROM "rationale")) > 0)),
    CONSTRAINT "client_context_update_proposals_status_check" CHECK (("status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'converted_to_patch'::"text"]))),
    CONSTRAINT "client_context_update_proposals_summary_check" CHECK (("length"(TRIM(BOTH FROM "summary")) > 0)),
    CONSTRAINT "client_context_update_proposals_title_check" CHECK (("length"(TRIM(BOTH FROM "title")) > 0))
);


ALTER TABLE "public"."client_context_update_proposals" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_context_update_proposals" IS 'Gate F review queue only. A proposal never edits context, master, strategy, content, calendar, asset, distribution, or publishing data.';



CREATE TABLE IF NOT EXISTS "public"."client_context_update_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "previous_status" "text",
    "new_status" "text" NOT NULL,
    "review_note" "text",
    "reviewed_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_context_update_reviews_new_status_check" CHECK (("new_status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'converted_to_patch'::"text"]))),
    CONSTRAINT "client_context_update_reviews_previous_status_check" CHECK ((("previous_status" IS NULL) OR ("previous_status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'converted_to_patch'::"text"]))))
);


ALTER TABLE "public"."client_context_update_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_context_update_reviews" IS 'Append-only audit of context-update proposal review decisions.';



CREATE TABLE IF NOT EXISTS "public"."client_destructive_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "operation_type" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid",
    "target_ref" "text",
    "reason" "text",
    "dry_run" boolean DEFAULT true NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "requested_by" "uuid",
    "plan" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "client_destructive_operations_operation_type_check" CHECK (("operation_type" = ANY (ARRAY['delete_asset'::"text", 'delete_phase3_content'::"text", 'reject_asset'::"text", 'reject_content_brief'::"text"]))),
    CONSTRAINT "client_destructive_operations_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'pending'::"text", 'complete'::"text", 'failed'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."client_destructive_operations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_distribution_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "platform" "text" DEFAULT 'instagram'::"text" NOT NULL,
    "label" "text" NOT NULL,
    "handle" "text" NOT NULL,
    "external_account_id" "text" NOT NULL,
    "account_type" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "client_distribution_accounts_external_id_nonempty" CHECK (("btrim"("external_account_id") <> ''::"text")),
    CONSTRAINT "client_distribution_accounts_handle_normalized" CHECK ((("handle" = "lower"("btrim"("handle"))) AND ("handle" !~ '^@'::"text") AND ("btrim"("handle") <> ''::"text"))),
    CONSTRAINT "client_distribution_accounts_label_nonempty" CHECK (("btrim"("label") <> ''::"text")),
    CONSTRAINT "client_distribution_accounts_platform_nonempty" CHECK (("btrim"("platform") <> ''::"text"))
);


ALTER TABLE "public"."client_distribution_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_execution_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_number" integer,
    "file_type" "text",
    "content_md" "text",
    "storage_bucket" "text",
    "storage_path" "text",
    "status" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "generated_by_agent" "text",
    "generated_by_function" "text",
    "reviewed_by" "uuid",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL
);


ALTER TABLE "public"."client_execution_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_inputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "business_description" "text",
    "website_url" "text",
    "social_links" "jsonb" DEFAULT '{}'::"jsonb",
    "offer_details" "text",
    "target_customer" "text",
    "geography" "text",
    "proof_notes" "text",
    "testimonials_notes" "text",
    "reviews_notes" "text",
    "case_studies_notes" "text",
    "before_after_notes" "text",
    "founder_team_notes" "text",
    "current_problems" "text",
    "uploaded_file_refs" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sales_process" "text",
    "current_marketing" "text",
    "brand_voice" "text",
    "competitors" "text",
    "constraints_approval_rules" "text",
    "raw_notes" "text"
);


ALTER TABLE "public"."client_inputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "is_internal_client" boolean DEFAULT false NOT NULL,
    "package_tier" "public"."package_tier" DEFAULT 'proof_sprint'::"public"."package_tier" NOT NULL,
    "status" "public"."client_status" DEFAULT 'prospect'::"public"."client_status" NOT NULL,
    "account_manager_id" "uuid",
    "geography" "text",
    "primary_platform" "text",
    "secondary_platform" "text",
    "stage1_status" "public"."stage_status" DEFAULT 'not_run'::"public"."stage_status" NOT NULL,
    "stage1_completed_at" timestamp with time zone,
    "stage2_status" "public"."stage_status" DEFAULT 'not_run'::"public"."stage_status" NOT NULL,
    "stage2_completed_at" timestamp with time zone,
    "health_score" integer DEFAULT 0,
    "health_updated_at" timestamp with time zone,
    "package_config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clients_health_score_check" CHECK ((("health_score" >= 0) AND ("health_score" <= 100)))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organic_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "ref" "text" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "status" "public"."organic_status" DEFAULT 'idea'::"public"."organic_status" NOT NULL,
    "content_type" "text" NOT NULL,
    "archetype" "text",
    "pillar" "text",
    "working_title" "text",
    "the_one_person" "text",
    "one_belief_to_change" "text",
    "hook" "text",
    "core_message" "text",
    "cta" "text",
    "storyboard_outline" "text",
    "caption_script" "text",
    "source_origin" "text",
    "distribution_date" "date",
    "distribution_channel" "text",
    "production_date" "date",
    "edit_date" "date",
    "production_brief" "text",
    "editor" "uuid",
    "psychological_angle" "text",
    "repurposed_from_to" "text",
    "format_proven" boolean,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organic_master_content_type_check" CHECK (("content_type" = ANY (ARRAY['RL'::"text", 'FP'::"text", 'CR'::"text"])))
);


ALTER TABLE "public"."organic_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proof_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text",
    "ref" "text" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "proof_type" "text",
    "proof_asset_name" "text",
    "source" "text",
    "status" "public"."proof_status" DEFAULT 'missing'::"public"."proof_status" NOT NULL,
    "consent_status" "text",
    "claim_status" "text",
    "strength_rating" "text",
    "proof_gap_addressed" "text",
    "where_can_be_used" "text",
    "where_must_not_be_used" "text",
    "owner" "uuid",
    "capture_date" "date",
    "downstream_refs" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."proof_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "ref" "text" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "status" "public"."organic_status" DEFAULT 'idea'::"public"."organic_status" NOT NULL,
    "story_theme" "text",
    "pillar" "text",
    "frame_1" "text",
    "frame_2" "text",
    "frame_3" "text",
    "frame_4_optional" "text",
    "cta_engagement_prompt" "text",
    "proof_used" "text",
    "source_origin" "text",
    "distribution_date" "date",
    "repurposed_from_to" "text",
    "what_not_to_claim" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "story_type" "text",
    CONSTRAINT "story_master_story_type_check" CHECK (("story_type" = ANY (ARRAY['daily'::"text", 'sequence'::"text", 'poll'::"text", 'dm_prompt'::"text", 'proof'::"text", 'offer'::"text", 'bts'::"text", 'faq'::"text"])))
);


ALTER TABLE "public"."story_master" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."client_health_v" WITH ("security_invoker"='true') AS
 SELECT "id",
    "name",
    "slug",
    "package_tier",
    "status",
    "stage1_status",
    "stage2_status",
    GREATEST(0, LEAST(100, (((((((
        CASE
            WHEN ("stage1_status" = 'complete'::"public"."stage_status") THEN 20
            ELSE 0
        END +
        CASE
            WHEN ("stage2_status" = 'complete'::"public"."stage_status") THEN 20
            ELSE 0
        END) +
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM "public"."calendar_cells" "cc"
              WHERE (("cc"."client_id" = "c"."id") AND ("cc"."month" = "to_char"((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::"text"))))) THEN 15
            ELSE 0
        END) +
        CASE
            WHEN ("status" = 'active'::"public"."client_status") THEN 10
            ELSE 0
        END) +
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM "public"."client_inputs" "ci"
              WHERE (("ci"."client_id" = "c"."id") AND (("ci"."business_description" IS NOT NULL) OR ("ci"."offer_details" IS NOT NULL))))) THEN 5
            ELSE 0
        END) - LEAST(20, (5 * (( SELECT "count"(*) AS "count"
           FROM ( SELECT 1 AS "?column?"
                   FROM "public"."organic_master" "om"
                  WHERE (("om"."client_id" = "c"."id") AND ("om"."review_state" = 'needs_review'::"public"."review_state") AND ("om"."created_at" < ("now"() - '48:00:00'::interval)))
                UNION ALL
                 SELECT 1
                   FROM "public"."story_master" "sm"
                  WHERE (("sm"."client_id" = "c"."id") AND ("sm"."review_state" = 'needs_review'::"public"."review_state") AND ("sm"."created_at" < ("now"() - '48:00:00'::interval)))
                UNION ALL
                 SELECT 1
                   FROM "public"."ads_master" "am"
                  WHERE (("am"."client_id" = "c"."id") AND ("am"."review_state" = 'needs_review'::"public"."review_state") AND ("am"."created_at" < ("now"() - '48:00:00'::interval)))) "overdue"))::integer))) - LEAST(15, (5 * ( SELECT ("count"(*))::integer AS "count"
           FROM "public"."automations" "a"
          WHERE (("a"."client_id" = "c"."id") AND ("a"."status" = 'error'::"text")))))) - LEAST(10, (5 * ( SELECT ("count"(*))::integer AS "count"
           FROM "public"."proof_master" "pm"
          WHERE (("pm"."client_id" = "c"."id") AND ("pm"."status" = 'missing'::"public"."proof_status")))))))) AS "health_score"
   FROM "public"."clients" "c";


ALTER VIEW "public"."client_health_v" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_ideation_calendar_proposal_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "scoring_run_id" "uuid" NOT NULL,
    "proposal_slot_key" "text" NOT NULL,
    "proposed_date" "date" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "date_slot_ordinal" integer NOT NULL,
    "required_asset_type" "text" NOT NULL,
    "calendar_row_type" "text" NOT NULL,
    "placement_basis" "text" NOT NULL,
    "candidate_id" "uuid",
    "candidate_score_id" "uuid",
    "candidate_asset_type_snapshot" "text",
    "candidate_content_hash" "text",
    "candidate_rank_snapshot" integer,
    "candidate_score_snapshot" integer,
    "candidate_display_reference" "text",
    "placement_rationale" "text",
    "authority_references" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "evidence_references" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "slot_warnings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "conflict_status" "text" DEFAULT 'clear'::"text" NOT NULL,
    "conflict_details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "placement_source" "text",
    "manually_edited" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_proposal_slots_arrays_check" CHECK ((("jsonb_typeof"("authority_references") = 'array'::"text") AND ("jsonb_typeof"("evidence_references") = 'array'::"text") AND ("jsonb_typeof"("slot_warnings") = 'array'::"text"))),
    CONSTRAINT "client_ideation_proposal_slots_asset_match_check" CHECK ((("candidate_asset_type_snapshot" IS NULL) OR ("candidate_asset_type_snapshot" = "required_asset_type"))),
    CONSTRAINT "client_ideation_proposal_slots_asset_type_check" CHECK (("required_asset_type" = ANY (ARRAY['reel'::"text", 'carousel'::"text", 'static'::"text", 'story'::"text"]))),
    CONSTRAINT "client_ideation_proposal_slots_assignment_check" CHECK (((("candidate_id" IS NULL) AND ("candidate_score_id" IS NULL) AND ("candidate_asset_type_snapshot" IS NULL) AND ("candidate_content_hash" IS NULL) AND ("candidate_rank_snapshot" IS NULL) AND ("candidate_score_snapshot" IS NULL) AND ("candidate_display_reference" IS NULL) AND ("placement_source" IS NULL)) OR (("candidate_id" IS NOT NULL) AND ("candidate_score_id" IS NOT NULL) AND ("candidate_asset_type_snapshot" IS NOT NULL) AND ("candidate_content_hash" IS NOT NULL) AND ("candidate_rank_snapshot" IS NOT NULL) AND ("candidate_score_snapshot" IS NOT NULL) AND ("candidate_display_reference" IS NOT NULL) AND ("placement_source" IS NOT NULL)))),
    CONSTRAINT "client_ideation_proposal_slots_basis_check" CHECK (("placement_basis" = ANY (ARRAY['execution_cadence'::"text", 'deterministic_spread'::"text"]))),
    CONSTRAINT "client_ideation_proposal_slots_conflict_check" CHECK (("conflict_status" = ANY (ARRAY['clear'::"text", 'occupied'::"text", 'protected'::"text", 'date_capacity_exceeded'::"text", 'stale_calendar_snapshot'::"text"]))),
    CONSTRAINT "client_ideation_proposal_slots_conflict_details_check" CHECK (("jsonb_typeof"("conflict_details") = 'object'::"text")),
    CONSTRAINT "client_ideation_proposal_slots_display_ref_check" CHECK ((("candidate_display_reference" IS NULL) OR ("candidate_display_reference" ~~ 'IDEATION/%'::"text"))),
    CONSTRAINT "client_ideation_proposal_slots_hash_check" CHECK ((("candidate_content_hash" IS NULL) OR ("candidate_content_hash" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "client_ideation_proposal_slots_ordinal_check" CHECK (("date_slot_ordinal" >= 1)),
    CONSTRAINT "client_ideation_proposal_slots_period_check" CHECK ((("period_end" >= "period_start") AND (("proposed_date" >= "period_start") AND ("proposed_date" <= "period_end")))),
    CONSTRAINT "client_ideation_proposal_slots_rationale_check" CHECK ((("placement_rationale" IS NULL) OR (("length"("placement_rationale") >= 1) AND ("length"("placement_rationale") <= 600)))),
    CONSTRAINT "client_ideation_proposal_slots_row_type_check" CHECK (("calendar_row_type" = ANY (ARRAY['reel'::"text", 'carousels'::"text", 'feed_posts'::"text", 'stories'::"text"]))),
    CONSTRAINT "client_ideation_proposal_slots_score_check" CHECK (((("candidate_rank_snapshot" IS NULL) OR ("candidate_rank_snapshot" >= 1)) AND (("candidate_score_snapshot" IS NULL) OR (("candidate_score_snapshot" >= 0) AND ("candidate_score_snapshot" <= 100))))),
    CONSTRAINT "client_ideation_proposal_slots_source_check" CHECK ((("placement_source" IS NULL) OR ("placement_source" = ANY (ARRAY['model'::"text", 'manual'::"text", 'restored'::"text"]))))
);


ALTER TABLE "public"."client_ideation_calendar_proposal_slots" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_calendar_proposal_slots" IS 'Stage 3 proposed placement. Dates, asset types, conflicts, and ranks are server-owned; an empty slot means the candidate is in the unassigned pool.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_candidate_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "scoring_run_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "candidate_content_hash" "text" NOT NULL,
    "candidate_evidence_hash" "text" NOT NULL,
    "execution_plan_alignment" smallint NOT NULL,
    "business_and_positioning_alignment" smallint NOT NULL,
    "audience_and_pain_relevance" smallint NOT NULL,
    "proof_and_evidence_strength" smallint NOT NULL,
    "hook_and_attention_strength" smallint NOT NULL,
    "commercial_potential" smallint NOT NULL,
    "specificity_and_clarity" smallint NOT NULL,
    "originality_and_distinctiveness" smallint NOT NULL,
    "platform_and_format_fit" smallint NOT NULL,
    "production_feasibility" smallint NOT NULL,
    "overall_score" smallint NOT NULL,
    "priority_band" "text" NOT NULL,
    "rank" integer,
    "rationale" "text" NOT NULL,
    "strengths" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "risks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "authority_references" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "evidence_references" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "rubric_slug" "text" NOT NULL,
    "rubric_version" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "output_schema_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_candidate_scores_arrays_check" CHECK ((("jsonb_typeof"("strengths") = 'array'::"text") AND (("jsonb_array_length"("strengths") >= 1) AND ("jsonb_array_length"("strengths") <= 3)) AND ("jsonb_typeof"("risks") = 'array'::"text") AND (("jsonb_array_length"("risks") >= 0) AND ("jsonb_array_length"("risks") <= 3)) AND ("jsonb_typeof"("authority_references") = 'array'::"text") AND (("jsonb_array_length"("authority_references") >= 0) AND ("jsonb_array_length"("authority_references") <= 12)) AND ("jsonb_typeof"("evidence_references") = 'array'::"text") AND (("jsonb_array_length"("evidence_references") >= 0) AND ("jsonb_array_length"("evidence_references") <= 12)))),
    CONSTRAINT "client_ideation_candidate_scores_band_check" CHECK (("priority_band" = ANY (ARRAY['top'::"text", 'high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "client_ideation_candidate_scores_band_matches_score_check" CHECK (("priority_band" =
CASE
    WHEN ("overall_score" >= 90) THEN 'top'::"text"
    WHEN ("overall_score" >= 75) THEN 'high'::"text"
    WHEN ("overall_score" >= 60) THEN 'medium'::"text"
    ELSE 'low'::"text"
END)),
    CONSTRAINT "client_ideation_candidate_scores_dimensions_check" CHECK (((("execution_plan_alignment" >= 0) AND ("execution_plan_alignment" <= 10)) AND (("business_and_positioning_alignment" >= 0) AND ("business_and_positioning_alignment" <= 10)) AND (("audience_and_pain_relevance" >= 0) AND ("audience_and_pain_relevance" <= 10)) AND (("proof_and_evidence_strength" >= 0) AND ("proof_and_evidence_strength" <= 10)) AND (("hook_and_attention_strength" >= 0) AND ("hook_and_attention_strength" <= 10)) AND (("commercial_potential" >= 0) AND ("commercial_potential" <= 10)) AND (("specificity_and_clarity" >= 0) AND ("specificity_and_clarity" <= 10)) AND (("originality_and_distinctiveness" >= 0) AND ("originality_and_distinctiveness" <= 10)) AND (("platform_and_format_fit" >= 0) AND ("platform_and_format_fit" <= 10)) AND (("production_feasibility" >= 0) AND ("production_feasibility" <= 10)))),
    CONSTRAINT "client_ideation_candidate_scores_hash_check" CHECK ((("candidate_content_hash" ~ '^[0-9a-f]{64}$'::"text") AND ("candidate_evidence_hash" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "client_ideation_candidate_scores_overall_check" CHECK ((("overall_score" >= 0) AND ("overall_score" <= 100))),
    CONSTRAINT "client_ideation_candidate_scores_provenance_check" CHECK (((("length"("provider") >= 1) AND ("length"("provider") <= 100)) AND (("length"("model") >= 1) AND ("length"("model") <= 200)) AND (("length"("rubric_slug") >= 1) AND ("length"("rubric_slug") <= 100)) AND (("length"("rubric_version") >= 1) AND ("length"("rubric_version") <= 100)) AND (("length"("prompt_version") >= 1) AND ("length"("prompt_version") <= 100)) AND (("length"("output_schema_version") >= 1) AND ("length"("output_schema_version") <= 100)))),
    CONSTRAINT "client_ideation_candidate_scores_rank_check" CHECK ((("rank" IS NULL) OR ("rank" >= 1))),
    CONSTRAINT "client_ideation_candidate_scores_rationale_check" CHECK ((("length"("rationale") >= 1) AND ("length"("rationale") <= 1200)))
);


ALTER TABLE "public"."client_ideation_candidate_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_candidate_scores" IS 'Stage 2 advisory candidate score. Overall score, priority band, and rank are server-calculated; the model supplies only the ten rubric dimensions.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "technique_run_id" "uuid" NOT NULL,
    "research_result_id" "uuid" NOT NULL,
    "candidate_index" integer NOT NULL,
    "asset_type" "text" NOT NULL,
    "status" "text" DEFAULT 'needs_review'::"text" NOT NULL,
    "working_title" "text" NOT NULL,
    "hook" "text" NOT NULL,
    "core_message" "text" NOT NULL,
    "psychological_angle" "text",
    "cta" "text" NOT NULL,
    "evidence_references" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "draft_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "model_provider" "text" NOT NULL,
    "model_name" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "output_schema_version" "text" NOT NULL,
    "input_hash" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_candidates_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['reel'::"text", 'carousel'::"text", 'static'::"text", 'story'::"text"]))),
    CONSTRAINT "client_ideation_candidates_core_message_check" CHECK ((("length"("core_message") >= 1) AND ("length"("core_message") <= 3000))),
    CONSTRAINT "client_ideation_candidates_cta_check" CHECK ((("length"("cta") >= 1) AND ("length"("cta") <= 1000))),
    CONSTRAINT "client_ideation_candidates_evidence_check" CHECK ((("jsonb_typeof"("evidence_references") = 'array'::"text") AND ("jsonb_array_length"("evidence_references") > 0))),
    CONSTRAINT "client_ideation_candidates_hook_check" CHECK ((("length"("hook") >= 1) AND ("length"("hook") <= 1000))),
    CONSTRAINT "client_ideation_candidates_index_check" CHECK (("candidate_index" >= 0)),
    CONSTRAINT "client_ideation_candidates_input_hash_check" CHECK (("input_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "client_ideation_candidates_payload_check" CHECK (("jsonb_typeof"("draft_payload") = 'object'::"text")),
    CONSTRAINT "client_ideation_candidates_psychological_angle_check" CHECK ((("psychological_angle" IS NULL) OR ("length"("psychological_angle") <= 1000))),
    CONSTRAINT "client_ideation_candidates_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text"]))),
    CONSTRAINT "client_ideation_candidates_title_check" CHECK ((("length"("working_title") >= 1) AND ("length"("working_title") <= 300)))
);


ALTER TABLE "public"."client_ideation_candidates" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_candidates" IS 'Pre-Calendar Ideation draft. It has no master ref, Calendar date, score, rank, production brief, or render lifecycle.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_commit_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "commit_run_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "scoring_run_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "proposal_slot_id" "uuid" NOT NULL,
    "proposal_slot_key" "text" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "candidate_score_id" "uuid" NOT NULL,
    "candidate_content_hash" "text" NOT NULL,
    "candidate_rank_snapshot" integer NOT NULL,
    "candidate_score_snapshot" integer NOT NULL,
    "asset_type" "text" NOT NULL,
    "target_master_table" "text" NOT NULL,
    "target_master_id" "uuid" NOT NULL,
    "target_calendar_cell_id" "uuid" NOT NULL,
    "calendar_row_type" "text" NOT NULL,
    "operational_ref" "text" NOT NULL,
    "committed_date" "date" NOT NULL,
    "execution_month" "text" NOT NULL,
    "master_payload_hash" "text" NOT NULL,
    "calendar_payload_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_commit_items_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['reel'::"text", 'carousel'::"text", 'static'::"text", 'story'::"text"]))),
    CONSTRAINT "client_ideation_commit_items_hash_check" CHECK ((("candidate_content_hash" ~ '^[0-9a-f]{64}$'::"text") AND ("master_payload_hash" ~ '^[0-9a-f]{64}$'::"text") AND ("calendar_payload_hash" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "client_ideation_commit_items_month_check" CHECK ((("execution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text") AND ("execution_month" = "to_char"(("committed_date")::timestamp with time zone, 'YYYY-MM'::"text")))),
    CONSTRAINT "client_ideation_commit_items_ref_check" CHECK ((("length"("operational_ref") >= 1) AND ("length"("operational_ref") <= 100))),
    CONSTRAINT "client_ideation_commit_items_score_check" CHECK ((("candidate_rank_snapshot" >= 1) AND (("candidate_score_snapshot" >= 0) AND ("candidate_score_snapshot" <= 100)))),
    CONSTRAINT "client_ideation_commit_items_target_check" CHECK (("target_master_table" = ANY (ARRAY['organic_master'::"text", 'story_master'::"text"]))),
    CONSTRAINT "client_ideation_commit_items_target_pairing_check" CHECK (((("asset_type" = 'story'::"text") AND ("target_master_table" = 'story_master'::"text") AND ("calendar_row_type" = 'stories'::"text")) OR (("asset_type" = 'reel'::"text") AND ("target_master_table" = 'organic_master'::"text") AND ("calendar_row_type" = 'reel'::"text")) OR (("asset_type" = 'carousel'::"text") AND ("target_master_table" = 'organic_master'::"text") AND ("calendar_row_type" = 'carousels'::"text")) OR (("asset_type" = 'static'::"text") AND ("target_master_table" = 'organic_master'::"text") AND ("calendar_row_type" = 'feed_posts'::"text"))))
);


ALTER TABLE "public"."client_ideation_commit_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_commit_items" IS 'Ideation Stage 4: exact provenance from proposal slot and candidate to the created operational master and calendar_cells row.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_commit_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "scoring_run_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "configuration_hash" "text" NOT NULL,
    "commit_input_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "calendar_digest" "text" NOT NULL,
    "proposal_version" integer NOT NULL,
    "proposal_edit_revision" integer NOT NULL,
    "target_manifest_version" "text" NOT NULL,
    "mapping_version" "text" NOT NULL,
    "reference_allocator_version" "text" NOT NULL,
    "output_schema_version" "text" NOT NULL,
    "module_version" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "expected_item_count" integer NOT NULL,
    "committed_item_count" integer DEFAULT 0 NOT NULL,
    "organic_item_count" integer DEFAULT 0 NOT NULL,
    "story_item_count" integer DEFAULT 0 NOT NULL,
    "failed_item_count" integer DEFAULT 0 NOT NULL,
    "failure_code" "text",
    "failure_message" "text",
    "failed_proposal_slot_key" "text",
    "warnings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_commit_runs_completed_check" CHECK ((("status" <> 'completed'::"text") OR (("completed_at" IS NOT NULL) AND ("committed_item_count" = "expected_item_count") AND ("failed_item_count" = 0) AND ("failure_code" IS NULL) AND ("failed_at" IS NULL)))),
    CONSTRAINT "client_ideation_commit_runs_counts_check" CHECK ((("expected_item_count" >= 1) AND (("committed_item_count" >= 0) AND ("committed_item_count" <= "expected_item_count")) AND ("organic_item_count" >= 0) AND ("story_item_count" >= 0) AND ("failed_item_count" >= 0) AND (("organic_item_count" + "story_item_count") = "committed_item_count"))),
    CONSTRAINT "client_ideation_commit_runs_failed_check" CHECK (((("status" = 'failed'::"text") AND ("failed_at" IS NOT NULL) AND ("failure_code" IS NOT NULL)) OR (("status" <> 'failed'::"text") AND ("failed_at" IS NULL) AND ("failure_code" IS NULL)))),
    CONSTRAINT "client_ideation_commit_runs_hash_check" CHECK ((("configuration_hash" ~ '^[0-9a-f]{64}$'::"text") AND ("calendar_digest" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "client_ideation_commit_runs_idempotency_check" CHECK ((("length"("idempotency_key") >= 1) AND ("length"("idempotency_key") <= 160))),
    CONSTRAINT "client_ideation_commit_runs_period_check" CHECK (("period_end" >= "period_start")),
    CONSTRAINT "client_ideation_commit_runs_revision_check" CHECK ((("proposal_version" >= 1) AND ("proposal_edit_revision" >= 0))),
    CONSTRAINT "client_ideation_commit_runs_running_check" CHECK ((("status" <> 'running'::"text") OR (("completed_at" IS NULL) AND ("failed_at" IS NULL)))),
    CONSTRAINT "client_ideation_commit_runs_snapshot_check" CHECK ((("jsonb_typeof"("commit_input_snapshot") = 'object'::"text") AND ("jsonb_typeof"("warnings") = 'array'::"text"))),
    CONSTRAINT "client_ideation_commit_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_ideation_commit_runs_versions_check" CHECK (((("length"("target_manifest_version") >= 1) AND ("length"("target_manifest_version") <= 100)) AND (("length"("mapping_version") >= 1) AND ("length"("mapping_version") <= 100)) AND (("length"("reference_allocator_version") >= 1) AND ("length"("reference_allocator_version") <= 100)) AND (("length"("output_schema_version") >= 1) AND ("length"("output_schema_version") <= 100)) AND (("length"("module_version") >= 1) AND ("length"("module_version") <= 100))))
);


ALTER TABLE "public"."client_ideation_commit_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_commit_runs" IS 'Ideation Stage 4: one commit attempt per approved proposal. A completed run is the sole evidence that operational content was created.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_cycles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "period_type" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "execution_months" "text"[] NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "input_hash" "text" NOT NULL,
    "quantity_plan" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "configuration_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "slot_allocation" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "technique_summary" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "expected_candidate_count" integer NOT NULL,
    "candidate_count" integer DEFAULT 0 NOT NULL,
    "shortfall_count" integer DEFAULT 0 NOT NULL,
    "retryable" boolean DEFAULT false NOT NULL,
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "lease_owner" "text",
    "lease_expires_at" timestamp with time zone,
    "last_heartbeat_at" timestamp with time zone,
    "error_code" "text",
    "error_message" "text",
    "created_by" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_cycles_attempt_count_check" CHECK (("attempt_count" >= 1)),
    CONSTRAINT "client_ideation_cycles_configuration_snapshot_check" CHECK (("jsonb_typeof"("configuration_snapshot") = 'object'::"text")),
    CONSTRAINT "client_ideation_cycles_counts_check" CHECK ((("expected_candidate_count" >= 0) AND ("candidate_count" >= 0) AND ("shortfall_count" >= 0) AND ("shortfall_count" = GREATEST(("expected_candidate_count" - "candidate_count"), 0)))),
    CONSTRAINT "client_ideation_cycles_execution_months_check" CHECK ((("cardinality"("execution_months") >= 1) AND ("cardinality"("execution_months") <= 3))),
    CONSTRAINT "client_ideation_cycles_idempotency_check" CHECK ((("length"("idempotency_key") >= 1) AND ("length"("idempotency_key") <= 128))),
    CONSTRAINT "client_ideation_cycles_input_hash_check" CHECK (("input_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "client_ideation_cycles_lease_check" CHECK (((("status" = 'running'::"text") AND ("lease_owner" IS NOT NULL) AND ("lease_expires_at" IS NOT NULL) AND ("last_heartbeat_at" IS NOT NULL)) OR (("status" <> 'running'::"text") AND ("lease_owner" IS NULL) AND ("lease_expires_at" IS NULL)))),
    CONSTRAINT "client_ideation_cycles_period_check" CHECK ((("period_end" >= "period_start") AND ((("period_end" - "period_start") >= 0) AND (("period_end" - "period_start") <= 30)))),
    CONSTRAINT "client_ideation_cycles_period_type_check" CHECK (("period_type" = ANY (ARRAY['one_day'::"text", 'one_week'::"text", 'date_range'::"text", 'one_month'::"text"]))),
    CONSTRAINT "client_ideation_cycles_quantity_plan_check" CHECK (("jsonb_typeof"("quantity_plan") = 'object'::"text")),
    CONSTRAINT "client_ideation_cycles_slot_allocation_check" CHECK (("jsonb_typeof"("slot_allocation") = 'object'::"text")),
    CONSTRAINT "client_ideation_cycles_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'retryable'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_ideation_cycles_technique_summary_check" CHECK (("jsonb_typeof"("technique_summary") = 'array'::"text"))
);


ALTER TABLE "public"."client_ideation_cycles" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_cycles" IS 'Upstream Ideation period batch shown as a Run in the UI. It has no Calendar, master, production, or render semantics.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_research_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "technique_run_id" "uuid" NOT NULL,
    "research_key" "text" NOT NULL,
    "source_identifier" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "source_title" "text" NOT NULL,
    "source_excerpt" "text" NOT NULL,
    "source_provider" "text" NOT NULL,
    "retrieved_at" timestamp with time zone NOT NULL,
    "content_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'processed'::"text" NOT NULL,
    "source_findings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "analysis_provider" "text",
    "analysis_model" "text",
    "analysis_prompt_version" "text",
    "analysis_output_schema_version" "text",
    "analyzed_at" timestamp with time zone,
    "analysis_findings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "analysis_source_references" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_research_analysis_provenance_check" CHECK (((("analysis_provider" IS NULL) AND ("analysis_model" IS NULL) AND ("analysis_prompt_version" IS NULL) AND ("analysis_output_schema_version" IS NULL) AND ("analyzed_at" IS NULL)) OR (("analysis_provider" IS NOT NULL) AND ("analysis_model" IS NOT NULL) AND ("analysis_prompt_version" IS NOT NULL) AND ("analysis_output_schema_version" IS NOT NULL) AND ("analyzed_at" IS NOT NULL)))),
    CONSTRAINT "client_ideation_research_excerpt_check" CHECK ((("length"("source_excerpt") >= 1) AND ("length"("source_excerpt") <= 8000))),
    CONSTRAINT "client_ideation_research_findings_check" CHECK ((("jsonb_typeof"("source_findings") = 'object'::"text") AND ("jsonb_typeof"("analysis_findings") = 'object'::"text") AND ("jsonb_typeof"("analysis_source_references") = 'array'::"text"))),
    CONSTRAINT "client_ideation_research_hash_check" CHECK (("content_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "client_ideation_research_provider_check" CHECK ((("length"("source_provider") >= 1) AND ("length"("source_provider") <= 100))),
    CONSTRAINT "client_ideation_research_source_identifier_check" CHECK ((("length"("source_identifier") >= 1) AND ("length"("source_identifier") <= 500))),
    CONSTRAINT "client_ideation_research_source_title_check" CHECK ((("length"("source_title") >= 1) AND ("length"("source_title") <= 300))),
    CONSTRAINT "client_ideation_research_source_type_check" CHECK (("source_type" = ANY (ARRAY['approved_context'::"text", 'approved_strategic_playbook'::"text", 'approved_execution'::"text", 'approved_authority_bundle'::"text", 'external_research'::"text"]))),
    CONSTRAINT "client_ideation_research_source_url_check" CHECK (((("length"("source_url") >= 1) AND ("length"("source_url") <= 2048)) AND ("source_url" ~* '^(https?://|aa-authority://)'::"text"))),
    CONSTRAINT "client_ideation_research_status_check" CHECK (("status" = ANY (ARRAY['processed'::"text", 'insufficient'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."client_ideation_research_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_research_results" IS 'Bounded Ideation evidence and structured findings. Raw HTML and complete page storage are prohibited.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_scoring_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "configuration_hash" "text" NOT NULL,
    "configuration_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "authority_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "candidate_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rubric_slug" "text" NOT NULL,
    "rubric_version" "text" NOT NULL,
    "prompt_digest" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "output_schema_version" "text" NOT NULL,
    "module_version" "text" NOT NULL,
    "expected_candidate_count" integer NOT NULL,
    "scored_candidate_count" integer DEFAULT 0 NOT NULL,
    "failed_candidate_count" integer DEFAULT 0 NOT NULL,
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "maximum_attempts" integer DEFAULT 3 NOT NULL,
    "retryable" boolean DEFAULT false NOT NULL,
    "warnings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "error_code" "text",
    "error_message" "text",
    "supersedes_scoring_run_id" "uuid",
    "lease_owner" "text",
    "lease_expires_at" timestamp with time zone,
    "last_heartbeat_at" timestamp with time zone,
    "created_by" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_scoring_runs_attempts_check" CHECK ((("attempt_count" >= 1) AND (("maximum_attempts" >= 1) AND ("maximum_attempts" <= 10)) AND ("attempt_count" <= "maximum_attempts"))),
    CONSTRAINT "client_ideation_scoring_runs_candidate_snapshot_length_check" CHECK (("jsonb_array_length"("candidate_snapshot") = "expected_candidate_count")),
    CONSTRAINT "client_ideation_scoring_runs_completed_check" CHECK (((("status" = 'completed'::"text") AND ("completed_at" IS NOT NULL) AND ("scored_candidate_count" = "expected_candidate_count")) OR (("status" <> 'completed'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "client_ideation_scoring_runs_configuration_hash_check" CHECK (("configuration_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "client_ideation_scoring_runs_counts_check" CHECK ((("expected_candidate_count" >= 1) AND ("scored_candidate_count" >= 0) AND ("failed_candidate_count" >= 0) AND ("scored_candidate_count" <= "expected_candidate_count"))),
    CONSTRAINT "client_ideation_scoring_runs_failed_check" CHECK (((("status" = 'failed'::"text") AND ("failed_at" IS NOT NULL)) OR (("status" <> 'failed'::"text") AND ("failed_at" IS NULL)))),
    CONSTRAINT "client_ideation_scoring_runs_idempotency_check" CHECK ((("length"("idempotency_key") >= 1) AND ("length"("idempotency_key") <= 128))),
    CONSTRAINT "client_ideation_scoring_runs_lease_check" CHECK (((("status" = 'running'::"text") AND ("lease_owner" IS NOT NULL) AND ("lease_expires_at" IS NOT NULL) AND ("last_heartbeat_at" IS NOT NULL)) OR (("status" <> 'running'::"text") AND ("lease_owner" IS NULL) AND ("lease_expires_at" IS NULL)))),
    CONSTRAINT "client_ideation_scoring_runs_no_self_supersede_check" CHECK ((("supersedes_scoring_run_id" IS NULL) OR ("supersedes_scoring_run_id" <> "id"))),
    CONSTRAINT "client_ideation_scoring_runs_prompt_digest_check" CHECK (("prompt_digest" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "client_ideation_scoring_runs_provider_check" CHECK (((("length"("provider") >= 1) AND ("length"("provider") <= 100)) AND (("length"("model") >= 1) AND ("length"("model") <= 200)))),
    CONSTRAINT "client_ideation_scoring_runs_retryable_check" CHECK ((NOT (("status" = 'completed'::"text") AND "retryable"))),
    CONSTRAINT "client_ideation_scoring_runs_rubric_check" CHECK (((("length"("rubric_slug") >= 1) AND ("length"("rubric_slug") <= 100)) AND (("length"("rubric_version") >= 1) AND ("length"("rubric_version") <= 100)))),
    CONSTRAINT "client_ideation_scoring_runs_snapshot_check" CHECK ((("jsonb_typeof"("configuration_snapshot") = 'object'::"text") AND ("jsonb_typeof"("authority_snapshot") = 'object'::"text") AND ("jsonb_typeof"("candidate_snapshot") = 'array'::"text") AND ("jsonb_typeof"("warnings") = 'array'::"text"))),
    CONSTRAINT "client_ideation_scoring_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'retryable'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_ideation_scoring_runs_versions_check" CHECK (((("length"("output_schema_version") >= 1) AND ("length"("output_schema_version") <= 100)) AND (("length"("module_version") >= 1) AND ("length"("module_version") <= 100))))
);


ALTER TABLE "public"."client_ideation_scoring_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_scoring_runs" IS 'Stage 2 Ideation scoring batch. Advisory only: it has no Calendar, master, production, distribution, or approval semantics.';



CREATE TABLE IF NOT EXISTS "public"."client_ideation_technique_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ideation_cycle_id" "uuid" NOT NULL,
    "technique_slug" "text" NOT NULL,
    "technique_version" integer NOT NULL,
    "technique_order" integer NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "input_hash" "text" NOT NULL,
    "authority_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "technique_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "proposed_output" "jsonb",
    "provider" "text",
    "model" "text",
    "prompt_version" "text",
    "requested_slots" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "generated_slots" integer DEFAULT 0 NOT NULL,
    "failed_slots" integer DEFAULT 0 NOT NULL,
    "retryable" boolean DEFAULT false NOT NULL,
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "error_code" "text",
    "error_message" "text",
    "initiated_by" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_ideation_technique_runs_attempt_count_check" CHECK (("attempt_count" >= 1)),
    CONSTRAINT "client_ideation_technique_runs_idempotency_check" CHECK ((("length"("idempotency_key") >= 1) AND ("length"("idempotency_key") <= 180))),
    CONSTRAINT "client_ideation_technique_runs_input_hash_check" CHECK (("input_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "client_ideation_technique_runs_order_check" CHECK ((("technique_order" >= 1) AND ("technique_order" <= 7))),
    CONSTRAINT "client_ideation_technique_runs_slot_counts_check" CHECK ((("jsonb_typeof"("requested_slots") = 'array'::"text") AND ("generated_slots" >= 0) AND ("failed_slots" >= 0) AND ("failed_slots" = GREATEST(("jsonb_array_length"("requested_slots") - "generated_slots"), 0)))),
    CONSTRAINT "client_ideation_technique_runs_slug_check" CHECK (("technique_slug" = ANY (ARRAY['persona'::"text", 'review-mined-pain-language'::"text", 'competitor-objections'::"text", 'end-customer-complaints'::"text", 'live-objection-log'::"text", 'trigger-event'::"text", 'format-swipe'::"text"]))),
    CONSTRAINT "client_ideation_technique_runs_snapshot_check" CHECK ((("jsonb_typeof"("authority_snapshot") = 'object'::"text") AND ("jsonb_typeof"("technique_snapshot") = 'object'::"text") AND (("proposed_output" IS NULL) OR ("jsonb_typeof"("proposed_output") = 'object'::"text")))),
    CONSTRAINT "client_ideation_technique_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'complete'::"text", 'no_source'::"text", 'inactive'::"text", 'shortfall'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_ideation_technique_runs_version_check" CHECK (("technique_version" >= 1))
);


ALTER TABLE "public"."client_ideation_technique_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_ideation_technique_runs" IS 'Execution records for the fixed Ideation technique manifest. These are not client strategic playbooks or Phase 1/Phase 2 runs.';



CREATE TABLE IF NOT EXISTS "public"."client_insights_collection_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "distribution_record_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "external_post_id" "text" NOT NULL,
    "snapshot_label" "text" NOT NULL,
    "status" "text" NOT NULL,
    "reason" "text",
    "metrics_requested" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "metrics_collected" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "unsupported_metrics" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "error_category" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_insights_collection_attempts_error_category_check" CHECK ((("error_category" IS NULL) OR ("error_category" = ANY (ARRAY['meta_authentication'::"text", 'meta_permission'::"text", 'meta_rate_limit'::"text", 'meta_unsupported_metric'::"text", 'meta_media_unavailable'::"text", 'meta_network'::"text", 'validation'::"text", 'unknown'::"text"])))),
    CONSTRAINT "client_insights_collection_attempts_metrics_collected_check" CHECK (("jsonb_typeof"("metrics_collected") = 'object'::"text")),
    CONSTRAINT "client_insights_collection_attempts_status_check" CHECK (("status" = ANY (ARRAY['collected'::"text", 'skipped'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."client_insights_collection_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_insights_collection_attempts" IS 'Per-distribution-record outcomes from Instagram Insights collection.';



CREATE TABLE IF NOT EXISTS "public"."client_insights_collection_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "worker_id" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "mode" "text" NOT NULL,
    "due_count" integer DEFAULT 0 NOT NULL,
    "collected_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_insights_collection_runs_collected_count_check" CHECK (("collected_count" >= 0)),
    CONSTRAINT "client_insights_collection_runs_due_count_check" CHECK (("due_count" >= 0)),
    CONSTRAINT "client_insights_collection_runs_failed_count_check" CHECK (("failed_count" >= 0)),
    CONSTRAINT "client_insights_collection_runs_mode_check" CHECK (("mode" = ANY (ARRAY['dry_run'::"text", 'live'::"text"]))),
    CONSTRAINT "client_insights_collection_runs_skipped_count_check" CHECK (("skipped_count" >= 0)),
    CONSTRAINT "client_insights_collection_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'completed_with_errors'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."client_insights_collection_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_insights_collection_runs" IS 'Invocation-level audit for the unscheduled Instagram Insights worker.';



CREATE TABLE IF NOT EXISTS "public"."client_iteration_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "source_ref" "text",
    "distribution_record_id" "uuid",
    "performance_score_id" "uuid",
    "performance_insight_id" "uuid",
    "candidate_type" "text" NOT NULL,
    "recommendation" "text" NOT NULL,
    "rationale" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "confidence" "text" NOT NULL,
    "priority" "text" NOT NULL,
    "status" "text" DEFAULT 'needs_review'::"text" NOT NULL,
    "created_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "created_from" "text" NOT NULL,
    "reviewer_notes" "text",
    "reviewed_at" timestamp with time zone,
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_iteration_candidates_candidate_type_check" CHECK (("candidate_type" = ANY (ARRAY['hook'::"text", 'proof_angle'::"text", 'cta'::"text", 'format'::"text", 'story_sequence'::"text", 'content_angle'::"text", 'offer'::"text", 'audience'::"text", 'distribution'::"text", 'asset'::"text", 'calendar'::"text", 'other'::"text"]))),
    CONSTRAINT "client_iteration_candidates_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_iteration_candidates_created_by_check" CHECK (("created_by" = ANY (ARRAY['operator'::"text", 'system'::"text"]))),
    CONSTRAINT "client_iteration_candidates_created_from_check" CHECK (("created_from" = ANY (ARRAY['performance_score'::"text", 'performance_insight'::"text", 'manual'::"text"]))),
    CONSTRAINT "client_iteration_candidates_evidence_check" CHECK (("jsonb_typeof"("evidence") = 'object'::"text")),
    CONSTRAINT "client_iteration_candidates_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_iteration_candidates_rationale_check" CHECK (("length"(TRIM(BOTH FROM "rationale")) > 0)),
    CONSTRAINT "client_iteration_candidates_recommendation_check" CHECK (("length"(TRIM(BOTH FROM "recommendation")) > 0)),
    CONSTRAINT "client_iteration_candidates_status_check" CHECK (("status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'converted'::"text"])))
);


ALTER TABLE "public"."client_iteration_candidates" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_iteration_candidates" IS 'Reviewed intake queue only; candidates never mutate downstream strategy, content, assets, calendar, or distribution.';



CREATE TABLE IF NOT EXISTS "public"."client_iteration_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "iteration_candidate_id" "uuid" NOT NULL,
    "previous_status" "text",
    "new_status" "text" NOT NULL,
    "review_note" "text",
    "reviewed_by" "text" DEFAULT 'operator'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_iteration_reviews_new_status_check" CHECK (("new_status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'converted'::"text"]))),
    CONSTRAINT "client_iteration_reviews_previous_status_check" CHECK ((("previous_status" IS NULL) OR ("previous_status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text", 'dismissed'::"text", 'converted'::"text"]))))
);


ALTER TABLE "public"."client_iteration_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_iteration_reviews" IS 'Append-only audit of iteration-candidate review decisions.';



CREATE TABLE IF NOT EXISTS "public"."client_performance_analysis_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "run_mode" "text" DEFAULT 'manual'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "records_scored" integer DEFAULT 0 NOT NULL,
    "insights_created" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_performance_analysis_runs_insights_created_check" CHECK (("insights_created" >= 0)),
    CONSTRAINT "client_performance_analysis_runs_records_scored_check" CHECK (("records_scored" >= 0)),
    CONSTRAINT "client_performance_analysis_runs_run_mode_check" CHECK (("run_mode" = ANY (ARRAY['manual'::"text", 'scheduled_later'::"text"]))),
    CONSTRAINT "client_performance_analysis_runs_skipped_count_check" CHECK (("skipped_count" >= 0)),
    CONSTRAINT "client_performance_analysis_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'completed_with_errors'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."client_performance_analysis_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_performance_analysis_runs" IS 'Audit of deterministic performance-analysis runs.';



CREATE TABLE IF NOT EXISTS "public"."client_performance_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "distribution_record_id" "uuid",
    "source_ref" "text",
    "insight_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "confidence" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "recommended_action" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_performance_insights_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_performance_insights_evidence_check" CHECK (("jsonb_typeof"("evidence") = 'object'::"text")),
    CONSTRAINT "client_performance_insights_insight_type_check" CHECK (("insight_type" = ANY (ARRAY['winner'::"text", 'underperformer'::"text", 'format_signal'::"text", 'hook_signal'::"text", 'proof_signal'::"text", 'cta_signal'::"text", 'audience_signal'::"text", 'conversion_signal'::"text", 'risk'::"text", 'recommendation'::"text"]))),
    CONSTRAINT "client_performance_insights_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "client_performance_insights_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'accepted'::"text", 'dismissed'::"text", 'converted_to_iteration'::"text"])))
);


ALTER TABLE "public"."client_performance_insights" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_performance_insights" IS 'Structured explainable performance signals; no AI or iteration mutation.';



CREATE TABLE IF NOT EXISTS "public"."client_performance_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "distribution_record_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "content_format" "text" NOT NULL,
    "platform" "text" DEFAULT 'instagram'::"text" NOT NULL,
    "latest_metric_snapshot_id" "uuid",
    "latest_business_signal_snapshot_id" "uuid",
    "score_version" "text" NOT NULL,
    "attention_score" numeric(6,2),
    "engagement_score" numeric(6,2),
    "trust_score" numeric(6,2),
    "conversion_signal_score" numeric(6,2),
    "overall_score" numeric(6,2),
    "sample_quality" "text" NOT NULL,
    "score_status" "text" NOT NULL,
    "score_reasons" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_performance_scores_attention_score_check" CHECK ((("attention_score" >= (0)::numeric) AND ("attention_score" <= (100)::numeric))),
    CONSTRAINT "client_performance_scores_conversion_signal_score_check" CHECK ((("conversion_signal_score" >= (0)::numeric) AND ("conversion_signal_score" <= (100)::numeric))),
    CONSTRAINT "client_performance_scores_engagement_score_check" CHECK ((("engagement_score" >= (0)::numeric) AND ("engagement_score" <= (100)::numeric))),
    CONSTRAINT "client_performance_scores_overall_score_check" CHECK ((("overall_score" >= (0)::numeric) AND ("overall_score" <= (100)::numeric))),
    CONSTRAINT "client_performance_scores_sample_quality_check" CHECK (("sample_quality" = ANY (ARRAY['insufficient'::"text", 'early'::"text", 'usable'::"text", 'mature'::"text"]))),
    CONSTRAINT "client_performance_scores_score_reasons_check" CHECK (("jsonb_typeof"("score_reasons") = 'array'::"text")),
    CONSTRAINT "client_performance_scores_score_status_check" CHECK (("score_status" = ANY (ARRAY['pending_metrics'::"text", 'scored'::"text", 'insufficient_data'::"text", 'stale'::"text"]))),
    CONSTRAINT "client_performance_scores_trust_score_check" CHECK ((("trust_score" >= (0)::numeric) AND ("trust_score" <= (100)::numeric)))
);


ALTER TABLE "public"."client_performance_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_performance_scores" IS 'Current deterministic scorecard per published distribution record.';



CREATE TABLE IF NOT EXISTS "public"."client_phase3_scoped_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "generation_mode" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "duplicate_policy" "text" DEFAULT 'skip_existing'::"text" NOT NULL,
    "format_filter" "text"[],
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "total_slots" integer DEFAULT 0 NOT NULL,
    "created_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "conflicted_count" integer DEFAULT 0 NOT NULL,
    "created_refs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "plan" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "idempotency_key" "text",
    "last_error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_phase3_scoped_runs_check" CHECK (("start_date" <= "end_date")),
    CONSTRAINT "client_phase3_scoped_runs_duplicate_policy_check" CHECK (("duplicate_policy" = ANY (ARRAY['skip_existing'::"text", 'fill_missing'::"text", 'replace_unapproved'::"text"]))),
    CONSTRAINT "client_phase3_scoped_runs_generation_mode_check" CHECK (("generation_mode" = ANY (ARRAY['range'::"text", 'single_item'::"text"]))),
    CONSTRAINT "client_phase3_scoped_runs_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'generating'::"text", 'partial'::"text", 'complete'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."client_phase3_scoped_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_production_briefs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "execution_month" "text" NOT NULL,
    "source_table" "text" NOT NULL,
    "source_row_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_format" "text" NOT NULL,
    "title" "text" NOT NULL,
    "content_md" "text" NOT NULL,
    "status" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "production_mode" "text",
    "production_status" "text" DEFAULT 'brief'::"text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "generated_by_function" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_production_briefs_asset_format_check" CHECK (("asset_format" = ANY (ARRAY['ad_static'::"text", 'reel_video'::"text", 'story_sequence'::"text", 'carousel'::"text", 'feed_post'::"text"]))),
    CONSTRAINT "client_production_briefs_content_md_check" CHECK (("length"(TRIM(BOTH FROM "content_md")) > 0)),
    CONSTRAINT "client_production_briefs_execution_month_check" CHECK (("execution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "client_production_briefs_production_mode_check" CHECK ((("production_mode" IS NULL) OR ("production_mode" = ANY (ARRAY['human'::"text", 'ai'::"text", 'hybrid'::"text"])))),
    CONSTRAINT "client_production_briefs_production_status_check" CHECK (("production_status" = ANY (ARRAY['brief'::"text", 'assigned_human'::"text", 'ai_ready'::"text", 'producing'::"text", 'produced'::"text", 'failed'::"text"]))),
    CONSTRAINT "client_production_briefs_source_table_check" CHECK (("source_table" = ANY (ARRAY['organic_master'::"text", 'story_master'::"text", 'ads_master'::"text"]))),
    CONSTRAINT "client_production_briefs_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."client_production_briefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_publish_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "distribution_record_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "source_ref" "text" NOT NULL,
    "asset_format" "text",
    "attempt_number" integer NOT NULL,
    "worker_invocation_id" "text",
    "claimed_by" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "result" "text" DEFAULT 'started'::"text" NOT NULL,
    "category" "text",
    "retryable" boolean,
    "meta_error_code" integer,
    "meta_error_subcode" integer,
    "external_post_id" "text",
    "container_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_publish_attempts_result_check" CHECK (("result" = ANY (ARRAY['started'::"text", 'published'::"text", 'retryable_failure'::"text", 'permanent_failure'::"text", 'ambiguous'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."client_publish_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contractor_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "production_brief_id" "uuid" NOT NULL,
    "contractor_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'assigned'::"text" NOT NULL,
    "message" "text",
    "sent_at" timestamp with time zone,
    "resend_message_id" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contractor_assignments_status_check" CHECK (("status" = ANY (ARRAY['assigned'::"text", 'sent'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."contractor_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contractors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text",
    "specialties" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contractors_email_check" CHECK (("email" ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::"text")),
    CONSTRAINT "contractors_name_check" CHECK (("length"(TRIM(BOTH FROM "name")) > 0))
);


ALTER TABLE "public"."contractors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."generation_credits_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "video_shot_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "render_tier" "text" NOT NULL,
    "credits" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "generation_credits_ledger_credits_check" CHECK (("credits" > 0)),
    CONSTRAINT "generation_credits_ledger_model_check" CHECK (("btrim"("model") <> ''::"text")),
    CONSTRAINT "generation_credits_ledger_render_tier_check" CHECK (("render_tier" = ANY (ARRAY['draft'::"text", 'final'::"text"])))
);


ALTER TABLE "public"."generation_credits_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "public"."integration_status" DEFAULT 'not_configured'::"public"."integration_status" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_magnet_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text",
    "ref" "text" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "concept" "text",
    "landing_page_copy" "text",
    "nurture_emails" "text",
    "ad_angles" "text",
    "delivery_asset_outline" "text",
    "status" "text",
    "linked_proof" "text",
    "linked_offer" "text",
    "cta" "text",
    "destination" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_magnet_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_metrics_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "profile_visits" integer DEFAULT 0,
    "followers" integer DEFAULT 0,
    "qualified_followers" integer DEFAULT 0,
    "conversations" integer DEFAULT 0,
    "qualified_conversations" integer DEFAULT 0,
    "appointments" integer DEFAULT 0,
    "qualified_appointments" integer DEFAULT 0,
    "show_ups" integer DEFAULT 0,
    "cash_collected" numeric(12,2) DEFAULT 0,
    "source" "public"."pipeline_source" DEFAULT 'manual'::"public"."pipeline_source" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pipeline_metrics_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."playbook_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "playbook_slug" "text" NOT NULL,
    "month" "text",
    "status" "public"."playbook_run_status" DEFAULT 'running'::"public"."playbook_run_status" NOT NULL,
    "input_context_refs" "jsonb" DEFAULT '[]'::"jsonb",
    "reasoning_summary" "text",
    "proposed_output" "jsonb",
    "affected_tables" "jsonb" DEFAULT '[]'::"jsonb",
    "affected_calendar_dates" "jsonb" DEFAULT '[]'::"jsonb",
    "risks" "jsonb" DEFAULT '[]'::"jsonb",
    "run_by" "uuid",
    "decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."playbook_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."playbooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text",
    "storage_path" "text",
    "content_md" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."playbooks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."qualification_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "qualified_follower_rules" "text",
    "qualified_conversation_rules" "text",
    "qualified_appointment_rules" "text",
    "additional_config" "jsonb" DEFAULT '{}'::"jsonb",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."qualification_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ref_counters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "current_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."ref_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."secret_references" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "secret_name" "text" NOT NULL,
    "integration_id" "uuid",
    "present" boolean DEFAULT false NOT NULL,
    "added_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."secret_references" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sops_laws" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text",
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "content_json" "jsonb" DEFAULT '{}'::"jsonb",
    "content_md" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sops_laws" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "public"."user_role" DEFAULT 'account_manager'::"public"."user_role" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."website_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "month" "text",
    "ref" "text" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "page_section" "text",
    "role" "text",
    "message" "text",
    "proof_required" "text",
    "cta" "text",
    "section_copy_direction" "text",
    "claims_allowed" "text",
    "status" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."website_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_sequence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "review_state" "public"."review_state" DEFAULT 'needs_review'::"public"."review_state" NOT NULL,
    "day_of_week" "text" NOT NULL,
    "slot_time" "text",
    "content_type" "text",
    "archetype_lean" "text",
    "rationale" "text",
    "production_note" "text",
    "tally" "text",
    "non_negotiable_flag" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."weekly_sequence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" DEFAULT 'Attract Acquisition'::"text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ad_creative"
    ADD CONSTRAINT "ad_creative_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ads_master"
    ADD CONSTRAINT "ads_master_client_id_ref_key" UNIQUE ("client_id", "ref");



ALTER TABLE ONLY "public"."ads_master"
    ADD CONSTRAINT "ads_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_brief_index"
    ADD CONSTRAINT "asset_brief_index_client_id_brief_id_key" UNIQUE ("client_id", "brief_id");



ALTER TABLE ONLY "public"."asset_brief_index"
    ADD CONSTRAINT "asset_brief_index_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_master"
    ADD CONSTRAINT "asset_master_client_id_asset_id_key" UNIQUE ("client_id", "asset_id");



ALTER TABLE ONLY "public"."asset_master"
    ADD CONSTRAINT "asset_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_runs"
    ADD CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automations"
    ADD CONSTRAINT "automations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_prompt_blocks"
    ADD CONSTRAINT "brand_prompt_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_prompt_blocks"
    ADD CONSTRAINT "brand_prompt_blocks_type_version_unique" UNIQUE ("block_type", "version");



ALTER TABLE ONLY "public"."calendar_cells"
    ADD CONSTRAINT "calendar_cells_client_id_date_row_type_ref_key" UNIQUE ("client_id", "date", "row_type", "ref");



ALTER TABLE ONLY "public"."calendar_cells"
    ADD CONSTRAINT "calendar_cells_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ai_background_image_generations"
    ADD CONSTRAINT "client_ai_background_image_generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ai_background_image_reviews"
    ADD CONSTRAINT "client_ai_background_image_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_analytics_records"
    ADD CONSTRAINT "client_analytics_records_group_seq_unique" UNIQUE ("client_id", "asset_group_ref", "sequence_index");



ALTER TABLE ONLY "public"."client_analytics_records"
    ADD CONSTRAINT "client_analytics_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_asset_archive_snapshots"
    ADD CONSTRAINT "client_asset_archive_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_asset_generation_items"
    ADD CONSTRAINT "client_asset_generation_items_job_sequence_unique" UNIQUE ("generation_job_id", "sequence_index");



ALTER TABLE ONLY "public"."client_asset_generation_items"
    ADD CONSTRAINT "client_asset_generation_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_asset_generation_jobs"
    ADD CONSTRAINT "client_asset_generation_jobs_asset_group_ref_key" UNIQUE ("asset_group_ref");



ALTER TABLE ONLY "public"."client_asset_generation_jobs"
    ADD CONSTRAINT "client_asset_generation_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_asset_group_completeness_overrides"
    ADD CONSTRAINT "client_asset_group_completeness_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_asset_group_warning_acknowledgements"
    ADD CONSTRAINT "client_asset_group_warning_ac_client_id_asset_group_ref_war_key" UNIQUE ("client_id", "asset_group_ref", "warning_code", "warning_fingerprint");



ALTER TABLE ONLY "public"."client_asset_group_warning_acknowledgements"
    ADD CONSTRAINT "client_asset_group_warning_acknowledgements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_asset_pipeline_state"
    ADD CONSTRAINT "client_asset_pipeline_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_asset_pipeline_state"
    ADD CONSTRAINT "client_asset_pipeline_state_ref_unique" UNIQUE ("client_id", "execution_month", "source_ref");



ALTER TABLE ONLY "public"."client_assets"
    ADD CONSTRAINT "client_assets_group_sequence_version_unique" UNIQUE ("production_brief_id", "asset_group_ref", "sequence_index", "version");



ALTER TABLE ONLY "public"."client_assets"
    ADD CONSTRAINT "client_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_assets"
    ADD CONSTRAINT "client_assets_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."client_business_signal_snapshots"
    ADD CONSTRAINT "client_business_signal_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_context_files"
    ADD CONSTRAINT "client_context_files_client_id_file_number_key" UNIQUE ("client_id", "file_number");



ALTER TABLE ONLY "public"."client_context_files"
    ADD CONSTRAINT "client_context_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_context_patch_applications"
    ADD CONSTRAINT "client_context_patch_applications_patch_draft_id_key" UNIQUE ("patch_draft_id");



ALTER TABLE ONLY "public"."client_context_patch_applications"
    ADD CONSTRAINT "client_context_patch_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_context_patch_drafts"
    ADD CONSTRAINT "client_context_patch_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_context_patch_reviews"
    ADD CONSTRAINT "client_context_patch_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_context_update_proposal_items"
    ADD CONSTRAINT "client_context_update_proposal_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_context_update_proposals"
    ADD CONSTRAINT "client_context_update_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_context_update_reviews"
    ADD CONSTRAINT "client_context_update_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_destructive_operations"
    ADD CONSTRAINT "client_destructive_operations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_distribution_accounts"
    ADD CONSTRAINT "client_distribution_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_distribution_records"
    ADD CONSTRAINT "client_distribution_records_group_seq_unique" UNIQUE ("client_id", "asset_group_ref", "sequence_index");



ALTER TABLE ONLY "public"."client_distribution_records"
    ADD CONSTRAINT "client_distribution_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_execution_files"
    ADD CONSTRAINT "client_execution_files_client_id_month_file_name_key" UNIQUE ("client_id", "month", "file_name");



ALTER TABLE ONLY "public"."client_execution_files"
    ADD CONSTRAINT "client_execution_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_calendar_proposal_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_client_idempotency_key" UNIQUE ("client_id", "idempotency_key");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_id_client_key" UNIQUE ("id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_id_cycle_client_key" UNIQUE ("id", "ideation_cycle_id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_candidate_scores"
    ADD CONSTRAINT "client_ideation_candidate_scores_id_run_key" UNIQUE ("id", "scoring_run_id");



ALTER TABLE ONLY "public"."client_ideation_candidate_scores"
    ADD CONSTRAINT "client_ideation_candidate_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_candidate_scores"
    ADD CONSTRAINT "client_ideation_candidate_scores_run_candidate_key" UNIQUE ("scoring_run_id", "candidate_id");



ALTER TABLE ONLY "public"."client_ideation_candidate_scores"
    ADD CONSTRAINT "client_ideation_candidate_scores_run_rank_key" UNIQUE ("scoring_run_id", "rank");



ALTER TABLE ONLY "public"."client_ideation_candidates"
    ADD CONSTRAINT "client_ideation_candidates_id_cycle_client_key" UNIQUE ("id", "ideation_cycle_id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_candidates"
    ADD CONSTRAINT "client_ideation_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_candidates"
    ADD CONSTRAINT "client_ideation_candidates_run_index" UNIQUE ("technique_run_id", "candidate_index");



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_calendar_key" UNIQUE ("target_calendar_cell_id");



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_master_key" UNIQUE ("target_master_table", "target_master_id");



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_ref_key" UNIQUE ("client_id", "operational_ref");



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_run_candidate_key" UNIQUE ("commit_run_id", "candidate_id");



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_run_slot_key" UNIQUE ("commit_run_id", "proposal_slot_id");



ALTER TABLE ONLY "public"."client_ideation_commit_runs"
    ADD CONSTRAINT "client_ideation_commit_runs_id_client_key" UNIQUE ("id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_commit_runs"
    ADD CONSTRAINT "client_ideation_commit_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_cycles"
    ADD CONSTRAINT "client_ideation_cycles_client_idempotency_key" UNIQUE ("client_id", "idempotency_key");



ALTER TABLE ONLY "public"."client_ideation_cycles"
    ADD CONSTRAINT "client_ideation_cycles_id_client_key" UNIQUE ("id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_cycles"
    ADD CONSTRAINT "client_ideation_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_proposal_slots_id_proposal_key" UNIQUE ("id", "proposal_id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_proposal_slots_proposal_candidate_key" UNIQUE ("proposal_id", "candidate_id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_proposal_slots_proposal_key" UNIQUE ("proposal_id", "proposal_slot_key");



ALTER TABLE ONLY "public"."client_ideation_research_results"
    ADD CONSTRAINT "client_ideation_research_cycle_key" UNIQUE ("ideation_cycle_id", "research_key");



ALTER TABLE ONLY "public"."client_ideation_research_results"
    ADD CONSTRAINT "client_ideation_research_id_run_cycle_client_key" UNIQUE ("id", "technique_run_id", "ideation_cycle_id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_research_results"
    ADD CONSTRAINT "client_ideation_research_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_client_idempotency_key" UNIQUE ("client_id", "idempotency_key");



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_id_client_key" UNIQUE ("id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_id_cycle_client_key" UNIQUE ("id", "ideation_cycle_id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_client_idempotency_key" UNIQUE ("client_id", "idempotency_key");



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_cycle_order_key" UNIQUE ("ideation_cycle_id", "technique_order");



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_cycle_slug_key" UNIQUE ("ideation_cycle_id", "technique_slug");



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_id_cycle_client_key" UNIQUE ("id", "ideation_cycle_id", "client_id");



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_inputs"
    ADD CONSTRAINT "client_inputs_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."client_inputs"
    ADD CONSTRAINT "client_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_insights_collection_attempts"
    ADD CONSTRAINT "client_insights_collection_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_insights_collection_runs"
    ADD CONSTRAINT "client_insights_collection_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_iteration_candidates"
    ADD CONSTRAINT "client_iteration_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_iteration_reviews"
    ADD CONSTRAINT "client_iteration_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_metric_snapshots"
    ADD CONSTRAINT "client_metric_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_performance_analysis_runs"
    ADD CONSTRAINT "client_performance_analysis_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_performance_insights"
    ADD CONSTRAINT "client_performance_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_performance_scores"
    ADD CONSTRAINT "client_performance_scores_distribution_record_id_key" UNIQUE ("distribution_record_id");



ALTER TABLE ONLY "public"."client_performance_scores"
    ADD CONSTRAINT "client_performance_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_phase3_scope_items"
    ADD CONSTRAINT "client_phase3_scope_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_phase3_scope_items"
    ADD CONSTRAINT "client_phase3_scope_items_run_slot_unique" UNIQUE ("run_id", "slot_key");



ALTER TABLE ONLY "public"."client_phase3_scoped_runs"
    ADD CONSTRAINT "client_phase3_scoped_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_production_briefs"
    ADD CONSTRAINT "client_production_briefs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_production_briefs"
    ADD CONSTRAINT "client_production_briefs_source_unique" UNIQUE ("client_id", "execution_month", "source_ref", "asset_format");



ALTER TABLE ONLY "public"."client_publish_attempts"
    ADD CONSTRAINT "client_publish_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_users"
    ADD CONSTRAINT "client_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_users"
    ADD CONSTRAINT "client_users_user_id_client_id_key" UNIQUE ("user_id", "client_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."contractor_assignments"
    ADD CONSTRAINT "contractor_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contractors"
    ADD CONSTRAINT "contractors_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."contractors"
    ADD CONSTRAINT "contractors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generation_credits_ledger"
    ADD CONSTRAINT "generation_credits_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_magnet_master"
    ADD CONSTRAINT "lead_magnet_master_client_id_ref_key" UNIQUE ("client_id", "ref");



ALTER TABLE ONLY "public"."lead_magnet_master"
    ADD CONSTRAINT "lead_magnet_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organic_master"
    ADD CONSTRAINT "organic_master_client_id_ref_key" UNIQUE ("client_id", "ref");



ALTER TABLE ONLY "public"."organic_master"
    ADD CONSTRAINT "organic_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_metrics_daily"
    ADD CONSTRAINT "pipeline_metrics_daily_client_id_date_key" UNIQUE ("client_id", "date");



ALTER TABLE ONLY "public"."pipeline_metrics_daily"
    ADD CONSTRAINT "pipeline_metrics_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playbook_runs"
    ADD CONSTRAINT "playbook_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playbooks"
    ADD CONSTRAINT "playbooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playbooks"
    ADD CONSTRAINT "playbooks_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."proof_master"
    ADD CONSTRAINT "proof_master_client_id_ref_key" UNIQUE ("client_id", "ref");



ALTER TABLE ONLY "public"."proof_master"
    ADD CONSTRAINT "proof_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."qualification_configs"
    ADD CONSTRAINT "qualification_configs_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."qualification_configs"
    ADD CONSTRAINT "qualification_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ref_counters"
    ADD CONSTRAINT "ref_counters_client_id_month_channel_key" UNIQUE ("client_id", "month", "channel");



ALTER TABLE ONLY "public"."ref_counters"
    ADD CONSTRAINT "ref_counters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."secret_references"
    ADD CONSTRAINT "secret_references_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."secret_references"
    ADD CONSTRAINT "secret_references_secret_name_key" UNIQUE ("secret_name");



ALTER TABLE ONLY "public"."sops_laws"
    ADD CONSTRAINT "sops_laws_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."story_master"
    ADD CONSTRAINT "story_master_client_id_ref_key" UNIQUE ("client_id", "ref");



ALTER TABLE ONLY "public"."story_master"
    ADD CONSTRAINT "story_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_client_id_key" UNIQUE ("user_id", "client_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_project_deliverables"
    ADD CONSTRAINT "video_project_deliverables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_projects"
    ADD CONSTRAINT "video_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_shots"
    ADD CONSTRAINT "video_shots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_shots"
    ADD CONSTRAINT "video_shots_project_shot_unique" UNIQUE ("video_project_id", "shot_number");



ALTER TABLE ONLY "public"."website_master"
    ADD CONSTRAINT "website_master_client_id_ref_key" UNIQUE ("client_id", "ref");



ALTER TABLE ONLY "public"."website_master"
    ADD CONSTRAINT "website_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_sequence"
    ADD CONSTRAINT "weekly_sequence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_slug_key" UNIQUE ("slug");



CREATE UNIQUE INDEX "brand_prompt_blocks_one_active_per_type" ON "public"."brand_prompt_blocks" USING "btree" ("block_type") WHERE "is_active";



CREATE INDEX "client_ai_background_generations_brief_idx" ON "public"."client_ai_background_image_generations" USING "btree" ("production_brief_id", "created_at" DESC);



CREATE INDEX "client_ai_background_generations_client_idx" ON "public"."client_ai_background_image_generations" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ai_background_generations_source_idx" ON "public"."client_ai_background_image_generations" USING "btree" ("client_id", "source_ref", "created_at" DESC);



CREATE INDEX "client_ai_background_generations_status_idx" ON "public"."client_ai_background_image_generations" USING "btree" ("client_id", "prompt_status", "created_at" DESC);



CREATE UNIQUE INDEX "client_ai_background_one_active_generation" ON "public"."client_ai_background_image_generations" USING "btree" ("client_id", "production_brief_id", COALESCE("frame_index", 0)) WHERE ("prompt_status" = 'generating'::"text");



CREATE UNIQUE INDEX "client_ai_background_provider_request_unique" ON "public"."client_ai_background_image_generations" USING "btree" ("provider_request_id") WHERE ("provider_request_id" IS NOT NULL);



CREATE INDEX "client_ai_background_reviews_generation_idx" ON "public"."client_ai_background_image_reviews" USING "btree" ("generation_id", "created_at" DESC);



CREATE INDEX "client_analytics_records_client_month_idx" ON "public"."client_analytics_records" USING "btree" ("client_id", "execution_month");



CREATE INDEX "client_analytics_records_source_ref_idx" ON "public"."client_analytics_records" USING "btree" ("client_id", "source_ref");



CREATE INDEX "client_asset_archive_snapshots_client_month_idx" ON "public"."client_asset_archive_snapshots" USING "btree" ("client_id", "execution_month");



CREATE INDEX "client_asset_archive_snapshots_created_idx" ON "public"."client_asset_archive_snapshots" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_asset_archive_snapshots_group_ref_idx" ON "public"."client_asset_archive_snapshots" USING "btree" ("asset_group_ref");



CREATE INDEX "client_asset_archive_snapshots_source_ref_idx" ON "public"."client_asset_archive_snapshots" USING "btree" ("client_id", "source_ref");



CREATE INDEX "client_asset_archive_snapshots_stage_idx" ON "public"."client_asset_archive_snapshots" USING "btree" ("stage");



CREATE INDEX "client_asset_generation_items_job_idx" ON "public"."client_asset_generation_items" USING "btree" ("generation_job_id", "sequence_index");



CREATE INDEX "client_asset_generation_items_job_status_idx" ON "public"."client_asset_generation_items" USING "btree" ("generation_job_id", "status");



CREATE INDEX "client_asset_generation_jobs_active_idx" ON "public"."client_asset_generation_jobs" USING "btree" ("status", "updated_at") WHERE ("status" = ANY (ARRAY['queued'::"text", 'processing'::"text"]));



CREATE INDEX "client_asset_generation_jobs_brief_idx" ON "public"."client_asset_generation_jobs" USING "btree" ("production_brief_id", "created_at" DESC);



CREATE INDEX "client_asset_generation_jobs_client_status_idx" ON "public"."client_asset_generation_jobs" USING "btree" ("client_id", "status", "updated_at" DESC);



CREATE UNIQUE INDEX "client_asset_generation_jobs_one_active_per_brief" ON "public"."client_asset_generation_jobs" USING "btree" ("production_brief_id") WHERE ("status" = ANY (ARRAY['queued'::"text", 'processing'::"text"]));



CREATE INDEX "client_asset_group_completeness_override_client_idx" ON "public"."client_asset_group_completeness_overrides" USING "btree" ("client_id", "asset_group_ref", "created_at" DESC);



CREATE UNIQUE INDEX "client_asset_group_one_active_completeness_override" ON "public"."client_asset_group_completeness_overrides" USING "btree" ("client_id", "asset_group_ref") WHERE ("is_active" AND ("revoked_at" IS NULL));



CREATE INDEX "client_asset_group_warning_ack_client_idx" ON "public"."client_asset_group_warning_acknowledgements" USING "btree" ("client_id", "asset_group_ref", "warning_code");



CREATE INDEX "client_asset_pipeline_state_active_stage_idx" ON "public"."client_asset_pipeline_state" USING "btree" ("client_id", "execution_month", "active", "current_stage");



CREATE INDEX "client_asset_pipeline_state_client_month_idx" ON "public"."client_asset_pipeline_state" USING "btree" ("client_id", "execution_month", "current_stage");



CREATE INDEX "client_asset_pipeline_state_group_ref_idx" ON "public"."client_asset_pipeline_state" USING "btree" ("asset_group_ref");



CREATE INDEX "client_asset_pipeline_state_source_ref_idx" ON "public"."client_asset_pipeline_state" USING "btree" ("client_id", "source_ref");



CREATE INDEX "client_assets_brief_group_idx" ON "public"."client_assets" USING "btree" ("production_brief_id", "asset_group_ref", "sequence_index");



CREATE INDEX "client_assets_client_created_idx" ON "public"."client_assets" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_assets_frame_versions_idx" ON "public"."client_assets" USING "btree" ("production_brief_id", "asset_group_ref", "sequence_index", "version" DESC);



CREATE UNIQUE INDEX "client_assets_one_current_per_frame" ON "public"."client_assets" USING "btree" ("production_brief_id", "asset_group_ref", "sequence_index") WHERE "is_current";



CREATE INDEX "client_assets_source_ref_idx" ON "public"."client_assets" USING "btree" ("client_id", "source_ref");



CREATE INDEX "client_business_signal_snapshots_client_idx" ON "public"."client_business_signal_snapshots" USING "btree" ("client_id", "signal_at" DESC);



CREATE INDEX "client_business_signal_snapshots_created_idx" ON "public"."client_business_signal_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "client_business_signal_snapshots_distribution_idx" ON "public"."client_business_signal_snapshots" USING "btree" ("distribution_record_id", "signal_at" DESC);



CREATE INDEX "client_business_signal_snapshots_source_idx" ON "public"."client_business_signal_snapshots" USING "btree" ("client_id", "source_ref", "signal_at" DESC);



CREATE INDEX "client_context_patch_applications_client_idx" ON "public"."client_context_patch_applications" USING "btree" ("client_id", "applied_at" DESC);



CREATE INDEX "client_context_patch_applications_file_idx" ON "public"."client_context_patch_applications" USING "btree" ("target_file_id", "applied_at" DESC);



CREATE UNIQUE INDEX "client_context_patch_drafts_active_unique" ON "public"."client_context_patch_drafts" USING "btree" ("client_id", "context_update_proposal_id", "target_file_id", "patch_type", "lower"("title")) WHERE ("status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'approved'::"text"]));



CREATE INDEX "client_context_patch_drafts_client_idx" ON "public"."client_context_patch_drafts" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_context_patch_drafts_file_idx" ON "public"."client_context_patch_drafts" USING "btree" ("target_file_id", "status", "created_at" DESC);



CREATE INDEX "client_context_patch_drafts_item_idx" ON "public"."client_context_patch_drafts" USING "btree" ("proposal_item_id") WHERE ("proposal_item_id" IS NOT NULL);



CREATE INDEX "client_context_patch_drafts_proposal_idx" ON "public"."client_context_patch_drafts" USING "btree" ("context_update_proposal_id", "created_at" DESC);



CREATE INDEX "client_context_patch_drafts_status_idx" ON "public"."client_context_patch_drafts" USING "btree" ("client_id", "status", "updated_at" DESC);



CREATE INDEX "client_context_patch_reviews_client_idx" ON "public"."client_context_patch_reviews" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_context_patch_reviews_patch_idx" ON "public"."client_context_patch_reviews" USING "btree" ("patch_draft_id", "created_at" DESC);



CREATE INDEX "client_context_update_proposal_items_client_idx" ON "public"."client_context_update_proposal_items" USING "btree" ("client_id", "target_type", "created_at" DESC);



CREATE INDEX "client_context_update_proposal_items_file_idx" ON "public"."client_context_update_proposal_items" USING "btree" ("target_file_id", "created_at" DESC) WHERE ("target_file_id" IS NOT NULL);



CREATE INDEX "client_context_update_proposal_items_proposal_idx" ON "public"."client_context_update_proposal_items" USING "btree" ("proposal_id", "created_at");



CREATE UNIQUE INDEX "client_context_update_proposals_active_unique" ON "public"."client_context_update_proposals" USING "btree" ("client_id", COALESCE("iteration_candidate_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "proposal_type", "lower"("title")) WHERE ("status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text"]));



CREATE INDEX "client_context_update_proposals_candidate_idx" ON "public"."client_context_update_proposals" USING "btree" ("iteration_candidate_id", "created_at" DESC);



CREATE INDEX "client_context_update_proposals_client_idx" ON "public"."client_context_update_proposals" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_context_update_proposals_distribution_idx" ON "public"."client_context_update_proposals" USING "btree" ("distribution_record_id", "created_at" DESC);



CREATE INDEX "client_context_update_proposals_source_idx" ON "public"."client_context_update_proposals" USING "btree" ("client_id", "source_ref", "created_at" DESC);



CREATE INDEX "client_context_update_proposals_status_idx" ON "public"."client_context_update_proposals" USING "btree" ("client_id", "status", "priority", "created_at" DESC);



CREATE INDEX "client_context_update_reviews_client_idx" ON "public"."client_context_update_reviews" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_context_update_reviews_proposal_idx" ON "public"."client_context_update_reviews" USING "btree" ("proposal_id", "created_at" DESC);



CREATE INDEX "client_destructive_operations_client_idx" ON "public"."client_destructive_operations" USING "btree" ("client_id", "created_at" DESC);



CREATE UNIQUE INDEX "client_distribution_accounts_active_external_unique" ON "public"."client_distribution_accounts" USING "btree" ("client_id", "platform", "external_account_id") WHERE "is_active";



CREATE INDEX "client_distribution_accounts_active_idx" ON "public"."client_distribution_accounts" USING "btree" ("client_id", "platform", "is_active");



CREATE INDEX "client_distribution_accounts_client_idx" ON "public"."client_distribution_accounts" USING "btree" ("client_id");



CREATE UNIQUE INDEX "client_distribution_accounts_one_default" ON "public"."client_distribution_accounts" USING "btree" ("client_id", "platform") WHERE ("is_active" AND "is_default");



CREATE INDEX "client_distribution_accounts_platform_idx" ON "public"."client_distribution_accounts" USING "btree" ("platform");



CREATE UNIQUE INDEX "client_distribution_records_active_deliverable_uidx" ON "public"."client_distribution_records" USING "btree" ("video_deliverable_id") WHERE (("video_deliverable_id" IS NOT NULL) AND ("publish_status" = ANY (ARRAY['ready'::"text", 'scheduled'::"text", 'publishing'::"text", 'published'::"text", 'needs_reconciliation'::"text"])));



CREATE INDEX "client_distribution_records_client_month_idx" ON "public"."client_distribution_records" USING "btree" ("client_id", "execution_month", "publish_status");



CREATE INDEX "client_distribution_records_due_idx" ON "public"."client_distribution_records" USING "btree" ("publish_status", "scheduled_publish_at");



CREATE INDEX "client_distribution_records_group_seq_idx" ON "public"."client_distribution_records" USING "btree" ("client_id", "asset_group_ref", "sequence_index");



CREATE INDEX "client_distribution_records_retry_idx" ON "public"."client_distribution_records" USING "btree" ("publish_status", "next_attempt_at");



CREATE INDEX "client_distribution_records_source_ref_idx" ON "public"."client_distribution_records" USING "btree" ("client_id", "source_ref");



CREATE INDEX "client_ideation_calendar_proposals_client_created_idx" ON "public"."client_ideation_calendar_proposals" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_calendar_proposals_cycle_created_idx" ON "public"."client_ideation_calendar_proposals" USING "btree" ("ideation_cycle_id", "created_at" DESC);



CREATE INDEX "client_ideation_calendar_proposals_scoring_run_idx" ON "public"."client_ideation_calendar_proposals" USING "btree" ("scoring_run_id", "created_at" DESC);



CREATE INDEX "client_ideation_candidate_scores_client_idx" ON "public"."client_ideation_candidate_scores" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_candidate_scores_cycle_idx" ON "public"."client_ideation_candidate_scores" USING "btree" ("ideation_cycle_id", "created_at" DESC);



CREATE INDEX "client_ideation_candidate_scores_run_rank_idx" ON "public"."client_ideation_candidate_scores" USING "btree" ("scoring_run_id", "rank");



CREATE INDEX "client_ideation_candidates_client_status_idx" ON "public"."client_ideation_candidates" USING "btree" ("client_id", "status", "created_at" DESC);



CREATE INDEX "client_ideation_candidates_cycle_asset_idx" ON "public"."client_ideation_candidates" USING "btree" ("ideation_cycle_id", "asset_type", "created_at");



CREATE INDEX "client_ideation_commit_items_client_idx" ON "public"."client_ideation_commit_items" USING "btree" ("client_id", "execution_month");



CREATE INDEX "client_ideation_commit_items_master_idx" ON "public"."client_ideation_commit_items" USING "btree" ("target_master_table", "target_master_id");



CREATE INDEX "client_ideation_commit_items_proposal_idx" ON "public"."client_ideation_commit_items" USING "btree" ("proposal_id");



CREATE INDEX "client_ideation_commit_items_run_idx" ON "public"."client_ideation_commit_items" USING "btree" ("commit_run_id", "committed_date");



CREATE INDEX "client_ideation_commit_runs_client_idx" ON "public"."client_ideation_commit_runs" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_commit_runs_cycle_idx" ON "public"."client_ideation_commit_runs" USING "btree" ("ideation_cycle_id");



CREATE UNIQUE INDEX "client_ideation_commit_runs_one_completed_idx" ON "public"."client_ideation_commit_runs" USING "btree" ("proposal_id") WHERE ("status" = 'completed'::"text");



CREATE INDEX "client_ideation_commit_runs_proposal_idx" ON "public"."client_ideation_commit_runs" USING "btree" ("proposal_id", "status");



CREATE INDEX "client_ideation_cycles_client_created_idx" ON "public"."client_ideation_cycles" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_cycles_client_status_idx" ON "public"."client_ideation_cycles" USING "btree" ("client_id", "status", "updated_at" DESC);



CREATE INDEX "client_ideation_proposal_slots_candidate_idx" ON "public"."client_ideation_calendar_proposal_slots" USING "btree" ("candidate_id");



CREATE INDEX "client_ideation_proposal_slots_client_idx" ON "public"."client_ideation_calendar_proposal_slots" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_proposal_slots_proposal_date_idx" ON "public"."client_ideation_calendar_proposal_slots" USING "btree" ("proposal_id", "proposed_date", "date_slot_ordinal");



CREATE INDEX "client_ideation_research_client_created_idx" ON "public"."client_ideation_research_results" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_research_run_idx" ON "public"."client_ideation_research_results" USING "btree" ("technique_run_id");



CREATE INDEX "client_ideation_scoring_runs_client_created_idx" ON "public"."client_ideation_scoring_runs" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_scoring_runs_cycle_created_idx" ON "public"."client_ideation_scoring_runs" USING "btree" ("ideation_cycle_id", "created_at" DESC);



CREATE INDEX "client_ideation_scoring_runs_status_idx" ON "public"."client_ideation_scoring_runs" USING "btree" ("client_id", "status", "updated_at" DESC);



CREATE INDEX "client_ideation_technique_runs_client_created_idx" ON "public"."client_ideation_technique_runs" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_ideation_technique_runs_cycle_idx" ON "public"."client_ideation_technique_runs" USING "btree" ("ideation_cycle_id", "technique_order");



CREATE INDEX "client_insights_attempts_client_idx" ON "public"."client_insights_collection_attempts" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_insights_attempts_distribution_idx" ON "public"."client_insights_collection_attempts" USING "btree" ("distribution_record_id", "created_at" DESC);



CREATE INDEX "client_insights_attempts_run_idx" ON "public"."client_insights_collection_attempts" USING "btree" ("run_id", "created_at" DESC);



CREATE INDEX "client_insights_attempts_source_idx" ON "public"."client_insights_collection_attempts" USING "btree" ("client_id", "source_ref", "created_at" DESC);



CREATE INDEX "client_insights_runs_started_idx" ON "public"."client_insights_collection_runs" USING "btree" ("started_at" DESC);



CREATE INDEX "client_insights_runs_status_idx" ON "public"."client_insights_collection_runs" USING "btree" ("status", "started_at" DESC);



CREATE INDEX "client_iteration_candidates_client_idx" ON "public"."client_iteration_candidates" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_iteration_candidates_distribution_idx" ON "public"."client_iteration_candidates" USING "btree" ("distribution_record_id", "created_at" DESC);



CREATE UNIQUE INDEX "client_iteration_candidates_open_unique" ON "public"."client_iteration_candidates" USING "btree" ("client_id", COALESCE("source_ref", ''::"text"), "candidate_type", "lower"("recommendation")) WHERE ("status" = ANY (ARRAY['needs_review'::"text", 'approved'::"text"]));



CREATE INDEX "client_iteration_candidates_source_idx" ON "public"."client_iteration_candidates" USING "btree" ("client_id", "source_ref", "created_at" DESC);



CREATE INDEX "client_iteration_candidates_status_idx" ON "public"."client_iteration_candidates" USING "btree" ("client_id", "status", "priority", "created_at" DESC);



CREATE INDEX "client_iteration_reviews_candidate_idx" ON "public"."client_iteration_reviews" USING "btree" ("iteration_candidate_id", "created_at" DESC);



CREATE INDEX "client_iteration_reviews_client_idx" ON "public"."client_iteration_reviews" USING "btree" ("client_id", "created_at" DESC);



CREATE UNIQUE INDEX "client_metric_snapshots_api_label_unique" ON "public"."client_metric_snapshots" USING "btree" ("distribution_record_id", "snapshot_label") WHERE ("collection_method" = 'api'::"text");



CREATE INDEX "client_metric_snapshots_client_idx" ON "public"."client_metric_snapshots" USING "btree" ("client_id", "snapshot_at" DESC);



CREATE INDEX "client_metric_snapshots_created_idx" ON "public"."client_metric_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "client_metric_snapshots_distribution_idx" ON "public"."client_metric_snapshots" USING "btree" ("distribution_record_id", "snapshot_at" DESC);



CREATE INDEX "client_metric_snapshots_source_idx" ON "public"."client_metric_snapshots" USING "btree" ("client_id", "source_ref", "snapshot_at" DESC);



CREATE INDEX "client_performance_insights_client_idx" ON "public"."client_performance_insights" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_performance_insights_distribution_idx" ON "public"."client_performance_insights" USING "btree" ("distribution_record_id", "created_at" DESC);



CREATE UNIQUE INDEX "client_performance_insights_open_unique" ON "public"."client_performance_insights" USING "btree" ("distribution_record_id", "insight_type", "title") WHERE ("status" = 'open'::"text");



CREATE INDEX "client_performance_insights_status_idx" ON "public"."client_performance_insights" USING "btree" ("client_id", "status", "created_at" DESC);



CREATE INDEX "client_performance_runs_client_idx" ON "public"."client_performance_analysis_runs" USING "btree" ("client_id", "started_at" DESC);



CREATE INDEX "client_performance_scores_client_idx" ON "public"."client_performance_scores" USING "btree" ("client_id", "overall_score" DESC);



CREATE INDEX "client_performance_scores_source_idx" ON "public"."client_performance_scores" USING "btree" ("client_id", "source_ref");



CREATE INDEX "client_performance_scores_status_idx" ON "public"."client_performance_scores" USING "btree" ("client_id", "score_status", "computed_at" DESC);



CREATE INDEX "client_phase3_scope_items_run_idx" ON "public"."client_phase3_scope_items" USING "btree" ("run_id", "status");



CREATE INDEX "client_phase3_scoped_runs_client_idx" ON "public"."client_phase3_scoped_runs" USING "btree" ("client_id", "created_at" DESC);



CREATE UNIQUE INDEX "client_phase3_scoped_runs_idem" ON "public"."client_phase3_scoped_runs" USING "btree" ("client_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "client_production_briefs_client_month_idx" ON "public"."client_production_briefs" USING "btree" ("client_id", "execution_month", "updated_at" DESC);



CREATE INDEX "client_production_briefs_source_idx" ON "public"."client_production_briefs" USING "btree" ("source_table", "source_row_id");



CREATE INDEX "client_publish_attempts_client_idx" ON "public"."client_publish_attempts" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_publish_attempts_record_idx" ON "public"."client_publish_attempts" USING "btree" ("distribution_record_id", "attempt_number");



CREATE INDEX "contractor_assignments_brief_idx" ON "public"."contractor_assignments" USING "btree" ("production_brief_id", "created_at" DESC);



CREATE INDEX "contractor_assignments_client_idx" ON "public"."contractor_assignments" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "contractor_assignments_contractor_idx" ON "public"."contractor_assignments" USING "btree" ("contractor_id", "created_at" DESC);



CREATE INDEX "generation_credits_ledger_created_idx" ON "public"."generation_credits_ledger" USING "btree" ("created_at" DESC);



CREATE INDEX "generation_credits_ledger_shot_idx" ON "public"."generation_credits_ledger" USING "btree" ("video_shot_id");



CREATE INDEX "idx_abi_client_month" ON "public"."asset_brief_index" USING "btree" ("client_id", "execution_month");



CREATE INDEX "idx_abi_status" ON "public"."asset_brief_index" USING "btree" ("status");



CREATE INDEX "idx_activity_client" ON "public"."activity_log" USING "btree" ("client_id");



CREATE INDEX "idx_activity_created" ON "public"."activity_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ads_client_month" ON "public"."ads_master" USING "btree" ("client_id", "month");



CREATE INDEX "idx_ads_dates" ON "public"."ads_master" USING "btree" ("start_date", "end_date");



CREATE INDEX "idx_auto_runs_auto" ON "public"."automation_runs" USING "btree" ("automation_id");



CREATE INDEX "idx_auto_runs_client" ON "public"."automation_runs" USING "btree" ("client_id");



CREATE INDEX "idx_automations_client" ON "public"."automations" USING "btree" ("client_id");



CREATE INDEX "idx_calendar_client_month" ON "public"."calendar_cells" USING "btree" ("client_id", "month");



CREATE INDEX "idx_calendar_date" ON "public"."calendar_cells" USING "btree" ("date");



CREATE INDEX "idx_ccf_client" ON "public"."client_context_files" USING "btree" ("client_id");



CREATE INDEX "idx_cef_client_month" ON "public"."client_execution_files" USING "btree" ("client_id", "month");



CREATE INDEX "idx_client_users_user" ON "public"."client_users" USING "btree" ("user_id");



CREATE INDEX "idx_clients_acct_mgr" ON "public"."clients" USING "btree" ("account_manager_id");



CREATE INDEX "idx_clients_stage1" ON "public"."clients" USING "btree" ("stage1_status");



CREATE INDEX "idx_clients_stage2" ON "public"."clients" USING "btree" ("stage2_status");



CREATE INDEX "idx_clients_status" ON "public"."clients" USING "btree" ("status");



CREATE INDEX "idx_organic_client_month" ON "public"."organic_master" USING "btree" ("client_id", "month");



CREATE INDEX "idx_organic_dist_date" ON "public"."organic_master" USING "btree" ("distribution_date");



CREATE INDEX "idx_organic_review" ON "public"."organic_master" USING "btree" ("review_state");



CREATE INDEX "idx_pipeline_client_date" ON "public"."pipeline_metrics_daily" USING "btree" ("client_id", "date");



CREATE INDEX "idx_playbook_runs_client" ON "public"."playbook_runs" USING "btree" ("client_id");



CREATE INDEX "idx_proof_client" ON "public"."proof_master" USING "btree" ("client_id");



CREATE INDEX "idx_story_client_month" ON "public"."story_master" USING "btree" ("client_id", "month");



CREATE INDEX "idx_story_dist_date" ON "public"."story_master" USING "btree" ("distribution_date");



CREATE INDEX "idx_team_members_client" ON "public"."team_members" USING "btree" ("client_id");



CREATE INDEX "idx_team_members_user" ON "public"."team_members" USING "btree" ("user_id");



CREATE INDEX "video_project_deliverables_client_idx" ON "public"."video_project_deliverables" USING "btree" ("client_id", "video_project_id", "version" DESC);



CREATE UNIQUE INDEX "video_project_deliverables_one_current_uidx" ON "public"."video_project_deliverables" USING "btree" ("video_project_id") WHERE "is_current";



CREATE UNIQUE INDEX "video_project_deliverables_path_uidx" ON "public"."video_project_deliverables" USING "btree" ("storage_bucket", "storage_path");



CREATE UNIQUE INDEX "video_project_deliverables_version_uidx" ON "public"."video_project_deliverables" USING "btree" ("video_project_id", "version");



CREATE INDEX "video_projects_ads_idx" ON "public"."video_projects" USING "btree" ("ads_master_id");



CREATE INDEX "video_projects_client_status_idx" ON "public"."video_projects" USING "btree" ("client_id", "status", "updated_at" DESC);



CREATE INDEX "video_projects_organic_idx" ON "public"."video_projects" USING "btree" ("organic_master_id");



CREATE INDEX "video_shots_active_idx" ON "public"."video_shots" USING "btree" ("status", "updated_at") WHERE ("status" = ANY (ARRAY['still_submitted'::"text", 'still_rendering'::"text", 'submitted'::"text", 'rendering'::"text"]));



CREATE INDEX "video_shots_project_idx" ON "public"."video_shots" USING "btree" ("video_project_id", "shot_number");



CREATE OR REPLACE TRIGGER "ad_creative_updated_at" BEFORE UPDATE ON "public"."ad_creative" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "ads_master_updated_at" BEFORE UPDATE ON "public"."ads_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "asset_brief_index_updated_at" BEFORE UPDATE ON "public"."asset_brief_index" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "asset_master_updated_at" BEFORE UPDATE ON "public"."asset_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "automations_updated_at" BEFORE UPDATE ON "public"."automations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "brand_prompt_blocks_updated_at" BEFORE UPDATE ON "public"."brand_prompt_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "calendar_cells_updated_at" BEFORE UPDATE ON "public"."calendar_cells" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_context_files_updated_at" BEFORE UPDATE ON "public"."client_context_files" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_distribution_accounts_updated_at" BEFORE UPDATE ON "public"."client_distribution_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_execution_files_updated_at" BEFORE UPDATE ON "public"."client_execution_files" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_calendar_proposal_slots_updated_at" BEFORE UPDATE ON "public"."client_ideation_calendar_proposal_slots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_calendar_proposals_updated_at" BEFORE UPDATE ON "public"."client_ideation_calendar_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_candidate_scores_updated_at" BEFORE UPDATE ON "public"."client_ideation_candidate_scores" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_candidates_updated_at" BEFORE UPDATE ON "public"."client_ideation_candidates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_cycles_updated_at" BEFORE UPDATE ON "public"."client_ideation_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_research_results_updated_at" BEFORE UPDATE ON "public"."client_ideation_research_results" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_scoring_runs_updated_at" BEFORE UPDATE ON "public"."client_ideation_scoring_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_ideation_technique_runs_updated_at" BEFORE UPDATE ON "public"."client_ideation_technique_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_inputs_updated_at" BEFORE UPDATE ON "public"."client_inputs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "enforce_distribution_publish_capability" BEFORE INSERT OR UPDATE ON "public"."client_distribution_records" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_distribution_publish_capability"();



CREATE OR REPLACE TRIGGER "integrations_updated_at" BEFORE UPDATE ON "public"."integrations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "lead_magnet_master_updated_at" BEFORE UPDATE ON "public"."lead_magnet_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "organic_master_updated_at" BEFORE UPDATE ON "public"."organic_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "pipeline_metrics_daily_updated_at" BEFORE UPDATE ON "public"."pipeline_metrics_daily" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "playbook_runs_updated_at" BEFORE UPDATE ON "public"."playbook_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "playbooks_updated_at" BEFORE UPDATE ON "public"."playbooks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "proof_master_updated_at" BEFORE UPDATE ON "public"."proof_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "qualification_configs_updated_at" BEFORE UPDATE ON "public"."qualification_configs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "secret_references_updated_at" BEFORE UPDATE ON "public"."secret_references" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "sops_laws_updated_at" BEFORE UPDATE ON "public"."sops_laws" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "story_master_updated_at" BEFORE UPDATE ON "public"."story_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "video_projects_updated_at" BEFORE UPDATE ON "public"."video_projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "video_shots_updated_at" BEFORE UPDATE ON "public"."video_shots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "website_master_updated_at" BEFORE UPDATE ON "public"."website_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "weekly_sequence_updated_at" BEFORE UPDATE ON "public"."weekly_sequence" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspaces_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ad_creative"
    ADD CONSTRAINT "ad_creative_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ads_master"
    ADD CONSTRAINT "ads_master_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_brief_index"
    ADD CONSTRAINT "asset_brief_index_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."asset_brief_index"
    ADD CONSTRAINT "asset_brief_index_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_brief_index"
    ADD CONSTRAINT "asset_brief_index_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."asset_brief_index"
    ADD CONSTRAINT "asset_brief_index_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."asset_master"
    ADD CONSTRAINT "asset_master_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_master"
    ADD CONSTRAINT "asset_master_uploader_fkey" FOREIGN KEY ("uploader") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."automation_runs"
    ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_runs"
    ADD CONSTRAINT "automation_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automations"
    ADD CONSTRAINT "automations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_cells"
    ADD CONSTRAINT "calendar_cells_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ai_background_image_generations"
    ADD CONSTRAINT "client_ai_background_image_generations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ai_background_image_generations"
    ADD CONSTRAINT "client_ai_background_image_generations_production_brief_id_fkey" FOREIGN KEY ("production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_ai_background_image_reviews"
    ADD CONSTRAINT "client_ai_background_image_reviews_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ai_background_image_reviews"
    ADD CONSTRAINT "client_ai_background_image_reviews_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "public"."client_ai_background_image_generations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_analytics_records"
    ADD CONSTRAINT "client_analytics_records_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_analytics_records"
    ADD CONSTRAINT "client_analytics_records_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_asset_archive_snapshots"
    ADD CONSTRAINT "client_asset_archive_snapshots_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_asset_generation_items"
    ADD CONSTRAINT "client_asset_generation_items_client_asset_id_fkey" FOREIGN KEY ("client_asset_id") REFERENCES "public"."client_assets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_asset_generation_items"
    ADD CONSTRAINT "client_asset_generation_items_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "public"."client_asset_generation_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_asset_generation_jobs"
    ADD CONSTRAINT "client_asset_generation_jobs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_asset_generation_jobs"
    ADD CONSTRAINT "client_asset_generation_jobs_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."client_asset_generation_jobs"
    ADD CONSTRAINT "client_asset_generation_jobs_production_brief_id_fkey" FOREIGN KEY ("production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_asset_group_completeness_overrides"
    ADD CONSTRAINT "client_asset_group_completeness_overri_production_brief_id_fkey" FOREIGN KEY ("production_brief_id") REFERENCES "public"."client_production_briefs"("id");



ALTER TABLE ONLY "public"."client_asset_group_completeness_overrides"
    ADD CONSTRAINT "client_asset_group_completeness_override_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "public"."client_asset_generation_jobs"("id");



ALTER TABLE ONLY "public"."client_asset_group_completeness_overrides"
    ADD CONSTRAINT "client_asset_group_completeness_overrides_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_asset_group_completeness_overrides"
    ADD CONSTRAINT "client_asset_group_completeness_overrides_overridden_by_fkey" FOREIGN KEY ("overridden_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."client_asset_group_completeness_overrides"
    ADD CONSTRAINT "client_asset_group_completeness_overrides_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."client_asset_group_warning_acknowledgements"
    ADD CONSTRAINT "client_asset_group_warning_acknowledgements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_asset_group_warning_acknowledgements"
    ADD CONSTRAINT "client_asset_group_warning_acknowledgements_dismissed_by_fkey" FOREIGN KEY ("dismissed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."client_asset_pipeline_state"
    ADD CONSTRAINT "client_asset_pipeline_state_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_asset_pipeline_state"
    ADD CONSTRAINT "client_asset_pipeline_state_production_brief_id_fkey" FOREIGN KEY ("production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_assets"
    ADD CONSTRAINT "client_assets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_assets"
    ADD CONSTRAINT "client_assets_production_brief_id_fkey" FOREIGN KEY ("production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_business_signal_snapshots"
    ADD CONSTRAINT "client_business_signal_snapshots_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_business_signal_snapshots"
    ADD CONSTRAINT "client_business_signal_snapshots_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_files"
    ADD CONSTRAINT "client_context_files_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_patch_applications"
    ADD CONSTRAINT "client_context_patch_applications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_patch_applications"
    ADD CONSTRAINT "client_context_patch_applications_patch_draft_id_fkey" FOREIGN KEY ("patch_draft_id") REFERENCES "public"."client_context_patch_drafts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_context_patch_applications"
    ADD CONSTRAINT "client_context_patch_applications_target_file_id_fkey" FOREIGN KEY ("target_file_id") REFERENCES "public"."client_context_files"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_context_patch_drafts"
    ADD CONSTRAINT "client_context_patch_drafts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_patch_drafts"
    ADD CONSTRAINT "client_context_patch_drafts_context_update_proposal_id_fkey" FOREIGN KEY ("context_update_proposal_id") REFERENCES "public"."client_context_update_proposals"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_context_patch_drafts"
    ADD CONSTRAINT "client_context_patch_drafts_proposal_item_id_fkey" FOREIGN KEY ("proposal_item_id") REFERENCES "public"."client_context_update_proposal_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_context_patch_drafts"
    ADD CONSTRAINT "client_context_patch_drafts_target_file_id_fkey" FOREIGN KEY ("target_file_id") REFERENCES "public"."client_context_files"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_context_patch_reviews"
    ADD CONSTRAINT "client_context_patch_reviews_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_patch_reviews"
    ADD CONSTRAINT "client_context_patch_reviews_patch_draft_id_fkey" FOREIGN KEY ("patch_draft_id") REFERENCES "public"."client_context_patch_drafts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_update_proposal_items"
    ADD CONSTRAINT "client_context_update_proposal_items_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_update_proposal_items"
    ADD CONSTRAINT "client_context_update_proposal_items_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."client_context_update_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_update_proposal_items"
    ADD CONSTRAINT "client_context_update_proposal_items_target_file_id_fkey" FOREIGN KEY ("target_file_id") REFERENCES "public"."client_context_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_context_update_proposals"
    ADD CONSTRAINT "client_context_update_proposals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_update_proposals"
    ADD CONSTRAINT "client_context_update_proposals_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_context_update_proposals"
    ADD CONSTRAINT "client_context_update_proposals_iteration_candidate_id_fkey" FOREIGN KEY ("iteration_candidate_id") REFERENCES "public"."client_iteration_candidates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_context_update_reviews"
    ADD CONSTRAINT "client_context_update_reviews_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_context_update_reviews"
    ADD CONSTRAINT "client_context_update_reviews_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."client_context_update_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_destructive_operations"
    ADD CONSTRAINT "client_destructive_operations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_distribution_accounts"
    ADD CONSTRAINT "client_distribution_accounts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_distribution_records"
    ADD CONSTRAINT "client_distribution_records_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_distribution_records"
    ADD CONSTRAINT "client_distribution_records_production_brief_id_fkey" FOREIGN KEY ("production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_distribution_records"
    ADD CONSTRAINT "client_distribution_records_video_deliverable_id_fkey" FOREIGN KEY ("video_deliverable_id") REFERENCES "public"."video_project_deliverables"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_distribution_records"
    ADD CONSTRAINT "client_distribution_records_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_execution_files"
    ADD CONSTRAINT "client_execution_files_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."client_execution_files"
    ADD CONSTRAINT "client_execution_files_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_execution_files"
    ADD CONSTRAINT "client_execution_files_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_calendar_proposal_slots_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_cycle_client_fk" FOREIGN KEY ("ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_cycles"("id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_scoring_run_fk" FOREIGN KEY ("scoring_run_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_scoring_runs"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposals"
    ADD CONSTRAINT "client_ideation_calendar_proposals_supersedes_fk" FOREIGN KEY ("supersedes_proposal_id", "client_id") REFERENCES "public"."client_ideation_calendar_proposals"("id", "client_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_candidate_scores"
    ADD CONSTRAINT "client_ideation_candidate_scores_candidate_cycle_client_fk" FOREIGN KEY ("candidate_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_candidates"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_candidate_scores"
    ADD CONSTRAINT "client_ideation_candidate_scores_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_candidate_scores"
    ADD CONSTRAINT "client_ideation_candidate_scores_run_cycle_client_fk" FOREIGN KEY ("scoring_run_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_scoring_runs"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_candidates"
    ADD CONSTRAINT "client_ideation_candidates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_candidates"
    ADD CONSTRAINT "client_ideation_candidates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_candidates"
    ADD CONSTRAINT "client_ideation_candidates_research_run_cycle_client_fk" FOREIGN KEY ("research_result_id", "technique_run_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_research_results"("id", "technique_run_id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_candidates"
    ADD CONSTRAINT "client_ideation_candidates_run_cycle_client_fk" FOREIGN KEY ("technique_run_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_technique_runs"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_candidate_fk" FOREIGN KEY ("candidate_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_candidates"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_proposal_fk" FOREIGN KEY ("proposal_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_calendar_proposals"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_run_fk" FOREIGN KEY ("commit_run_id", "client_id") REFERENCES "public"."client_ideation_commit_runs"("id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_score_fk" FOREIGN KEY ("candidate_score_id", "scoring_run_id") REFERENCES "public"."client_ideation_candidate_scores"("id", "scoring_run_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_items"
    ADD CONSTRAINT "client_ideation_commit_items_slot_fk" FOREIGN KEY ("proposal_slot_id", "proposal_id") REFERENCES "public"."client_ideation_calendar_proposal_slots"("id", "proposal_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_runs"
    ADD CONSTRAINT "client_ideation_commit_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_runs"
    ADD CONSTRAINT "client_ideation_commit_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_commit_runs"
    ADD CONSTRAINT "client_ideation_commit_runs_cycle_fk" FOREIGN KEY ("ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_cycles"("id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_runs"
    ADD CONSTRAINT "client_ideation_commit_runs_proposal_fk" FOREIGN KEY ("proposal_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_calendar_proposals"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_commit_runs"
    ADD CONSTRAINT "client_ideation_commit_runs_scoring_run_fk" FOREIGN KEY ("scoring_run_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_scoring_runs"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_cycles"
    ADD CONSTRAINT "client_ideation_cycles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_cycles"
    ADD CONSTRAINT "client_ideation_cycles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_proposal_slots_candidate_cycle_client_fk" FOREIGN KEY ("candidate_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_candidates"("id", "ideation_cycle_id", "client_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_proposal_slots_proposal_cycle_client_fk" FOREIGN KEY ("proposal_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_calendar_proposals"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_calendar_proposal_slots"
    ADD CONSTRAINT "client_ideation_proposal_slots_score_run_fk" FOREIGN KEY ("candidate_score_id", "scoring_run_id") REFERENCES "public"."client_ideation_candidate_scores"("id", "scoring_run_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_ideation_research_results"
    ADD CONSTRAINT "client_ideation_research_results_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_research_results"
    ADD CONSTRAINT "client_ideation_research_run_cycle_client_fk" FOREIGN KEY ("technique_run_id", "ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_technique_runs"("id", "ideation_cycle_id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_cycle_client_fk" FOREIGN KEY ("ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_cycles"("id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_scoring_runs"
    ADD CONSTRAINT "client_ideation_scoring_runs_supersedes_client_fk" FOREIGN KEY ("supersedes_scoring_run_id", "client_id") REFERENCES "public"."client_ideation_scoring_runs"("id", "client_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_cycle_client_fk" FOREIGN KEY ("ideation_cycle_id", "client_id") REFERENCES "public"."client_ideation_cycles"("id", "client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_ideation_technique_runs"
    ADD CONSTRAINT "client_ideation_technique_runs_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_inputs"
    ADD CONSTRAINT "client_inputs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_insights_collection_attempts"
    ADD CONSTRAINT "client_insights_collection_attempts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_insights_collection_attempts"
    ADD CONSTRAINT "client_insights_collection_attempts_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_insights_collection_attempts"
    ADD CONSTRAINT "client_insights_collection_attempts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."client_insights_collection_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_iteration_candidates"
    ADD CONSTRAINT "client_iteration_candidates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_iteration_candidates"
    ADD CONSTRAINT "client_iteration_candidates_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_iteration_candidates"
    ADD CONSTRAINT "client_iteration_candidates_performance_insight_id_fkey" FOREIGN KEY ("performance_insight_id") REFERENCES "public"."client_performance_insights"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_iteration_candidates"
    ADD CONSTRAINT "client_iteration_candidates_performance_score_id_fkey" FOREIGN KEY ("performance_score_id") REFERENCES "public"."client_performance_scores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_iteration_reviews"
    ADD CONSTRAINT "client_iteration_reviews_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_iteration_reviews"
    ADD CONSTRAINT "client_iteration_reviews_iteration_candidate_id_fkey" FOREIGN KEY ("iteration_candidate_id") REFERENCES "public"."client_iteration_candidates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_metric_snapshots"
    ADD CONSTRAINT "client_metric_snapshots_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_metric_snapshots"
    ADD CONSTRAINT "client_metric_snapshots_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_performance_analysis_runs"
    ADD CONSTRAINT "client_performance_analysis_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_performance_insights"
    ADD CONSTRAINT "client_performance_insights_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_performance_insights"
    ADD CONSTRAINT "client_performance_insights_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_performance_scores"
    ADD CONSTRAINT "client_performance_scores_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_performance_scores"
    ADD CONSTRAINT "client_performance_scores_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_performance_scores"
    ADD CONSTRAINT "client_performance_scores_latest_business_signal_snapshot__fkey" FOREIGN KEY ("latest_business_signal_snapshot_id") REFERENCES "public"."client_business_signal_snapshots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_performance_scores"
    ADD CONSTRAINT "client_performance_scores_latest_metric_snapshot_id_fkey" FOREIGN KEY ("latest_metric_snapshot_id") REFERENCES "public"."client_metric_snapshots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_phase3_scope_items"
    ADD CONSTRAINT "client_phase3_scope_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."client_phase3_scoped_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_phase3_scoped_runs"
    ADD CONSTRAINT "client_phase3_scoped_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_production_briefs"
    ADD CONSTRAINT "client_production_briefs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_publish_attempts"
    ADD CONSTRAINT "client_publish_attempts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_publish_attempts"
    ADD CONSTRAINT "client_publish_attempts_distribution_record_id_fkey" FOREIGN KEY ("distribution_record_id") REFERENCES "public"."client_distribution_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_users"
    ADD CONSTRAINT "client_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_users"
    ADD CONSTRAINT "client_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_account_manager_id_fkey" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."contractor_assignments"
    ADD CONSTRAINT "contractor_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contractor_assignments"
    ADD CONSTRAINT "contractor_assignments_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contractor_assignments"
    ADD CONSTRAINT "contractor_assignments_production_brief_id_fkey" FOREIGN KEY ("production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generation_credits_ledger"
    ADD CONSTRAINT "generation_credits_ledger_video_shot_id_fkey" FOREIGN KEY ("video_shot_id") REFERENCES "public"."video_shots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_magnet_master"
    ADD CONSTRAINT "lead_magnet_master_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organic_master"
    ADD CONSTRAINT "organic_master_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organic_master"
    ADD CONSTRAINT "organic_master_editor_fkey" FOREIGN KEY ("editor") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."pipeline_metrics_daily"
    ADD CONSTRAINT "pipeline_metrics_daily_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playbook_runs"
    ADD CONSTRAINT "playbook_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playbook_runs"
    ADD CONSTRAINT "playbook_runs_run_by_fkey" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."proof_master"
    ADD CONSTRAINT "proof_master_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proof_master"
    ADD CONSTRAINT "proof_master_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."qualification_configs"
    ADD CONSTRAINT "qualification_configs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."qualification_configs"
    ADD CONSTRAINT "qualification_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."ref_counters"
    ADD CONSTRAINT "ref_counters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."secret_references"
    ADD CONSTRAINT "secret_references_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."secret_references"
    ADD CONSTRAINT "secret_references_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id");



ALTER TABLE ONLY "public"."sops_laws"
    ADD CONSTRAINT "sops_laws_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sops_laws"
    ADD CONSTRAINT "sops_laws_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."story_master"
    ADD CONSTRAINT "story_master_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_project_deliverables"
    ADD CONSTRAINT "video_project_deliverables_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_project_deliverables"
    ADD CONSTRAINT "video_project_deliverables_client_production_brief_id_fkey" FOREIGN KEY ("client_production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_project_deliverables"
    ADD CONSTRAINT "video_project_deliverables_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_project_deliverables"
    ADD CONSTRAINT "video_project_deliverables_superseded_by_deliverable_id_fkey" FOREIGN KEY ("superseded_by_deliverable_id") REFERENCES "public"."video_project_deliverables"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_project_deliverables"
    ADD CONSTRAINT "video_project_deliverables_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_project_deliverables"
    ADD CONSTRAINT "video_project_deliverables_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_projects"
    ADD CONSTRAINT "video_projects_ads_master_id_fkey" FOREIGN KEY ("ads_master_id") REFERENCES "public"."ads_master"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_projects"
    ADD CONSTRAINT "video_projects_brand_prompt_block_id_fkey" FOREIGN KEY ("brand_prompt_block_id") REFERENCES "public"."brand_prompt_blocks"("id");



ALTER TABLE ONLY "public"."video_projects"
    ADD CONSTRAINT "video_projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_projects"
    ADD CONSTRAINT "video_projects_client_production_brief_id_fkey" FOREIGN KEY ("client_production_brief_id") REFERENCES "public"."client_production_briefs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_projects"
    ADD CONSTRAINT "video_projects_current_deliverable_id_fkey" FOREIGN KEY ("current_deliverable_id") REFERENCES "public"."video_project_deliverables"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_projects"
    ADD CONSTRAINT "video_projects_organic_master_id_fkey" FOREIGN KEY ("organic_master_id") REFERENCES "public"."organic_master"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_shots"
    ADD CONSTRAINT "video_shots_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."website_master"
    ADD CONSTRAINT "website_master_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_sequence"
    ADD CONSTRAINT "weekly_sequence_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



CREATE POLICY "abi_ins" ON "public"."asset_brief_index" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "abi_sel" ON "public"."asset_brief_index" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "abi_upd" ON "public"."asset_brief_index" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "ac_ins" ON "public"."ad_creative" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "ac_sel" ON "public"."ad_creative" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "ac_upd" ON "public"."ad_creative" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ad_creative" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ads_master" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "al_ins" ON "public"."activity_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "al_sel" ON "public"."activity_log" FOR SELECT TO "authenticated" USING ((("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])) OR ("client_id" = ANY ("public"."auth_client_ids"()))));



CREATE POLICY "am_del" ON "public"."ads_master" FOR DELETE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"]))));



CREATE POLICY "am_ins" ON "public"."ads_master" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "am_sel" ON "public"."ads_master" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "am_upd" ON "public"."ads_master" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "ar_ins" ON "public"."automation_runs" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "ar_sel" ON "public"."automation_runs" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "asm_ins" ON "public"."asset_master" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "asm_sel" ON "public"."asset_master" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "asm_upd" ON "public"."asset_master" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."asset_brief_index" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aul_admin" ON "public"."audit_log" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



CREATE POLICY "auto_ins" ON "public"."automations" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "auto_sel" ON "public"."automations" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "auto_upd" ON "public"."automations" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."automation_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brand_prompt_blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brand_prompt_blocks_staff_select" ON "public"."brand_prompt_blocks" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."calendar_cells" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cc_del" ON "public"."calendar_cells" FOR DELETE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"]))));



CREATE POLICY "cc_ins" ON "public"."calendar_cells" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "cc_sel" ON "public"."calendar_cells" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "cc_upd" ON "public"."calendar_cells" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "ccf_insert" ON "public"."client_context_files" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "ccf_select" ON "public"."client_context_files" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "ccf_update" ON "public"."client_context_files" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "cef_insert" ON "public"."client_execution_files" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "cef_select" ON "public"."client_execution_files" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "cef_update" ON "public"."client_execution_files" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "client_ai_background_generations_staff_select" ON "public"."client_ai_background_image_generations" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_ai_background_image_generations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_ai_background_image_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ai_background_reviews_staff_select" ON "public"."client_ai_background_image_reviews" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_analytics_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_analytics_records_staff_insert" ON "public"."client_analytics_records" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_analytics_records_staff_select" ON "public"."client_analytics_records" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_analytics_records_staff_update" ON "public"."client_analytics_records" FOR UPDATE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_asset_archive_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_asset_archive_snapshots_staff_insert" ON "public"."client_asset_archive_snapshots" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_asset_archive_snapshots_staff_select" ON "public"."client_asset_archive_snapshots" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_asset_generation_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_asset_generation_items_staff_select" ON "public"."client_asset_generation_items" FOR SELECT TO "authenticated" USING ((("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."client_asset_generation_jobs" "j"
  WHERE ("j"."id" = "client_asset_generation_items"."generation_job_id")))));



ALTER TABLE "public"."client_asset_generation_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_asset_generation_jobs_staff_select" ON "public"."client_asset_generation_jobs" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_asset_group_completeness_override_staff_select" ON "public"."client_asset_group_completeness_overrides" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_asset_group_completeness_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_asset_group_warning_ack_staff_select" ON "public"."client_asset_group_warning_acknowledgements" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_asset_group_warning_acknowledgements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_asset_pipeline_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_asset_pipeline_state_staff_insert" ON "public"."client_asset_pipeline_state" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_asset_pipeline_state_staff_select" ON "public"."client_asset_pipeline_state" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_asset_pipeline_state_staff_update" ON "public"."client_asset_pipeline_state" FOR UPDATE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_assets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_assets_staff_all" ON "public"."client_assets" TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_business_signal_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_business_signal_snapshots_staff_select" ON "public"."client_business_signal_snapshots" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_context_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_context_patch_applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_context_patch_applications_staff_select" ON "public"."client_context_patch_applications" FOR SELECT TO "authenticated" USING ((COALESCE("public"."auth_role"(), ''::"text") = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_context_patch_drafts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_context_patch_drafts_staff_select" ON "public"."client_context_patch_drafts" FOR SELECT TO "authenticated" USING ((COALESCE("public"."auth_role"(), ''::"text") = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_context_patch_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_context_patch_reviews_staff_select" ON "public"."client_context_patch_reviews" FOR SELECT TO "authenticated" USING ((COALESCE("public"."auth_role"(), ''::"text") = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_context_update_proposal_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_context_update_proposal_items_staff_select" ON "public"."client_context_update_proposal_items" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_context_update_proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_context_update_proposals_staff_select" ON "public"."client_context_update_proposals" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_context_update_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_context_update_reviews_staff_select" ON "public"."client_context_update_reviews" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_destructive_operations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_destructive_operations_staff_select" ON "public"."client_destructive_operations" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_distribution_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_distribution_accounts_staff_insert" ON "public"."client_distribution_accounts" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_distribution_accounts_staff_select" ON "public"."client_distribution_accounts" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_distribution_accounts_staff_update" ON "public"."client_distribution_accounts" FOR UPDATE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_distribution_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_distribution_records_staff_insert" ON "public"."client_distribution_records" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_distribution_records_staff_select" ON "public"."client_distribution_records" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_distribution_records_staff_update" ON "public"."client_distribution_records" FOR UPDATE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_execution_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_ideation_calendar_proposal_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_calendar_proposal_slots_select" ON "public"."client_ideation_calendar_proposal_slots" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_calendar_proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_calendar_proposals_select" ON "public"."client_ideation_calendar_proposals" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_candidate_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_candidate_scores_select" ON "public"."client_ideation_candidate_scores" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_candidates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_candidates_select" ON "public"."client_ideation_candidates" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_commit_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_commit_items_staff_select" ON "public"."client_ideation_commit_items" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_commit_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_commit_runs_staff_select" ON "public"."client_ideation_commit_runs" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_cycles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_cycles_select" ON "public"."client_ideation_cycles" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_research_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_research_results_select" ON "public"."client_ideation_research_results" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_scoring_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_scoring_runs_select" ON "public"."client_ideation_scoring_runs" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_ideation_technique_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_ideation_technique_runs_select" ON "public"."client_ideation_technique_runs" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



ALTER TABLE "public"."client_inputs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_inputs_insert" ON "public"."client_inputs" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "client_inputs_select" ON "public"."client_inputs" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "client_inputs_update" ON "public"."client_inputs" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "client_insights_attempts_staff_select" ON "public"."client_insights_collection_attempts" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_insights_collection_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_insights_collection_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_insights_runs_staff_select" ON "public"."client_insights_collection_runs" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_iteration_candidates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_iteration_candidates_staff_select" ON "public"."client_iteration_candidates" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_iteration_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_iteration_reviews_staff_select" ON "public"."client_iteration_reviews" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_metric_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_metric_snapshots_staff_select" ON "public"."client_metric_snapshots" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_performance_analysis_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_performance_insights" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_performance_insights_staff_select" ON "public"."client_performance_insights" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_performance_runs_staff_select" ON "public"."client_performance_analysis_runs" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_performance_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_performance_scores_staff_select" ON "public"."client_performance_scores" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_phase3_scope_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_phase3_scope_items_staff_select" ON "public"."client_phase3_scope_items" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_phase3_scoped_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_phase3_scoped_runs_staff_select" ON "public"."client_phase3_scoped_runs" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_production_briefs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_production_briefs_staff_delete" ON "public"."client_production_briefs" FOR DELETE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_production_briefs_staff_insert" ON "public"."client_production_briefs" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_production_briefs_staff_select" ON "public"."client_production_briefs" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



CREATE POLICY "client_production_briefs_staff_update" ON "public"."client_production_briefs" FOR UPDATE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_publish_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_publish_attempts_staff_select" ON "public"."client_publish_attempts" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."client_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_users_admin" ON "public"."client_users" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



CREATE POLICY "client_users_select" ON "public"."client_users" FOR SELECT TO "authenticated" USING ((("public"."auth_role"() = 'admin'::"text") OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_delete" ON "public"."clients" FOR DELETE TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text"));



CREATE POLICY "clients_insert" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "clients_select" ON "public"."clients" FOR SELECT TO "authenticated" USING (("id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "clients_update" ON "public"."clients" FOR UPDATE TO "authenticated" USING ((("id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."contractor_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contractor_assignments_staff_all" ON "public"."contractor_assignments" TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."contractors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contractors_staff_all" ON "public"."contractors" TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."generation_credits_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "generation_credits_ledger_staff_select" ON "public"."generation_credits_ledger" FOR SELECT TO "authenticated" USING ((("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."video_shots" "s"
  WHERE ("s"."id" = "generation_credits_ledger"."video_shot_id")))));



CREATE POLICY "int_admin" ON "public"."integrations" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_magnet_master" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lmm_ins" ON "public"."lead_magnet_master" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "lmm_sel" ON "public"."lead_magnet_master" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "lmm_upd" ON "public"."lead_magnet_master" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "om_del" ON "public"."organic_master" FOR DELETE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"]))));



CREATE POLICY "om_ins" ON "public"."organic_master" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "om_sel" ON "public"."organic_master" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "om_upd" ON "public"."organic_master" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."organic_master" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pb_admin_wr" ON "public"."playbooks" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



CREATE POLICY "pb_sel_all" ON "public"."playbooks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "pbr_ins" ON "public"."playbook_runs" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "pbr_sel" ON "public"."playbook_runs" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "pbr_upd" ON "public"."playbook_runs" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."pipeline_metrics_daily" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playbook_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playbooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pm_ins" ON "public"."proof_master" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "pm_sel" ON "public"."proof_master" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "pm_upd" ON "public"."proof_master" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "pmd_ins" ON "public"."pipeline_metrics_daily" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "pmd_sel" ON "public"."pipeline_metrics_daily" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "pmd_upd" ON "public"."pipeline_metrics_daily" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."proof_master" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "qual_configs_insert" ON "public"."qualification_configs" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "qual_configs_select" ON "public"."qualification_configs" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "qual_configs_update" ON "public"."qualification_configs" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."qualification_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rc_ins" ON "public"."ref_counters" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "rc_sel" ON "public"."ref_counters" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "rc_upd" ON "public"."ref_counters" FOR UPDATE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."ref_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."secret_references" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sl_ins" ON "public"."sops_laws" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "sl_sel" ON "public"."sops_laws" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "sl_upd" ON "public"."sops_laws" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "sm_del" ON "public"."story_master" FOR DELETE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"]))));



CREATE POLICY "sm_ins" ON "public"."story_master" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "sm_sel" ON "public"."story_master" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "sm_upd" ON "public"."story_master" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."sops_laws" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sr_admin" ON "public"."secret_references" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



ALTER TABLE "public"."story_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_members_admin" ON "public"."team_members" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



CREATE POLICY "team_members_select" ON "public"."team_members" FOR SELECT TO "authenticated" USING ((("public"."auth_role"() = 'admin'::"text") OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_admin_write" ON "public"."users" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



CREATE POLICY "users_self_or_admin" ON "public"."users" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR ("public"."auth_role"() = 'admin'::"text")));



ALTER TABLE "public"."video_project_deliverables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "video_project_deliverables_staff_select" ON "public"."video_project_deliverables" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."video_projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "video_projects_staff_select" ON "public"."video_projects" FOR SELECT TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])));



ALTER TABLE "public"."video_shots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "video_shots_staff_select" ON "public"."video_shots" FOR SELECT TO "authenticated" USING ((("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text", 'editor'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."video_projects" "p"
  WHERE ("p"."id" = "video_shots"."video_project_id")))));



ALTER TABLE "public"."website_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_sequence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wm_ins" ON "public"."website_master" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "wm_sel" ON "public"."website_master" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "wm_upd" ON "public"."website_master" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspaces_admin" ON "public"."workspaces" TO "authenticated" USING (("public"."auth_role"() = 'admin'::"text")) WITH CHECK (("public"."auth_role"() = 'admin'::"text"));



CREATE POLICY "ws_ins" ON "public"."weekly_sequence" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



CREATE POLICY "ws_sel" ON "public"."weekly_sequence" FOR SELECT TO "authenticated" USING (("client_id" = ANY ("public"."auth_client_ids"())));



CREATE POLICY "ws_upd" ON "public"."weekly_sequence" FOR UPDATE TO "authenticated" USING ((("client_id" = ANY ("public"."auth_client_ids"())) AND ("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['admin'::"text", 'account_manager'::"text"])));



GRANT USAGE ON SCHEMA "extensions" TO "anon";
GRANT USAGE ON SCHEMA "extensions" TO "authenticated";
GRANT USAGE ON SCHEMA "extensions" TO "service_role";
GRANT ALL ON SCHEMA "extensions" TO "dashboard_user";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "extensions"."grant_pg_cron_access"() FROM "supabase_admin";
GRANT ALL ON FUNCTION "extensions"."grant_pg_cron_access"() TO "supabase_admin" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."grant_pg_cron_access"() TO "dashboard_user";



GRANT ALL ON FUNCTION "extensions"."grant_pg_graphql_access"() TO "postgres" WITH GRANT OPTION;



REVOKE ALL ON FUNCTION "extensions"."grant_pg_net_access"() FROM "supabase_admin";
GRANT ALL ON FUNCTION "extensions"."grant_pg_net_access"() TO "supabase_admin" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."grant_pg_net_access"() TO "dashboard_user";



GRANT ALL ON FUNCTION "extensions"."pgrst_ddl_watch"() TO "postgres" WITH GRANT OPTION;



GRANT ALL ON FUNCTION "extensions"."pgrst_drop_watch"() TO "postgres" WITH GRANT OPTION;



GRANT ALL ON FUNCTION "extensions"."set_graphql_placeholder"() TO "postgres" WITH GRANT OPTION;



REVOKE ALL ON FUNCTION "public"."_log_distribution_transition"("p_client_id" "uuid", "p_source_ref" "text", "p_record_id" "uuid", "p_action" "text", "p_prev" "text", "p_new" "text", "p_detail" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_log_distribution_transition"("p_client_id" "uuid", "p_source_ref" "text", "p_record_id" "uuid", "p_action" "text", "p_prev" "text", "p_new" "text", "p_detail" "text") TO "service_role";



GRANT ALL ON TABLE "public"."client_asset_group_completeness_overrides" TO "service_role";
GRANT SELECT ON TABLE "public"."client_asset_group_completeness_overrides" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."accept_partial_asset_group"("p_asset_group_ref" "text", "p_generation_job_id" "uuid", "p_reason" "text", "p_accepted_sequence_indexes" integer[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_partial_asset_group"("p_asset_group_ref" "text", "p_generation_job_id" "uuid", "p_reason" "text", "p_accepted_sequence_indexes" integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_partial_asset_group"("p_asset_group_ref" "text", "p_generation_job_id" "uuid", "p_reason" "text", "p_accepted_sequence_indexes" integer[]) TO "service_role";



GRANT ALL ON TABLE "public"."client_asset_group_warning_acknowledgements" TO "service_role";
GRANT SELECT ON TABLE "public"."client_asset_group_warning_acknowledgements" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."acknowledge_asset_group_warning"("p_asset_group_ref" "text", "p_warning_code" "text", "p_warning_fingerprint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acknowledge_asset_group_warning"("p_asset_group_ref" "text", "p_warning_code" "text", "p_warning_fingerprint" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."acknowledge_asset_group_warning"("p_asset_group_ref" "text", "p_warning_code" "text", "p_warning_fingerprint" "text") TO "service_role";



GRANT ALL ON TABLE "public"."client_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."client_assets" TO "service_role";



GRANT ALL ON FUNCTION "public"."activate_asset_version"("p_asset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."activate_asset_version"("p_asset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."allocate_phase3_ref"("p_client_id" "uuid", "p_planned_date" "date", "p_type_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."allocate_phase3_ref"("p_client_id" "uuid", "p_planned_date" "date", "p_type_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_context_patch_draft"("p_patch_draft_id" "uuid", "p_final_content" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_context_patch_draft"("p_patch_draft_id" "uuid", "p_final_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_context_patch_draft"("p_patch_draft_id" "uuid", "p_final_content" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_delete_asset"("p_operation_id" "uuid", "p_asset_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_delete_asset"("p_operation_id" "uuid", "p_asset_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_delete_phase3_content"("p_operation_id" "uuid", "p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_delete_phase3_content"("p_operation_id" "uuid", "p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_reject_asset"("p_operation_id" "uuid", "p_client_id" "uuid", "p_asset_group_ref" "text", "p_brief_id" "uuid", "p_source_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_reject_asset"("p_operation_id" "uuid", "p_client_id" "uuid", "p_asset_group_ref" "text", "p_brief_id" "uuid", "p_source_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_reject_content_brief"("p_operation_id" "uuid", "p_client_id" "uuid", "p_brief_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_reject_content_brief"("p_operation_id" "uuid", "p_client_id" "uuid", "p_brief_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_expected_edit_revision" integer, "p_current_calendar_digest" "text", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_expected_edit_revision" integer, "p_current_calendar_digest" "text", "p_actor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_client_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_client_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_client_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."begin_ideation_calendar_proposal"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_scoring_run_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_scoring_snapshot" "jsonb", "p_slot_manifest" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_slot_planner_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_period_start" "date", "p_period_end" "date", "p_expected_slot_count" integer, "p_maximum_attempts" integer, "p_supersedes_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_ideation_calendar_proposal"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_scoring_run_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_scoring_snapshot" "jsonb", "p_slot_manifest" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_slot_planner_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_period_start" "date", "p_period_end" "date", "p_expected_slot_count" integer, "p_maximum_attempts" integer, "p_supersedes_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."begin_ideation_run"("p_client_id" "uuid", "p_period_type" "text", "p_period_start" "date", "p_period_end" "date", "p_execution_months" "text"[], "p_idempotency_key" "text", "p_input_hash" "text", "p_quantity_plan" "jsonb", "p_configuration_snapshot" "jsonb", "p_techniques" "jsonb", "p_slot_allocation" "jsonb", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_ideation_run"("p_client_id" "uuid", "p_period_type" "text", "p_period_start" "date", "p_period_end" "date", "p_execution_months" "text"[], "p_idempotency_key" "text", "p_input_hash" "text", "p_quantity_plan" "jsonb", "p_configuration_snapshot" "jsonb", "p_techniques" "jsonb", "p_slot_allocation" "jsonb", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."begin_ideation_scoring_run"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_rubric_slug" "text", "p_rubric_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_expected_candidate_count" integer, "p_maximum_attempts" integer, "p_supersedes_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_ideation_scoring_run"("p_client_id" "uuid", "p_ideation_cycle_id" "uuid", "p_idempotency_key" "text", "p_configuration_hash" "text", "p_configuration_snapshot" "jsonb", "p_authority_snapshot" "jsonb", "p_candidate_snapshot" "jsonb", "p_rubric_slug" "text", "p_rubric_version" "text", "p_prompt_digest" "text", "p_provider" "text", "p_model" "text", "p_output_schema_version" "text", "p_module_version" "text", "p_expected_candidate_count" integer, "p_maximum_attempts" integer, "p_supersedes_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer, "p_actor_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."video_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."video_projects" TO "service_role";



REVOKE ALL ON FUNCTION "public"."bind_legacy_reel_project_brief"("p_video_project_id" "uuid", "p_client_production_brief_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bind_legacy_reel_project_brief"("p_video_project_id" "uuid", "p_client_production_brief_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."block_unsupported_scheduled_distribution"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."block_unsupported_scheduled_distribution"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_distribution_record"("p_record_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_distribution_record"("p_record_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_distribution_record"("p_record_id" "uuid") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."client_distribution_records" TO "authenticated";
GRANT ALL ON TABLE "public"."client_distribution_records" TO "service_role";



GRANT UPDATE("planned_publish_date") ON TABLE "public"."client_distribution_records" TO "authenticated";



GRANT UPDATE("destination") ON TABLE "public"."client_distribution_records" TO "authenticated";



GRANT UPDATE("publish_payload") ON TABLE "public"."client_distribution_records" TO "authenticated";



GRANT UPDATE("publish_settings") ON TABLE "public"."client_distribution_records" TO "authenticated";



GRANT UPDATE("updated_at") ON TABLE "public"."client_distribution_records" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."claim_due_distribution_records"("p_worker_id" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_due_distribution_records"("p_worker_id" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."client_asset_generation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."client_asset_generation_items" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_asset_generation_item"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_asset_generation_item"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."client_phase3_scope_items" TO "authenticated";
GRANT ALL ON TABLE "public"."client_phase3_scope_items" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_phase3_scope_item"("p_run_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_phase3_scope_item"("p_run_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_ideation_content"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid", "p_configuration_hash" "text", "p_commit_input_snapshot" "jsonb", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_ideation_content"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid", "p_configuration_hash" "text", "p_commit_input_snapshot" "jsonb", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") TO "service_role";



GRANT ALL ON TABLE "public"."video_project_deliverables" TO "authenticated";
GRANT ALL ON TABLE "public"."video_project_deliverables" TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_verified_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_duration_sec" numeric, "p_metadata_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_verified_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_duration_sec" numeric, "p_metadata_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_warnings" "jsonb", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_warnings" "jsonb", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_research_results" "jsonb", "p_candidates" "jsonb", "p_run_results" "jsonb", "p_provider" "text", "p_model" "text", "p_prompt_version" "text", "p_output_schema_version" "text", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_research_results" "jsonb", "p_candidates" "jsonb", "p_run_results" "jsonb", "p_provider" "text", "p_model" "text", "p_prompt_version" "text", "p_output_schema_version" "text", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_ranks" "jsonb", "p_warnings" "jsonb", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_ranks" "jsonb", "p_warnings" "jsonb", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_performance_analysis_run"("p_run_id" "uuid", "p_records_scored" integer, "p_insights_created" integer, "p_skipped_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_performance_analysis_run"("p_run_id" "uuid", "p_records_scored" integer, "p_insights_created" integer, "p_skipped_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_performance_analysis_run"("p_run_id" "uuid", "p_records_scored" integer, "p_insights_created" integer, "p_skipped_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_ai_background_prompt"("p_client_id" "uuid", "p_production_brief_id" "uuid", "p_source_ref" "text", "p_format" "text", "p_frame_index" integer, "p_operator_notes" "text", "p_prompt_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_ai_background_prompt"("p_client_id" "uuid", "p_production_brief_id" "uuid", "p_source_ref" "text", "p_format" "text", "p_frame_index" integer, "p_operator_notes" "text", "p_prompt_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_ai_background_prompt"("p_client_id" "uuid", "p_production_brief_id" "uuid", "p_source_ref" "text", "p_format" "text", "p_frame_index" integer, "p_operator_notes" "text", "p_prompt_text" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_bound_reel_video_project"("p_client_id" "uuid", "p_source_table" "text", "p_source_row_id" "uuid", "p_client_production_brief_id" "uuid", "p_title" "text", "p_archetype" "text", "p_awareness_stage" "text", "p_target_duration_sec" integer, "p_brand_prompt_block_id" "uuid", "p_created_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_bound_reel_video_project"("p_client_id" "uuid", "p_source_table" "text", "p_source_row_id" "uuid", "p_client_production_brief_id" "uuid", "p_title" "text", "p_archetype" "text", "p_awareness_stage" "text", "p_target_duration_sec" integer, "p_brand_prompt_block_id" "uuid", "p_created_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_context_patch_draft"("p_client_id" "uuid", "p_context_update_proposal_id" "uuid", "p_proposal_item_id" "uuid", "p_target_file_id" "uuid", "p_target_section" "text", "p_patch_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_current_state_summary" "text", "p_proposed_change_summary" "text", "p_proposed_content" "text", "p_proposed_diff" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_context_patch_draft"("p_client_id" "uuid", "p_context_update_proposal_id" "uuid", "p_proposal_item_id" "uuid", "p_target_file_id" "uuid", "p_target_section" "text", "p_patch_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_current_state_summary" "text", "p_proposed_change_summary" "text", "p_proposed_content" "text", "p_proposed_diff" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_context_patch_draft"("p_client_id" "uuid", "p_context_update_proposal_id" "uuid", "p_proposal_item_id" "uuid", "p_target_file_id" "uuid", "p_target_section" "text", "p_patch_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_current_state_summary" "text", "p_proposed_change_summary" "text", "p_proposed_content" "text", "p_proposed_diff" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_context_update_proposal"("p_client_id" "uuid", "p_iteration_candidate_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_proposal_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text", "p_proposal_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_context_update_proposal"("p_client_id" "uuid", "p_iteration_candidate_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_proposal_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text", "p_proposal_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_context_update_proposal"("p_client_id" "uuid", "p_iteration_candidate_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_proposal_type" "text", "p_title" "text", "p_summary" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text", "p_proposal_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_iteration_candidate"("p_client_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_performance_score_id" "uuid", "p_performance_insight_id" "uuid", "p_candidate_type" "text", "p_recommendation" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_iteration_candidate"("p_client_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_performance_score_id" "uuid", "p_performance_insight_id" "uuid", "p_candidate_type" "text", "p_recommendation" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_iteration_candidate"("p_client_id" "uuid", "p_source_ref" "text", "p_distribution_record_id" "uuid", "p_performance_score_id" "uuid", "p_performance_insight_id" "uuid", "p_candidate_type" "text", "p_recommendation" "text", "p_rationale" "text", "p_evidence" "jsonb", "p_confidence" "text", "p_priority" "text", "p_created_from" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_performance_insight"("p_distribution_record_id" "uuid", "p_insight_type" "text", "p_severity" "text", "p_confidence" "text", "p_title" "text", "p_summary" "text", "p_evidence" "jsonb", "p_recommended_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_performance_insight"("p_distribution_record_id" "uuid", "p_insight_type" "text", "p_severity" "text", "p_confidence" "text", "p_title" "text", "p_summary" "text", "p_evidence" "jsonb", "p_recommended_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_performance_insight"("p_distribution_record_id" "uuid", "p_insight_type" "text", "p_severity" "text", "p_confidence" "text", "p_title" "text", "p_summary" "text", "p_evidence" "jsonb", "p_recommended_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_reel_distribution_draft"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_reel_distribution_draft"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb", "p_video_deliverable_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb", "p_video_deliverable_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."distribution_publication_supported"("p_asset_format" "text", "p_publish_settings" "jsonb", "p_publish_payload" "jsonb", "p_video_deliverable_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."edit_ideation_proposal_assignment"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_action" "text", "p_from_slot_key" "text", "p_to_slot_key" "text", "p_candidate_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."edit_ideation_proposal_assignment"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_action" "text", "p_from_slot_key" "text", "p_to_slot_key" "text", "p_candidate_id" "uuid", "p_expected_edit_revision" integer, "p_actor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_distribution_publish_capability"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_distribution_publish_capability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_distribution_publish_capability"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_failure_code" "text", "p_failure_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_ideation_calendar_proposal"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_failure_code" "text", "p_failure_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_ideation_run"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_ideation_scoring_run"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean, "p_warnings" "jsonb", "p_actor_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."client_ai_background_image_generations" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ai_background_image_generations" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."generate_ai_background_image"("p_generation_id" "uuid", "p_client_id" "uuid", "p_image_size" "text", "p_image_quality" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_ai_background_image"("p_generation_id" "uuid", "p_client_id" "uuid", "p_image_size" "text", "p_image_quality" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_ai_background_image"("p_generation_id" "uuid", "p_client_id" "uuid", "p_image_size" "text", "p_image_quality" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_ref"("p_client_id" "uuid", "p_month_code" "text", "p_channel" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_ref"("p_client_id" "uuid", "p_month_code" "text", "p_channel" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ideation_commit_target"("p_asset_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ideation_commit_target"("p_asset_type" "text") TO "service_role";



GRANT ALL ON TABLE "public"."video_shots" TO "authenticated";
GRANT ALL ON TABLE "public"."video_shots" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_reel_storyboard_if_empty"("p_video_project_id" "uuid", "p_client_id" "uuid", "p_client_production_brief_id" "uuid", "p_shots" "jsonb", "p_story_strategy" "jsonb", "p_continuity_plan" "jsonb", "p_provenance" "jsonb", "p_prompt_version" "text", "p_model" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_reel_storyboard_if_empty"("p_video_project_id" "uuid", "p_client_id" "uuid", "p_client_production_brief_id" "uuid", "p_shots" "jsonb", "p_story_strategy" "jsonb", "p_continuity_plan" "jsonb", "p_provenance" "jsonb", "p_prompt_version" "text", "p_model" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_ideation_commit_replay"("p_client_id" "uuid", "p_commit_run_id" "uuid", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_ideation_commit_replay"("p_client_id" "uuid", "p_commit_run_id" "uuid", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."persist_asset_generation_result"("p_generation_job_id" "uuid", "p_generation_item_id" "uuid", "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."persist_asset_generation_result"("p_generation_job_id" "uuid", "p_generation_item_id" "uuid", "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."persist_ideation_proposal_batch"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_assignments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."persist_ideation_proposal_batch"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_assignments" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."persist_ideation_score_batch"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_scores" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."persist_ideation_score_batch"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_scores" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."persist_instagram_insights_collection"("p_run_id" "uuid", "p_distribution_record_id" "uuid", "p_snapshot_label" "text", "p_metrics_requested" "text"[], "p_metrics_collected" "jsonb", "p_unsupported_metrics" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."persist_instagram_insights_collection"("p_run_id" "uuid", "p_distribution_record_id" "uuid", "p_snapshot_label" "text", "p_metrics_requested" "text"[], "p_metrics_collected" "jsonb", "p_unsupported_metrics" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."persist_regenerated_asset_frame"("p_current_asset_id" "uuid", "p_expected_new_version" integer, "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."persist_regenerated_asset_frame"("p_current_asset_id" "uuid", "p_expected_new_version" integer, "p_storage_path" "text", "p_mime_type" "text", "p_width" integer, "p_height" integer, "p_generation_provider" "text", "p_generation_model" "text", "p_prompt_md" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase_ref_is_published"("p_client_id" "uuid", "p_source_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase_ref_is_published"("p_client_id" "uuid", "p_source_ref" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."phase_ref_is_published"("p_client_id" "uuid", "p_source_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_distribution_record"("p_record_id" "uuid", "p_action" "text", "p_external_id" "text", "p_confirm" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_distribution_record"("p_record_id" "uuid", "p_action" "text", "p_external_id" "text", "p_confirm" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_distribution_record"("p_record_id" "uuid", "p_action" "text", "p_external_id" "text", "p_confirm" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_ideation_commit_failure"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_actor_id" "uuid", "p_failure_code" "text", "p_failure_message" "text", "p_failed_proposal_slot_key" "text", "p_configuration_hash" "text", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_ideation_commit_failure"("p_client_id" "uuid", "p_proposal_id" "uuid", "p_actor_id" "uuid", "p_failure_code" "text", "p_failure_message" "text", "p_failed_proposal_slot_key" "text", "p_configuration_hash" "text", "p_calendar_digest" "text", "p_idempotency_key" "text", "p_target_manifest_version" "text", "p_mapping_version" "text", "p_reference_allocator_version" "text", "p_output_schema_version" "text", "p_module_version" "text") TO "service_role";



GRANT ALL ON TABLE "public"."client_ideation_calendar_proposals" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_calendar_proposals" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."recount_ideation_proposal"("p_proposal_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recount_ideation_proposal"("p_proposal_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recover_stale_ai_background_generation"("p_generation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recover_stale_ai_background_generation"("p_generation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recover_stale_ai_background_generation"("p_generation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recover_stale_publishing"("p_older_than" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recover_stale_publishing"("p_older_than" interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."reel_shot_failure_phase"("p_shot" "public"."video_shots") TO "anon";
GRANT ALL ON FUNCTION "public"."reel_shot_failure_phase"("p_shot" "public"."video_shots") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reel_shot_failure_phase"("p_shot" "public"."video_shots") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_ideation_proposal_conflicts"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_conflicts" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_expected_edit_revision" integer, "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_ideation_proposal_conflicts"("p_proposal_id" "uuid", "p_client_id" "uuid", "p_conflicts" "jsonb", "p_calendar_conflict_snapshot" "jsonb", "p_calendar_conflict_digest" "text", "p_expected_edit_revision" integer, "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."regenerate_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_planning" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."regenerate_pending_reel_shot"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_planning" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."renew_ideation_proposal_lease"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."renew_ideation_proposal_lease"("p_proposal_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."renew_ideation_run_lease"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."renew_ideation_run_lease"("p_cycle_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."renew_ideation_scoring_lease"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."renew_ideation_scoring_lease"("p_scoring_run_id" "uuid", "p_lease_owner" "text", "p_lease_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."replace_phase3_master_if_safe"("p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_phase3_master_if_safe"("p_client_id" "uuid", "p_master_table" "text", "p_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."requeue_stale_asset_generation_items"("p_job_id" "uuid", "p_older_than" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."requeue_stale_asset_generation_items"("p_job_id" "uuid", "p_older_than" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_storage_path_prefix" "text", "p_safe_filename" "text", "p_mime_type" "text", "p_file_size_bytes" bigint, "p_original_filename" "text", "p_uploaded_by" "uuid", "p_acknowledge_replace_approved" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_final_reel_upload"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_storage_path_prefix" "text", "p_safe_filename" "text", "p_mime_type" "text", "p_file_size_bytes" bigint, "p_original_filename" "text", "p_uploaded_by" "uuid", "p_acknowledge_replace_approved" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_failed_reel_shot_still"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_failed_reel_shot_still"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_failed_reel_shot_video"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_motion_type" "text", "p_motion_strength" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_failed_reel_shot_video"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_shot_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_motion_type" "text", "p_motion_strength" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."retry_distribution_record"("p_record_id" "uuid", "p_override_permanent" boolean, "p_retry_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."retry_distribution_record"("p_record_id" "uuid", "p_override_permanent" boolean, "p_retry_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."retry_distribution_record"("p_record_id" "uuid", "p_override_permanent" boolean, "p_retry_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_asset_group"("p_client_id" "uuid", "p_asset_group_ref" "text", "p_status" "public"."review_state") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_asset_group"("p_client_id" "uuid", "p_asset_group_ref" "text", "p_status" "public"."review_state") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_asset_group"("p_client_id" "uuid", "p_asset_group_ref" "text", "p_status" "public"."review_state") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_final_reel_deliverable"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_next_status" "text", "p_feedback" "text", "p_reviewed_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_final_reel_deliverable"("p_client_id" "uuid", "p_video_project_id" "uuid", "p_deliverable_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_next_status" "text", "p_feedback" "text", "p_reviewed_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_performance_analysis_for_client"("p_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_performance_analysis_for_client"("p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_performance_analysis_for_client"("p_client_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."schedule_distribution_record"("p_record_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_timezone" "text", "p_planned_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."schedule_distribution_record"("p_record_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_timezone" "text", "p_planned_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."schedule_distribution_record"("p_record_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_timezone" "text", "p_planned_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_ai_background_prompt"("p_generation_id" "uuid", "p_prompt_text" "text", "p_new_status" "text", "p_review_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_ai_background_prompt"("p_generation_id" "uuid", "p_prompt_text" "text", "p_new_status" "text", "p_review_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ai_background_prompt"("p_generation_id" "uuid", "p_prompt_text" "text", "p_new_status" "text", "p_review_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_context_patch_draft_status"("p_patch_draft_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_context_patch_draft_status"("p_patch_draft_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_context_patch_draft_status"("p_patch_draft_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_context_update_proposal_status"("p_proposal_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_context_update_proposal_status"("p_proposal_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_context_update_proposal_status"("p_proposal_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_iteration_candidate_status"("p_candidate_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_iteration_candidate_status"("p_candidate_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_iteration_candidate_status"("p_candidate_id" "uuid", "p_new_status" "text", "p_reviewer_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_performance_insight_status"("p_insight_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_performance_insight_status"("p_insight_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_performance_insight_status"("p_insight_id" "uuid", "p_status" "text") TO "service_role";



GRANT ALL ON TABLE "public"."client_business_signal_snapshots" TO "service_role";
GRANT SELECT ON TABLE "public"."client_business_signal_snapshots" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."upsert_business_signal_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_signal_at" timestamp with time zone, "p_profile_visits" integer, "p_follows" integer, "p_inbound_dms" integer, "p_qualified_dms" integer, "p_conversations" integer, "p_qualified_conversations" integer, "p_appointments" integer, "p_qualified_appointments" integer, "p_show_ups" integer, "p_cash_collected" numeric, "p_operator_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_business_signal_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_signal_at" timestamp with time zone, "p_profile_visits" integer, "p_follows" integer, "p_inbound_dms" integer, "p_qualified_dms" integer, "p_conversations" integer, "p_qualified_conversations" integer, "p_appointments" integer, "p_qualified_appointments" integer, "p_show_ups" integer, "p_cash_collected" numeric, "p_operator_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_business_signal_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_signal_at" timestamp with time zone, "p_profile_visits" integer, "p_follows" integer, "p_inbound_dms" integer, "p_qualified_dms" integer, "p_conversations" integer, "p_qualified_conversations" integer, "p_appointments" integer, "p_qualified_appointments" integer, "p_show_ups" integer, "p_cash_collected" numeric, "p_operator_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_distribution_draft"("p_client_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_asset_group_ref" "text", "p_sequence_index" integer, "p_sequence_count" integer, "p_production_brief_id" "uuid", "p_asset_format" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_distribution_draft"("p_client_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_asset_group_ref" "text", "p_sequence_index" integer, "p_sequence_count" integer, "p_production_brief_id" "uuid", "p_asset_format" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_distribution_draft"("p_client_id" "uuid", "p_execution_month" "text", "p_source_ref" "text", "p_asset_group_ref" "text", "p_sequence_index" integer, "p_sequence_count" integer, "p_production_brief_id" "uuid", "p_asset_format" "text", "p_title" "text", "p_planned_date" "date", "p_publish_payload" "jsonb", "p_publish_settings" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."client_metric_snapshots" TO "service_role";
GRANT SELECT ON TABLE "public"."client_metric_snapshots" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."upsert_manual_metric_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_snapshot_at" timestamp with time zone, "p_snapshot_label" "text", "p_metrics" "jsonb", "p_notes" "text", "p_evidence_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_manual_metric_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_snapshot_at" timestamp with time zone, "p_snapshot_label" "text", "p_metrics" "jsonb", "p_notes" "text", "p_evidence_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_manual_metric_snapshot"("p_distribution_record_id" "uuid", "p_snapshot_id" "uuid", "p_snapshot_at" timestamp with time zone, "p_snapshot_label" "text", "p_metrics" "jsonb", "p_notes" "text", "p_evidence_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_performance_score"("p_distribution_record_id" "uuid", "p_latest_metric_snapshot_id" "uuid", "p_latest_business_signal_snapshot_id" "uuid", "p_score_version" "text", "p_attention" numeric, "p_engagement" numeric, "p_trust" numeric, "p_conversion" numeric, "p_overall" numeric, "p_sample_quality" "text", "p_score_status" "text", "p_score_reasons" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_performance_score"("p_distribution_record_id" "uuid", "p_latest_metric_snapshot_id" "uuid", "p_latest_business_signal_snapshot_id" "uuid", "p_score_version" "text", "p_attention" numeric, "p_engagement" numeric, "p_trust" numeric, "p_conversion" numeric, "p_overall" numeric, "p_sample_quality" "text", "p_score_status" "text", "p_score_reasons" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_performance_score"("p_distribution_record_id" "uuid", "p_latest_metric_snapshot_id" "uuid", "p_latest_business_signal_snapshot_id" "uuid", "p_score_version" "text", "p_attention" numeric, "p_engagement" numeric, "p_trust" numeric, "p_conversion" numeric, "p_overall" numeric, "p_sample_quality" "text", "p_score_status" "text", "p_score_reasons" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."activity_log" TO "anon";
GRANT ALL ON TABLE "public"."activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."ad_creative" TO "anon";
GRANT ALL ON TABLE "public"."ad_creative" TO "authenticated";
GRANT ALL ON TABLE "public"."ad_creative" TO "service_role";



GRANT ALL ON TABLE "public"."ads_master" TO "anon";
GRANT ALL ON TABLE "public"."ads_master" TO "authenticated";
GRANT ALL ON TABLE "public"."ads_master" TO "service_role";



GRANT ALL ON TABLE "public"."asset_brief_index" TO "anon";
GRANT ALL ON TABLE "public"."asset_brief_index" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_brief_index" TO "service_role";



GRANT ALL ON TABLE "public"."asset_master" TO "anon";
GRANT ALL ON TABLE "public"."asset_master" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_master" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."automation_runs" TO "anon";
GRANT ALL ON TABLE "public"."automation_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_runs" TO "service_role";



GRANT ALL ON TABLE "public"."automations" TO "anon";
GRANT ALL ON TABLE "public"."automations" TO "authenticated";
GRANT ALL ON TABLE "public"."automations" TO "service_role";



GRANT ALL ON TABLE "public"."brand_prompt_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_prompt_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_cells" TO "anon";
GRANT ALL ON TABLE "public"."calendar_cells" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_cells" TO "service_role";



GRANT ALL ON TABLE "public"."client_ai_background_image_reviews" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ai_background_image_reviews" TO "authenticated";



GRANT ALL ON TABLE "public"."client_analytics_records" TO "authenticated";
GRANT ALL ON TABLE "public"."client_analytics_records" TO "service_role";



GRANT ALL ON TABLE "public"."client_asset_archive_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."client_asset_archive_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."client_asset_generation_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_asset_generation_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."client_asset_pipeline_state" TO "authenticated";
GRANT ALL ON TABLE "public"."client_asset_pipeline_state" TO "service_role";



GRANT ALL ON TABLE "public"."client_context_files" TO "anon";
GRANT ALL ON TABLE "public"."client_context_files" TO "authenticated";
GRANT ALL ON TABLE "public"."client_context_files" TO "service_role";



GRANT ALL ON TABLE "public"."client_context_patch_applications" TO "service_role";
GRANT SELECT ON TABLE "public"."client_context_patch_applications" TO "authenticated";



GRANT ALL ON TABLE "public"."client_context_patch_drafts" TO "service_role";
GRANT SELECT ON TABLE "public"."client_context_patch_drafts" TO "authenticated";



GRANT ALL ON TABLE "public"."client_context_patch_reviews" TO "service_role";
GRANT SELECT ON TABLE "public"."client_context_patch_reviews" TO "authenticated";



GRANT ALL ON TABLE "public"."client_context_update_proposal_items" TO "service_role";
GRANT SELECT ON TABLE "public"."client_context_update_proposal_items" TO "authenticated";



GRANT ALL ON TABLE "public"."client_context_update_proposals" TO "service_role";
GRANT SELECT ON TABLE "public"."client_context_update_proposals" TO "authenticated";



GRANT ALL ON TABLE "public"."client_context_update_reviews" TO "service_role";
GRANT SELECT ON TABLE "public"."client_context_update_reviews" TO "authenticated";



GRANT ALL ON TABLE "public"."client_destructive_operations" TO "authenticated";
GRANT ALL ON TABLE "public"."client_destructive_operations" TO "service_role";



GRANT ALL ON TABLE "public"."client_distribution_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."client_distribution_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."client_execution_files" TO "anon";
GRANT ALL ON TABLE "public"."client_execution_files" TO "authenticated";
GRANT ALL ON TABLE "public"."client_execution_files" TO "service_role";



GRANT ALL ON TABLE "public"."client_inputs" TO "anon";
GRANT ALL ON TABLE "public"."client_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."organic_master" TO "anon";
GRANT ALL ON TABLE "public"."organic_master" TO "authenticated";
GRANT ALL ON TABLE "public"."organic_master" TO "service_role";



GRANT ALL ON TABLE "public"."proof_master" TO "anon";
GRANT ALL ON TABLE "public"."proof_master" TO "authenticated";
GRANT ALL ON TABLE "public"."proof_master" TO "service_role";



GRANT ALL ON TABLE "public"."story_master" TO "anon";
GRANT ALL ON TABLE "public"."story_master" TO "authenticated";
GRANT ALL ON TABLE "public"."story_master" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."client_health_v" TO "authenticated";
GRANT ALL ON TABLE "public"."client_health_v" TO "service_role";



GRANT ALL ON TABLE "public"."client_ideation_calendar_proposal_slots" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_calendar_proposal_slots" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_candidate_scores" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_candidate_scores" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_candidates" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_candidates" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_commit_items" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_commit_items" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_commit_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_commit_runs" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_cycles" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_cycles" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_research_results" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_research_results" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_scoring_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_scoring_runs" TO "authenticated";



GRANT ALL ON TABLE "public"."client_ideation_technique_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."client_ideation_technique_runs" TO "authenticated";



GRANT ALL ON TABLE "public"."client_insights_collection_attempts" TO "service_role";
GRANT SELECT ON TABLE "public"."client_insights_collection_attempts" TO "authenticated";



GRANT ALL ON TABLE "public"."client_insights_collection_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."client_insights_collection_runs" TO "authenticated";



GRANT ALL ON TABLE "public"."client_iteration_candidates" TO "service_role";
GRANT SELECT ON TABLE "public"."client_iteration_candidates" TO "authenticated";



GRANT ALL ON TABLE "public"."client_iteration_reviews" TO "service_role";
GRANT SELECT ON TABLE "public"."client_iteration_reviews" TO "authenticated";



GRANT ALL ON TABLE "public"."client_performance_analysis_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."client_performance_analysis_runs" TO "authenticated";



GRANT ALL ON TABLE "public"."client_performance_insights" TO "service_role";
GRANT SELECT ON TABLE "public"."client_performance_insights" TO "authenticated";



GRANT ALL ON TABLE "public"."client_performance_scores" TO "service_role";
GRANT SELECT ON TABLE "public"."client_performance_scores" TO "authenticated";



GRANT ALL ON TABLE "public"."client_phase3_scoped_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_phase3_scoped_runs" TO "service_role";



GRANT ALL ON TABLE "public"."client_production_briefs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_production_briefs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."client_publish_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."client_publish_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."client_users" TO "anon";
GRANT ALL ON TABLE "public"."client_users" TO "authenticated";
GRANT ALL ON TABLE "public"."client_users" TO "service_role";



GRANT ALL ON TABLE "public"."contractor_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."contractor_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."contractors" TO "authenticated";
GRANT ALL ON TABLE "public"."contractors" TO "service_role";



GRANT ALL ON TABLE "public"."generation_credits_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."generation_credits_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."lead_magnet_master" TO "anon";
GRANT ALL ON TABLE "public"."lead_magnet_master" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_magnet_master" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_metrics_daily" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_metrics_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_metrics_daily" TO "service_role";



GRANT ALL ON TABLE "public"."playbook_runs" TO "anon";
GRANT ALL ON TABLE "public"."playbook_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."playbook_runs" TO "service_role";



GRANT ALL ON TABLE "public"."playbooks" TO "anon";
GRANT ALL ON TABLE "public"."playbooks" TO "authenticated";
GRANT ALL ON TABLE "public"."playbooks" TO "service_role";



GRANT ALL ON TABLE "public"."qualification_configs" TO "anon";
GRANT ALL ON TABLE "public"."qualification_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."qualification_configs" TO "service_role";



GRANT ALL ON TABLE "public"."ref_counters" TO "anon";
GRANT ALL ON TABLE "public"."ref_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."ref_counters" TO "service_role";



GRANT ALL ON TABLE "public"."secret_references" TO "anon";
GRANT ALL ON TABLE "public"."secret_references" TO "authenticated";
GRANT ALL ON TABLE "public"."secret_references" TO "service_role";



GRANT ALL ON TABLE "public"."sops_laws" TO "anon";
GRANT ALL ON TABLE "public"."sops_laws" TO "authenticated";
GRANT ALL ON TABLE "public"."sops_laws" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."website_master" TO "anon";
GRANT ALL ON TABLE "public"."website_master" TO "authenticated";
GRANT ALL ON TABLE "public"."website_master" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_sequence" TO "anon";
GRANT ALL ON TABLE "public"."weekly_sequence" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_sequence" TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";












ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







