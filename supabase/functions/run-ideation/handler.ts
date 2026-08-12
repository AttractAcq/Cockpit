import { toPersistedClaimCardCandidate } from "../_shared/ideation/output.ts";
import {
  IDEATION_MAX_ATTEMPTS,
  IDEATION_MODULE_VERSION,
  IDEATION_OUTPUT_SCHEMA_VERSION,
  IDEATION_PROMPT_VERSION,
  IDEATION_SOURCING_SLUGS,
  IDEATION_TECHNIQUE_MANIFEST,
  IDEATION_TECHNIQUE_SLUGS,
  type IdeationTechniqueSlug,
} from "../_shared/ideation/config.ts";
import { isRetryableIdeationFailure } from "../_shared/ideation/errors.ts";
import {
  resolveIdeationProviderRuntime,
  type IdeationProviderRuntime,
} from "../_shared/ideation/provider-runtime.ts";
import { logIdeationLease } from "../_shared/ideation/telemetry.ts";
import { parseIdeationRequestBody, type IdeationRequestBody } from "../_shared/ideation/request.ts";
import type { IdeationAssetType, IdeationPeriod } from "../_shared/ideation/period.ts";
import type { IdeationEvidenceSource } from "../_shared/ideation/evidence.ts";
import type { SourceKind as IdeationStrategicSourceKind } from "../_shared/ideation/strategic-inputs.ts";
import type {
  TechniqueModuleResult,
  TechniqueResearch,
} from "../_shared/ideation/techniques/types.ts";

const FUNCTION_NAME = "run-ideation";
const PROVIDER = "anthropic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IDEATION_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface RpcError {
  message: string;
}

export interface RpcResult<T = unknown> {
  data: T | null;
  error: RpcError | null;
}

export interface RunBundle {
  run: Record<string, unknown> & {
    id: string;
    status: string;
  };
  technique_runs: Array<Record<string, unknown>>;
  research_results: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>>;
}

export interface IdeationPersistence {
  readonly context?: unknown;
  beginRun(args: Record<string, unknown>): Promise<RpcResult>;
  renewLease(args: Record<string, unknown>): Promise<RpcResult>;
  completeRun(args: Record<string, unknown>): Promise<RpcResult>;
  failRun(args: Record<string, unknown>): Promise<RpcResult>;
  recordIntelligenceConsumption?(args: Record<string, unknown>): Promise<RpcResult>;
  recordAuthorityInputs?(args: Record<string, unknown>): Promise<RpcResult>;
  fetchRunBundle(cycleId: string): Promise<RunBundle>;
}

type AccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; code: string; message: string };

type AuthorityResult =
  | {
    ok: true;
    authority: {
      client: { id: string; name: string };
    };
  }
  | {
    ok: false;
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };

type ModelResult =
  | {
    ok: true;
    candidates: Array<{
      evidence_references?: unknown;
      [key: string]: unknown;
    }>;
    structuredFindings: Record<string, string[]>;
    model: string;
    retried: boolean;
  }
  | {
    ok: false;
    code: string;
    error: string;
    model: string;
    retried: boolean;
    retryable: boolean;
  };

export interface RunIdeationDependencies {
  authorize(authorizationHeader: string | null, clientId: string): Promise<AccessResult>;
  aiConfigured(): boolean;
  createPersistence(): IdeationPersistence;
  loadAuthority(
    persistence: IdeationPersistence,
    clientId: string,
    executionMonths: string[],
  ): Promise<AuthorityResult>;
  resolvePeriod(body: IdeationRequestBody, now: Date): IdeationPeriod;
  deriveQuantityPlan(period: IdeationPeriod, authority: AuthorityResult & { ok: true }): {
    total: number;
    slots: IdeationAssetType[];
    [key: string]: unknown;
  };
  buildAuthoritySnapshot(authority: AuthorityResult & { ok: true }): Promise<Record<string, unknown>>;
  buildConfigurationSnapshot(input: {
    clientId: string;
    clientName: string;
    period: Record<string, unknown>;
    quantityPlan: Record<string, unknown>;
    slotAllocation: Record<string, unknown>;
    authority: Record<string, unknown>;
    selectedModel: string;
  }): Promise<Record<string, unknown>>;
  hashConfiguration(snapshot: Record<string, unknown>): Promise<string>;
  runTechniqueModules(authority: AuthorityResult & { ok: true }): Promise<{
    results: TechniqueModuleResult[];
    failures: Array<{ techniqueNumber: number; techniqueSlug: string; error: string }>;
  }>;
  buildExecutionEvidenceSources(authority: AuthorityResult & { ok: true }): Promise<IdeationEvidenceSource[]>;
  buildStrategicInputEvidenceSources?(
    persistence: IdeationPersistence,
    clientId: string,
    sourceKinds: IdeationStrategicSourceKind[],
  ): Promise<{
    inputs: Array<Record<string, unknown>>;
    evidenceSources: IdeationEvidenceSource[];
    snapshot: Record<string, unknown>;
  }>;
  generateTechniqueCandidates(input: {
    clientName: string;
    techniqueSlug: string;
    techniqueName: string;
    techniqueFocus: string;
    research: TechniqueResearch;
    personaReference: TechniqueResearch;
    formatReference: TechniqueResearch;
    executionSources: IdeationEvidenceSource[];
    assetTypes: IdeationAssetType[];
    telemetry?: {
      cycleId: string;
      techniqueSlug: IdeationTechniqueSlug;
      attemptNumber: number;
    };
  }): Promise<ModelResult>;
  now(): Date;
  randomUUID(): string;
  selectedModel(): string;
}

interface RunResultPayload {
  technique_slug: IdeationTechniqueSlug;
  success: boolean;
  status: string;
  retryable: boolean;
  error_code?: string;
  error_message?: string;
  summary?: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...IDEATION_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .split(/\r?\n/, 1)[0]
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/\b(?:SUPABASE_SERVICE_ROLE_KEY|service[_ -]?role key)\b[^,;]*/gi, "[redacted-service-credential]")
    .replace(/\blease[_ -]?owner\s*[:=]\s*\S+/gi, "lease owner [redacted]")
    .slice(0, 1000);
}

function fail(
  status: number,
  stage: string,
  code: string,
  message: string,
  details?: unknown,
  retryable = isRetryableIdeationFailure(code),
): Response {
  return json({
    ok: false,
    function: FUNCTION_NAME,
    created: false,
    error: { stage, code, message, retryable, details },
    message,
  }, status);
}

function techniqueName(slug: string): string {
  return IDEATION_TECHNIQUE_MANIFEST.find((technique) => technique.slug === slug)?.name ?? slug;
}

function warningsFromBundle(bundle: RunBundle) {
  return bundle.technique_runs
    .filter((run) => Number(run.failed_slots) > 0 || run.status === "failed" || run.status === "shortfall")
    .map((run) => ({
      technique: String(run.technique_slug),
      code: String(run.error_code ?? "TECHNIQUE_SHORTFALL"),
      message: String(run.error_message ?? "Technique did not fill its requested slots."),
      retryable: Boolean(run.retryable),
      requested_slots: Array.isArray(run.requested_slots) ? run.requested_slots.length : 0,
      generated_slots: Number(run.generated_slots ?? 0),
      failed_slots: Number(run.failed_slots ?? 0),
      attempt_count: Number(run.attempt_count ?? 0),
    }));
}

function maximumAttempts(run: Record<string, unknown>): number {
  const snapshot = run.configuration_snapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const policy = (snapshot as Record<string, unknown>).retry_policy;
    if (policy && typeof policy === "object" && !Array.isArray(policy)) {
      const configured = Number((policy as Record<string, unknown>).max_attempts);
      if (Number.isInteger(configured) && configured > 0) return configured;
    }
  }
  return IDEATION_MAX_ATTEMPTS;
}

export function structuredRunFailure(
  bundle: RunBundle,
  warnings = warningsFromBundle(bundle),
) {
  const expected = Number(bundle.run.expected_candidate_count ?? 0);
  const generated = Number(bundle.run.candidate_count ?? bundle.candidates.length);
  const shortfall = Number(bundle.run.shortfall_count ?? Math.max(expected - generated, 0));
  const attempts = Number(bundle.run.attempt_count ?? 0);
  const maximum = maximumAttempts(bundle.run);
  const cycleStatus = String(bundle.run.status ?? "failed");
  const retryAllowed = cycleStatus === "retryable"
    && bundle.run.retryable === true
    && attempts < maximum;
  return {
    cycle_id: bundle.run.id,
    cycle: bundle.run,
    run: bundle.run,
    cycle_status: cycleStatus,
    technique_runs: bundle.technique_runs,
    research_results: bundle.research_results,
    candidates: bundle.candidates,
    warnings,
    failed_techniques: warnings.map((warning) => warning.technique),
    failed_technique_details: warnings,
    expected_total: expected,
    generated_total: generated,
    shortfall,
    expected_candidate_count: expected,
    generated_candidate_count: generated,
    shortfall_count: shortfall,
    attempt_count: attempts,
    maximum_attempts: maximum,
    terminal_reason: cycleStatus === "failed"
      ? String(bundle.run.error_code ?? "IDEATION_RUN_FAILED")
      : null,
    retry_allowed: retryAllowed,
    retryable: retryAllowed,
  };
}

function terminalFallbackBundle(data: unknown, cycleId: string): RunBundle {
  const row = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const nested = row.cycle && typeof row.cycle === "object" && !Array.isArray(row.cycle)
    ? row.cycle as Record<string, unknown>
    : row;
  return {
    run: {
      ...nested,
      id: typeof nested.id === "string" ? nested.id : cycleId,
      status: typeof nested.status === "string" ? nested.status : "failed",
    },
    technique_runs: [],
    research_results: [],
    candidates: [],
  };
}

function buildSlotAllocation(slots: IdeationAssetType[]): Record<IdeationTechniqueSlug, IdeationAssetType[]> {
  const allocation = Object.fromEntries(
    IDEATION_TECHNIQUE_SLUGS.map((slug) => [slug, [] as IdeationAssetType[]]),
  ) as Record<IdeationTechniqueSlug, IdeationAssetType[]>;
  slots.forEach((assetType, index) => {
    const slug = IDEATION_SOURCING_SLUGS[index % IDEATION_SOURCING_SLUGS.length];
    allocation[slug].push(assetType);
  });
  return allocation;
}

async function renewLease(
  persistence: IdeationPersistence,
  cycleId: string,
  leaseOwner: string,
  leaseSeconds: number,
) {
  const result = await persistence.renewLease({
    p_cycle_id: cycleId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: leaseSeconds,
  });
  if (result.error) throw new Error(`LEASE_HEARTBEAT_FAILED: ${result.error.message}`);
}

/**
 * Keeps the cycle lease alive across provider calls that may now run for the
 * whole configured technique deadline. The heartbeat only extends ownership —
 * it never grants it. Loss is recorded and re-raised by the caller so a worker
 * that lost its lease during a slow response can never persist results.
 */
function startLeaseHeartbeat(
  persistence: IdeationPersistence,
  cycleId: string,
  leaseOwner: string,
  runtime: IdeationProviderRuntime,
): { stop(): void; failure(): Error | null } {
  const startedAt = Date.now();
  let failure: Error | null = null;
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight || failure) return;
    inFlight = true;
    void persistence.renewLease({
      p_cycle_id: cycleId,
      p_lease_owner: leaseOwner,
      p_lease_seconds: runtime.lease_seconds,
    }).then((result) => {
      if (result.error) {
        failure = new Error(`LEASE_HEARTBEAT_FAILED: ${result.error.message}`);
      }
      logIdeationLease({
        cycle_id: cycleId,
        event: result.error ? "heartbeat_failed" : "heartbeat_ok",
        elapsed_ms: Date.now() - startedAt,
        lease_seconds: runtime.lease_seconds,
        heartbeat_interval_ms: runtime.heartbeat_interval_ms,
      });
    }).catch((error: unknown) => {
      failure = error instanceof Error ? error : new Error(String(error));
    }).finally(() => {
      inFlight = false;
    });
  }, runtime.heartbeat_interval_ms);
  // Never hold the runtime open on the heartbeat alone.
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    stop: () => clearInterval(timer),
    failure: () => failure,
  };
}

function evidenceReferences(candidates: Array<{ evidence_references?: unknown }>): unknown[] {
  return candidates.flatMap((candidate) =>
    Array.isArray(candidate.evidence_references) ? candidate.evidence_references : []
  );
}

export function createRunIdeationHandler(deps: RunIdeationDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: IDEATION_CORS_HEADERS });
    if (req.method !== "POST") return fail(405, "request", "METHOD_NOT_ALLOWED", "POST only.");

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return fail(400, "request", "INVALID_JSON", "A valid JSON request body is required.");
    }
    const parsedBody = parseIdeationRequestBody(rawBody);
    if (!parsedBody.ok) return fail(400, "request", parsedBody.code, parsedBody.message);
    const body = parsedBody.body;
    const clientId = body.client_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "CLIENT_ID_REQUIRED", "client_id is required.");
    if (!UUID_PATTERN.test(clientId)) {
      return fail(400, "request", "CLIENT_ID_INVALID", "client_id must be a valid UUID.");
    }

    const access = await deps.authorize(req.headers.get("Authorization"), clientId);
    if (!access.ok) return fail(access.status, "authorization", access.code, access.message);

    let period: IdeationPeriod;
    try {
      period = deps.resolvePeriod(body, deps.now());
    } catch (error) {
      return fail(400, "period", "INVALID_PERIOD", safeMessage(error));
    }

    const idempotencyKey = body.idempotency_key?.trim() || deps.randomUUID();
    if (idempotencyKey.length > 128) {
      return fail(400, "request", "INVALID_IDEMPOTENCY_KEY", "idempotency_key may contain at most 128 characters.");
    }
    if (!deps.aiConfigured()) {
      return fail(
        503,
        "configuration",
        "ANTHROPIC_NOT_CONFIGURED",
        "Server-side Anthropic generation is not configured.",
        undefined,
        false,
      );
    }

    // Service-role-backed persistence is created only after caller
    // authentication, role validation, and caller-scoped client authorization.
    const persistence = deps.createPersistence();
    const authorityResult = await deps.loadAuthority(persistence, clientId, period.executionMonths);
    if (!authorityResult.ok) {
      return fail(
        authorityResult.status,
        "authority",
        authorityResult.code,
        authorityResult.message,
        authorityResult.details,
        false,
      );
    }
    const authority = authorityResult;
    const techniqueManifest = IDEATION_TECHNIQUE_MANIFEST.map((technique) => ({ ...technique }));

    let quantityPlan;
    try {
      quantityPlan = deps.deriveQuantityPlan(period, authority);
    } catch (error) {
      return fail(409, "quantity", "QUANTITY_AUTHORITY_INVALID", safeMessage(error), undefined, false);
    }
    if (quantityPlan.total < 1) {
      return fail(
        409,
        "quantity",
        "NO_IDEATION_SLOTS",
        "The approved quantity contract has no Ideation slots in this period.",
        undefined,
        false,
      );
    }

    const selectedModel = deps.selectedModel();
    // Resolved once per request so the lease written to the database and the
    // deadline the provider calls run under can never disagree.
    const providerRuntime = resolveIdeationProviderRuntime();
    const slotAllocation = buildSlotAllocation(quantityPlan.slots);
    const authoritySnapshot = await deps.buildAuthoritySnapshot(authority);
    const strategicInputs = deps.buildStrategicInputEvidenceSources
      ? await deps.buildStrategicInputEvidenceSources(
        persistence,
        clientId,
        parsedBody.body.strategic_input_sources ?? ["campaign_intelligence", "main_offer", "seasonal_offer"],
      )
      : { inputs: [], evidenceSources: [], snapshot: { policy: "not_configured", selected_source_kinds: [], counts: {} } };
    const configurationSnapshot = await deps.buildConfigurationSnapshot({
      clientId,
      clientName: authority.authority.client.name,
      period: period as unknown as Record<string, unknown>,
      quantityPlan: quantityPlan as Record<string, unknown>,
      slotAllocation,
      authority: {
        ...authoritySnapshot,
        ideation_hub_inputs: strategicInputs.snapshot,
      },
      selectedModel,
    });
    const inputHash = await deps.hashConfiguration(configurationSnapshot);
    const leaseOwner = deps.randomUUID();
    const begin = await persistence.beginRun({
      p_client_id: clientId,
      p_period_type: period.periodType,
      p_period_start: period.startDate,
      p_period_end: period.endDate,
      p_execution_months: period.executionMonths,
      p_idempotency_key: idempotencyKey,
      p_input_hash: inputHash,
      p_quantity_plan: quantityPlan,
      p_configuration_snapshot: configurationSnapshot,
      p_techniques: techniqueManifest,
      p_slot_allocation: slotAllocation,
      p_lease_owner: leaseOwner,
      p_lease_seconds: providerRuntime.lease_seconds,
      p_actor_id: access.userId,
    });
    if (begin.error) {
      const conflict = begin.error.message.includes("IDEMPOTENCY_CONFLICT");
      return fail(
        conflict ? 409 : 500,
        "begin_run",
        conflict ? "IDEMPOTENCY_CONFLICT" : "BEGIN_RUN_FAILED",
        conflict
          ? "This idempotency key was already used with different configuration."
          : safeMessage(begin.error.message),
      );
    }
    const beginData = begin.data as {
      created: boolean;
      reclaimed: boolean;
      attempts_exhausted?: boolean;
      cycle: { id: string; status: string; attempt_count: number };
    };
    if (!beginData.created) {
      if (beginData.cycle.status === "running") {
        return fail(409, "begin_run", "RUN_IN_PROGRESS", "This Ideation run has an active lease.", undefined, false);
      }
      let bundle: RunBundle;
      try {
        bundle = await persistence.fetchRunBundle(beginData.cycle.id);
      } catch (error) {
        return fail(
          500,
          "read_persisted_run",
          "RUN_COMMITTED_READ_FAILED",
          safeMessage(error),
          { cycle_id: beginData.cycle.id },
        );
      }
      if (bundle.run.status === "failed") {
        const code = String(bundle.run.error_code ?? (
          beginData.attempts_exhausted ? "IDEATION_ATTEMPTS_EXHAUSTED" : "IDEATION_RUN_FAILED"
        ));
        return fail(
          409,
          "begin_run",
          code,
          String(bundle.run.error_message ?? "The persisted Ideation run is terminal."),
          structuredRunFailure(bundle),
          false,
        );
      }
      return json({
        ok: true,
        function: FUNCTION_NAME,
        created: false,
        idempotent_replay: true,
        ...bundle,
        warnings: [],
      });
    }
    const cycleId = beginData.cycle.id;

    try {
      if (persistence.recordAuthorityInputs && strategicInputs.inputs.length > 0) {
        const authorityInputResult = await persistence.recordAuthorityInputs({
          p_cycle_id: cycleId,
          p_client_id: clientId,
          p_inputs: strategicInputs.inputs,
        });
        if (authorityInputResult.error) {
          throw new Error(`Ideation authority input transaction failed: ${authorityInputResult.error.message}`);
        }
      }
      if (persistence.recordIntelligenceConsumption) {
        const consumption = await persistence.recordIntelligenceConsumption({
          p_client_id: clientId,
          p_consumer_type: "ideation_cycle",
          p_consumer_key: cycleId,
          p_purpose: "ideation_generation",
          p_required_domains: ["market_os", "avatar_os", "competitor_os", "association_os", "brand_strategist"],
          p_expected_authority: authoritySnapshot.intelligence ?? {},
        });
        if (consumption.error) {
          throw new Error(`Intelligence consumption could not be recorded: ${safeMessage(consumption.error.message)}`);
        }
      }
      const existing = await persistence.fetchRunBundle(cycleId);
      const persistedRunsBySlug = new Map(
        existing.technique_runs.map((run) => [run.technique_slug as IdeationTechniqueSlug, run]),
      );
      const modules = await deps.runTechniqueModules(authority);
      const bySlug = new Map(modules.results.map((result) => [result.techniqueSlug, result]));
      const persona = bySlug.get("persona")?.research;
      const format = bySlug.get("format-swipe")?.research;
      if (!persona || !format) throw new Error("Standing Persona and Format Swipe references are required.");
      const executionSources = [
        ...await deps.buildExecutionEvidenceSources(authority),
        ...strategicInputs.evidenceSources,
      ];
      await renewLease(persistence, cycleId, leaseOwner, providerRuntime.lease_seconds);

      const existingBySlug = new Map<IdeationTechniqueSlug, Array<Record<string, unknown>>>();
      for (const slug of IDEATION_TECHNIQUE_SLUGS) existingBySlug.set(slug, []);
      for (const candidate of existing.candidates) {
        const technique = candidate.technique as { slug?: string } | null;
        if (technique?.slug && existingBySlug.has(technique.slug as IdeationTechniqueSlug)) {
          existingBySlug.get(technique.slug as IdeationTechniqueSlug)!.push(candidate);
        }
      }

      const attemptNumber = Number(beginData.cycle.attempt_count ?? 1);
      const heartbeat = startLeaseHeartbeat(persistence, cycleId, leaseOwner, providerRuntime);
      let generated: Array<{
        slug: typeof IDEATION_SOURCING_SLUGS[number];
        module: TechniqueModuleResult | undefined;
        missing: Array<{ assetType: IdeationAssetType; candidateIndex: number }>;
        result: ModelResult;
      }>;
      try {
        generated = await Promise.all(IDEATION_SOURCING_SLUGS.map(async (slug) => {
          const module = bySlug.get(slug);
          const requested = slotAllocation[slug];
          const existingCandidates = existingBySlug.get(slug) ?? [];
          const existingIndexes = new Set(existingCandidates.map((candidate) => Number(candidate.candidate_index)));
          const missing = requested
            .map((assetType, candidateIndex) => ({ assetType, candidateIndex }))
            .filter((slot) => !existingIndexes.has(slot.candidateIndex));
          const persistedRun = persistedRunsBySlug.get(slug);
          if (missing.length > 0 && persistedRun?.status !== "running") {
            return {
              slug,
              module,
              missing,
              result: {
                ok: false as const,
                code: String(persistedRun?.error_code ?? "TECHNIQUE_NOT_RETRYABLE"),
                error: String(persistedRun?.error_message ?? "Technique is not eligible for regeneration."),
                model: selectedModel,
                retried: false,
                retryable: false,
              },
            };
          }
          if (!module?.research) {
            return {
              slug,
              module,
              missing,
              result: {
                ok: false as const,
                code: "TECHNIQUE_MODULE_FAILED",
                error: modules.failures.find((failure) => failure.techniqueSlug === slug)?.error
                  ?? "Technique research is unavailable.",
                model: selectedModel,
                retried: false,
                retryable: false,
              },
            };
          }
          if (missing.length === 0) {
            return {
              slug,
              module,
              missing,
              result: {
                ok: true as const,
                candidates: [],
                structuredFindings: {},
                model: selectedModel,
                retried: false,
              },
            };
          }
          const result = await deps.generateTechniqueCandidates({
            clientName: authority.authority.client.name,
            techniqueSlug: slug,
            techniqueName: techniqueName(slug),
            techniqueFocus: module.message,
            research: module.research,
            personaReference: persona,
            formatReference: format,
            executionSources,
            assetTypes: missing.map((slot) => slot.assetType),
            telemetry: { cycleId, techniqueSlug: slug, attemptNumber },
          });
          return { slug, module, missing, result };
        }));
      } finally {
        heartbeat.stop();
      }
      const heartbeatFailure = heartbeat.failure();
      if (heartbeatFailure) throw heartbeatFailure;
      // Ownership is re-checked against the database before anything generated
      // during a long provider response can be persisted.
      await renewLease(persistence, cycleId, leaseOwner, providerRuntime.lease_seconds);
      logIdeationLease({
        cycle_id: cycleId,
        event: "ownership_checked",
        elapsed_ms: 0,
        lease_seconds: providerRuntime.lease_seconds,
        heartbeat_interval_ms: providerRuntime.heartbeat_interval_ms,
      });

      const generatedBySlug = new Map(generated.map((item) => [item.slug, item]));
      const existingResearchKeys = new Set(
        (existing.research_results as Array<{ research_key?: string }>).map((research) => research.research_key),
      );
      const researchResults = modules.results
        .filter((result): result is TechniqueModuleResult & { research: TechniqueResearch } => Boolean(result.research))
        .filter((result) => {
          if (!existingResearchKeys.has(result.research.researchKey)) return true;
          const generation = generatedBySlug.get(result.techniqueSlug as typeof IDEATION_SOURCING_SLUGS[number]);
          return Boolean(generation?.result.ok && generation.result.candidates.length > 0);
        })
        .map((result) => {
          const generation = generatedBySlug.get(result.techniqueSlug as typeof IDEATION_SOURCING_SLUGS[number]);
          const analyzedAt = generation?.result.ok && generation.result.candidates.length
            ? deps.now().toISOString()
            : null;
          return {
            research_key: result.research.researchKey,
            technique_slug: result.techniqueSlug,
            source_identifier: result.research.sourceIdentifier,
            source_type: result.research.sourceType,
            source_url: result.research.sourceUrl,
            source_title: result.research.sourceTitle,
            source_excerpt: result.research.sourceExcerpt,
            source_provider: result.research.sourceProvider,
            retrieved_at: result.research.retrievedAt,
            content_hash: result.research.contentHash,
            status: result.research.status,
            source_findings: result.research.structuredFindings,
            analysis_provider: analyzedAt ? PROVIDER : null,
            analysis_model: analyzedAt ? generation!.result.model : null,
            analysis_prompt_version: analyzedAt ? IDEATION_PROMPT_VERSION : null,
            analysis_output_schema_version: analyzedAt ? IDEATION_OUTPUT_SCHEMA_VERSION : null,
            analyzed_at: analyzedAt,
            analysis_findings: generation?.result.ok ? generation.result.structuredFindings : {},
            analysis_source_references: generation?.result.ok
              ? evidenceReferences(generation.result.candidates.map(toPersistedClaimCardCandidate))
              : [],
          };
        });

      const candidatePayload: Array<Record<string, unknown>> = [];
      for (const item of generated) {
        if (!item.result.ok) continue;
        item.result.candidates.forEach((claimFirst, localIndex) => {
          const slot = item.missing[localIndex];
          // The persisted shape is unchanged: five strings plus
          // evidence_references. Claim-first structure travels as provenance.
          const { claim_card_provenance, ...candidate } = toPersistedClaimCardCandidate(claimFirst);
          candidatePayload.push({
            technique_slug: item.slug,
            research_key: item.module!.research!.researchKey,
            candidate_index: slot.candidateIndex,
            ...candidate,
            draft_payload: {
              ...candidate,
              ...claim_card_provenance,
              technique_number: IDEATION_TECHNIQUE_SLUGS.indexOf(item.slug) + 1,
              output_schema_version: IDEATION_OUTPUT_SCHEMA_VERSION,
              module_version: IDEATION_MODULE_VERSION,
            },
          });
        });
      }

      const runResults: RunResultPayload[] = IDEATION_TECHNIQUE_SLUGS.map((slug) => {
        const requestedCount = slotAllocation[slug].length;
        const existingCount = (existingBySlug.get(slug) ?? []).length;
        const generation = generatedBySlug.get(slug as typeof IDEATION_SOURCING_SLUGS[number]);
        const generatedCount = generation?.result.ok ? generation.result.candidates.length : 0;
        const totalCount = existingCount + generatedCount;
        const moduleFailure = modules.failures.find((failure) => failure.techniqueSlug === slug);
        if (requestedCount > totalCount) {
          return {
            technique_slug: slug,
            success: false,
            status: "shortfall",
            retryable: generation?.result.ok ? false : generation?.result.retryable ?? false,
            error_code: generation?.result.ok
              ? "TECHNIQUE_SHORTFALL"
              : generation?.result.code ?? (moduleFailure ? "TECHNIQUE_MODULE_FAILED" : "TECHNIQUE_SHORTFALL"),
            error_message: generation?.result.ok
              ? `Technique generated ${totalCount} of ${requestedCount} requested slots.`
              : safeMessage(
                generation?.result.error
                  ?? moduleFailure?.error
                  ?? "Technique did not fill its requested slots.",
              ),
            summary: { requested_slots: requestedCount, generated_slots: totalCount },
          };
        }
        const module = bySlug.get(slug);
        return {
          technique_slug: slug,
          success: true,
          status: module?.state ?? "complete",
          retryable: false,
          summary: {
            state: module?.state ?? "complete",
            message: module?.message ?? null,
            requested_slots: requestedCount,
            generated_slots: totalCount,
            retried: generation?.result.ok ? generation.result.retried : false,
          },
        };
      });

      const complete = await persistence.completeRun({
        p_cycle_id: cycleId,
        p_lease_owner: leaseOwner,
        p_research_results: researchResults,
        p_candidates: candidatePayload,
        p_run_results: runResults,
        p_provider: PROVIDER,
        p_model: selectedModel,
        p_prompt_version: IDEATION_PROMPT_VERSION,
        p_output_schema_version: IDEATION_OUTPUT_SCHEMA_VERSION,
        p_actor_id: access.userId,
      });
      if (complete.error) throw new Error(`Ideation completion transaction failed: ${complete.error.message}`);

      let bundle: RunBundle;
      try {
        bundle = await persistence.fetchRunBundle(cycleId);
      } catch (error) {
        return fail(
          500,
          "read_committed_run",
          "RUN_COMMITTED_READ_FAILED",
          safeMessage(error),
          { cycle_id: cycleId },
        );
      }
      const warnings = runResults.filter((result) => !result.success).map((result) => ({
        technique: result.technique_slug,
        code: result.error_code ?? "TECHNIQUE_SHORTFALL",
        message: result.error_message ?? "Technique did not fill its requested slots.",
        retryable: result.retryable,
        requested_slots: Number(result.summary?.requested_slots ?? 0),
        generated_slots: Number(result.summary?.generated_slots ?? 0),
        failed_slots: Math.max(
          Number(result.summary?.requested_slots ?? 0) - Number(result.summary?.generated_slots ?? 0),
          0,
        ),
        attempt_count: Number(bundle.run.attempt_count ?? 0),
      }));
      if (bundle.run.status === "failed") {
        const firstFailure = warnings[0];
        return fail(
          firstFailure?.code === "ANTHROPIC_TIMEOUT" || firstFailure?.code === "ANTHROPIC_CONNECT_TIMEOUT"
            ? 504
            : 502,
          "generation",
          firstFailure?.code ?? "NO_CANDIDATES",
          firstFailure?.message ?? "No candidates were generated.",
          structuredRunFailure(bundle, warnings),
          false,
        );
      }
      return json({
        ok: true,
        function: FUNCTION_NAME,
        created: !beginData.reclaimed,
        idempotent_replay: false,
        reclaimed: beginData.reclaimed,
        ...bundle,
        warnings,
      }, bundle.run.status === "retryable" ? 202 : beginData.reclaimed ? 200 : 201);
    } catch (error) {
      const originalMessage = safeMessage(error);
      const terminal = await persistence.failRun({
        p_cycle_id: cycleId,
        p_lease_owner: leaseOwner,
        p_error_code: "IDEATION_ORCHESTRATION_FAILED",
        p_error_message: originalMessage,
        p_actor_id: access.userId,
      });
      if (terminal.error) {
        const leaseLost = terminal.error.message.includes("LEASE_OWNERSHIP_LOST");
        return fail(
          leaseLost ? 409 : 500,
          "terminal_state",
          leaseLost ? "LEASE_OWNERSHIP_LOST" : "TERMINAL_STATE_PERSISTENCE_FAILED",
          safeMessage(terminal.error.message),
          { cycle_id: cycleId, original_error: originalMessage },
          false,
        );
      }

      try {
        const bundle = await persistence.fetchRunBundle(cycleId);
        return fail(
          500,
          "orchestration",
          "IDEATION_ORCHESTRATION_FAILED",
          originalMessage,
          structuredRunFailure(bundle),
          false,
        );
      } catch (refreshError) {
        const fallback = structuredRunFailure(terminalFallbackBundle(terminal.data, cycleId));
        return fail(
          500,
          "orchestration",
          "IDEATION_ORCHESTRATION_FAILED",
          originalMessage,
          {
            ...fallback,
            state_refresh_failed: true,
            state_refresh_error: safeMessage(refreshError),
          },
          false,
        );
      }
    }
  };
}
