# Lead Score Fix Report

Date: 2026-06-13  
Project ref: `xivewedajschthjlblfb`

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/lead-score/index.ts` | Added provider routing, Anthropic Messages support, strict JSON parsing, explicit method labels, and non-2xx upstream failure handling. |
| `supabase/functions/_shared/aa.ts` | Added the shared helper file required for local `lead-score` redeploy. This mirrors the deployed shared helper used by the existing function set. |

## Provider Route Used

Current `AA_ICP_MODEL` is `claude-haiku-4-5-20251001`, so `lead-score` now routes to Anthropic and reads `_GLOBAL_ANTHROPIC_API_KEY`.

Successful live responses now return:

```text
method: prod:anthropic:claude-haiku-4-5-20251001
stub: false
```

OpenAI routing remains available for non-`claude-` model strings and returns method labels such as:

```text
prod:openai:gpt-5.4-mini
```

## Live Test Inputs

Two synthetic entities were inserted, scored through the deployed Edge Function, and removed afterward.

| Test entity | Summary | HTTP | Score | Band | Method | Stub |
|---|---|---:|---:|---|---|---|
| `TEST_GATE_LeadScore_Good` | Owner-operated roofing business in Cape Town, website, moderate reviews | 200 | 82 | hot | `prod:anthropic:claude-haiku-4-5-20251001` | false |
| `TEST_GATE_LeadScore_Bad` | National software franchise in Johannesburg, not owner-operated, high reviews | 200 | 28 | cold | `prod:anthropic:claude-haiku-4-5-20251001` | false |

Result: the good ICP lead scored meaningfully above zero and above the bad lead; neither response stubbed.

## Non-2xx Failure Handling

The code now checks upstream HTTP status before parsing model output:

```text
Anthropic: if (!resp.ok) throw new UpstreamModelError("anthropic", resp.status, model)
OpenAI:    if (!resp.ok) throw new UpstreamModelError("openai", resp.status, model)
```

The request handler catches `UpstreamModelError` and returns:

```json
{
  "ok": false,
  "error": "upstream_model_error",
  "provider": "anthropic|openai",
  "status": 400,
  "model": "model-name"
}
```

with HTTP 502. It no longer returns `score:0` or a `prod:*` method when the upstream model call fails.

## Cleanup

Cleanup verification returned zero `TEST_GATE_` rows in:

```text
entities
triage_items
agent_events
audit_log
```

## Commands

Redeploy only `lead-score`:

```bash
supabase functions deploy lead-score --project-ref xivewedajschthjlblfb --use-api
```

Rerun the focused live check with two synthetic entities:

```bash
supabase db query --linked "insert into public.entities (kind, stage, business_name, niche, city, notes_signals) values ('prospect','source','TEST_GATE_LeadScore_Good','roofing','Cape Town',jsonb_build_object('owner_operated',true,'has_website',true,'review_count',42,'source','TEST_GATE_LEAD_SCORE_FIX')), ('prospect','source','TEST_GATE_LeadScore_Bad','national software franchise','Johannesburg',jsonb_build_object('owner_operated',false,'has_website',true,'review_count',900,'source','TEST_GATE_LEAD_SCORE_FIX')) returning business_name, id;"
```

Then invoke `lead-score` for the returned ids using the project URL and anon key from `.env`, reporting only HTTP status, score, band, method, stub, and latency.

Cleanup:

```bash
supabase db query --linked "delete from public.triage_items where title like '%TEST_GATE_%' or detail like '%TEST_GATE_%'; delete from public.agent_events where payload::text like '%TEST_GATE_%'; delete from public.audit_log where metadata::text like '%TEST_GATE_%'; delete from public.entities where business_name like 'TEST_GATE_%' or notes_signals::text like '%TEST_GATE_%';"
```

Focused preflight checks to rerun:

```bash
supabase secrets list
supabase db query --linked "select name from vault.secrets where name in ('_GLOBAL_ANTHROPIC_API_KEY','_GLOBAL_OPENAI_API_KEY') order by name;"
supabase functions list
```

Then invoke only:

```text
lead-score
brief-generator
aicos-act
```

and confirm `lead-score` returns `prod:anthropic:claude-haiku-4-5-20251001`, `stub:false`, and no `score:0` fallback on provider errors.
