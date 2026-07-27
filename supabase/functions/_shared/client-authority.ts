import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { EXECUTION_FILE_COUNT, EXECUTION_FILE_MANIFEST } from "./execution-manifest.ts";

export const APPROVED_CONTEXT_FILE_COUNT = 21;

// Phase 1 currently persists its client-specific strategic systems in
// client_context_files. Keep their logical authority class distinct even while
// they share that physical table with business-context documents.
export const STRATEGIC_PLAYBOOK_CONTEXT_FILES = [
  { file_number: 6, file_name: "06_Positioning_And_Angle_Map.md" },
  { file_number: 8, file_name: "08_Profile_Funnel_Context.md" },
  { file_number: 9, file_name: "09_Content_System.md" },
  { file_number: 10, file_name: "10_Story_System.md" },
  { file_number: 11, file_name: "11_Ad_System.md" },
  { file_number: 12, file_name: "12_Website_And_Landing_Page_Context.md" },
  { file_number: 13, file_name: "13_Distribution_System.md" },
  { file_number: 14, file_name: "14_Automation_And_AI_Instructions.md" },
  { file_number: 19, file_name: "19_Sales_Enablement_Assets.md" },
  { file_number: 20, file_name: "20_Retention_Upsell_And_Expansion_Context.md" },
] as const;

const STRATEGIC_PLAYBOOK_FILE_NUMBERS = new Set<number>(
  STRATEGIC_PLAYBOOK_CONTEXT_FILES.map((file) => file.file_number),
);

export interface ApprovedContextFile {
  id: string;
  file_number: number;
  file_name: string;
  content_md: string;
  status: "approved";
  version: number;
}

export interface ApprovedStrategicPlaybook extends ApprovedContextFile {
  authority_class: "approved_strategic_playbook";
  storage_table: "client_context_files";
}

export interface ApprovedExecutionFile {
  id: string;
  month: string;
  file_number: number;
  file_name: string;
  content_md: string;
  review_state: "approved";
  version: number;
}

export interface ApprovedClientAuthority {
  client: {
    id: string;
    name: string;
    package_tier: string;
    stage1_status: string;
    stage2_status: string;
  };
  allContextFiles: ApprovedContextFile[];
  contextFiles: ApprovedContextFile[];
  strategicPlaybooks: ApprovedStrategicPlaybook[];
  executionFilesByMonth: Map<string, ApprovedExecutionFile[]>;
}

export type AuthorityLoadResult =
  | { ok: true; authority: ApprovedClientAuthority }
  | {
    ok: false;
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function contextAuthorityReadiness(
  stage1Status: string,
  files: Array<{ file_number: number; content_md: string | null; status: string }>,
) {
  const approved = files.filter((file) => file.status === "approved");
  const numbers = new Set(approved.map((file) => file.file_number));
  const missingFileNumbers = Array.from({ length: APPROVED_CONTEXT_FILE_COUNT }, (_, number) => number)
    .filter((number) => !numbers.has(number));
  const emptyFileNumbers = approved.filter((file) => !nonEmpty(file.content_md)).map((file) => file.file_number);
  return {
    ready: stage1Status === "complete" &&
      approved.length === APPROVED_CONTEXT_FILE_COUNT &&
      missingFileNumbers.length === 0 &&
      emptyFileNumbers.length === 0,
    approved: approved.length,
    missingFileNumbers,
    emptyFileNumbers,
  };
}

export function classifyApprovedPhase1Authority(files: ApprovedContextFile[]): {
  contextFiles: ApprovedContextFile[];
  strategicPlaybooks: ApprovedStrategicPlaybook[];
} {
  const strategicPlaybooks = files
    .filter((file) => STRATEGIC_PLAYBOOK_FILE_NUMBERS.has(file.file_number))
    .map((file) => ({
      ...file,
      authority_class: "approved_strategic_playbook" as const,
      storage_table: "client_context_files" as const,
    }));
  const contextFiles = files.filter((file) => !STRATEGIC_PLAYBOOK_FILE_NUMBERS.has(file.file_number));
  return { contextFiles, strategicPlaybooks };
}

export function executionAuthorityReadiness(
  stage2Status: string,
  month: string,
  files: Array<{
    month: string;
    file_number: number | null;
    file_name: string;
    content_md: string | null;
    review_state: string;
  }>,
) {
  const approved = files.filter((file) => file.month === month && file.review_state === "approved");
  const missing = EXECUTION_FILE_MANIFEST.filter((definition) => !approved.some((file) =>
    file.file_number === definition.fileNumber && file.file_name === definition.fileName
  ));
  const empty = approved.filter((file) => !nonEmpty(file.content_md)).map((file) => file.file_name);
  return {
    ready: stage2Status === "complete" &&
      approved.length === EXECUTION_FILE_COUNT &&
      missing.length === 0 &&
      empty.length === 0,
    approved,
    missingCodes: missing.map((definition) => definition.code),
    empty,
  };
}

export async function loadApprovedClientAuthority(
  sb: SupabaseClient,
  clientId: string,
  executionMonths: string[],
): Promise<AuthorityLoadResult> {
  const [clientResult, contextResult, executionResult] = await Promise.all([
    sb.from("clients")
      .select("id, name, package_tier, stage1_status, stage2_status")
      .eq("id", clientId)
      .maybeSingle(),
    sb.from("client_context_files")
      .select("id, file_number, file_name, content_md, status, version")
      .eq("client_id", clientId)
      .order("file_number"),
    sb.from("client_execution_files")
      .select("id, month, file_number, file_name, content_md, review_state, version")
      .eq("client_id", clientId)
      .in("month", executionMonths)
      .order("month")
      .order("file_number"),
  ]);

  if (clientResult.error || !clientResult.data) {
    return { ok: false, status: 404, code: "CLIENT_NOT_FOUND", message: "Client not found." };
  }
  if (contextResult.error || executionResult.error) {
    return {
      ok: false,
      status: 500,
      code: "AUTHORITY_QUERY_FAILED",
      message: contextResult.error?.message ?? executionResult.error?.message ?? "Authority query failed.",
    };
  }

  const allContext = contextResult.data ?? [];
  const approvedContext = allContext.filter((file) => file.status === "approved");
  const contextReadiness = contextAuthorityReadiness(clientResult.data.stage1_status, allContext);
  if (!contextReadiness.ready) {
    return {
      ok: false,
      status: 409,
      code: "CONTEXT_AUTHORITY_INCOMPLETE",
      message: "Ideation requires all 21 approved, non-empty Context Files.",
      details: {
        stage1_status: clientResult.data.stage1_status,
        approved: contextReadiness.approved,
        missing_file_numbers: contextReadiness.missingFileNumbers,
        empty_file_numbers: contextReadiness.emptyFileNumbers,
      },
    };
  }

  if (clientResult.data.stage2_status !== "complete") {
    return {
      ok: false,
      status: 409,
      code: "EXECUTION_AUTHORITY_INCOMPLETE",
      message: "Ideation requires Phase 2 to be complete.",
      details: { stage2_status: clientResult.data.stage2_status },
    };
  }

  const approvedPhase1Files = approvedContext.map((file) => ({
    ...file,
    content_md: file.content_md as string,
  })) as ApprovedContextFile[];
  const classifiedPhase1 = classifyApprovedPhase1Authority(approvedPhase1Files);
  const missingStrategicPlaybooks = STRATEGIC_PLAYBOOK_CONTEXT_FILES.filter((definition) =>
    !classifiedPhase1.strategicPlaybooks.some((file) =>
      file.file_number === definition.file_number && file.file_name === definition.file_name
    )
  );
  if (missingStrategicPlaybooks.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "STRATEGIC_PLAYBOOK_AUTHORITY_INCOMPLETE",
      message: "Ideation requires the approved Phase 1 strategic playbook authority.",
      details: {
        missing: missingStrategicPlaybooks.map((file) => file.file_name),
        storage_table: "client_context_files",
      },
    };
  }

  const executionFilesByMonth = new Map<string, ApprovedExecutionFile[]>();
  for (const month of executionMonths) {
    const readiness = executionAuthorityReadiness(
      clientResult.data.stage2_status,
      month,
      executionResult.data ?? [],
    );
    const monthRows = readiness.approved;
    if (!readiness.ready) {
      return {
        ok: false,
        status: 409,
        code: "EXECUTION_AUTHORITY_INCOMPLETE",
        message: `Ideation requires all ${EXECUTION_FILE_COUNT} approved, canonical Execution Files for ${month}.`,
        details: {
          month,
          approved: monthRows.length,
          missing: readiness.missingCodes,
          empty: readiness.empty,
        },
      };
    }
    executionFilesByMonth.set(
      month,
      monthRows
        .map((file) => ({ ...file, content_md: file.content_md as string })) as ApprovedExecutionFile[],
    );
  }

  return {
    ok: true,
    authority: {
      client: clientResult.data,
      allContextFiles: approvedPhase1Files,
      contextFiles: classifiedPhase1.contextFiles,
      strategicPlaybooks: classifiedPhase1.strategicPlaybooks,
      executionFilesByMonth,
    },
  };
}

export function boundedAuthorityExcerpt(
  files: Array<{ file_number: number; file_name: string; content_md: string }>,
  wantedNumbers: number[],
  maxChars = 8000,
  perFileChars = 1600,
): { excerpt: string; references: string[] } {
  const wanted = new Set(wantedNumbers);
  const selected = files
    .filter((file) => wanted.has(file.file_number))
    .sort((a, b) => a.file_number - b.file_number);
  const references: string[] = [];
  const sections: string[] = [];
  for (const file of selected) {
    references.push(file.file_name);
    sections.push(`===== APPROVED ${file.file_name} =====\n${file.content_md.trim().slice(0, perFileChars)}`);
  }
  return { excerpt: sections.join("\n\n").slice(0, maxChars), references };
}
