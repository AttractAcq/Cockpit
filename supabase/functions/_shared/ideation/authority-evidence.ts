import type {
  ApprovedClientAuthority,
  ApprovedContextFile,
  ApprovedExecutionFile,
  ApprovedStrategicPlaybook,
} from "../client-authority.ts";
import { createEvidenceSource, type IdeationEvidenceSource } from "./evidence.ts";
import { sha256 } from "./hash.ts";
import { IDEATION_EXECUTION_FILE_NUMBERS } from "./config.ts";

function authorityRowSnapshot(
  file: ApprovedContextFile | ApprovedStrategicPlaybook | ApprovedExecutionFile,
  contentHash: string,
) {
  return {
    id: file.id,
    file_number: file.file_number,
    file_name: file.file_name,
    version: file.version,
    content_hash: contentHash,
  };
}

export async function buildExecutionEvidenceSources(
  authority: ApprovedClientAuthority,
): Promise<IdeationEvidenceSource[]> {
  const files = [...authority.executionFilesByMonth.values()]
    .flat()
    .filter((file) => (IDEATION_EXECUTION_FILE_NUMBERS as readonly number[]).includes(file.file_number))
    .sort((left, right) => left.month.localeCompare(right.month) || left.file_number - right.file_number);
  return await Promise.all(files.map((file) => createEvidenceSource({
    sourceId: `execution:${file.id}:v${file.version}`,
    sourceRef: `${file.month}:${file.file_name}`,
    sourceType: "approved_execution",
    sourceUrl: `aa-authority://client/${authority.client.id}/execution/${file.id}`,
    excerpt: file.content_md,
  })));
}

export async function buildAuthorityConfigurationSnapshot(authority: ApprovedClientAuthority) {
  const context = await Promise.all(authority.contextFiles
    .slice()
    .sort((left, right) => left.file_number - right.file_number)
    .map(async (file) => authorityRowSnapshot(file, await sha256(file.content_md))));
  const strategicPlaybooks = await Promise.all(authority.strategicPlaybooks
    .slice()
    .sort((left, right) => left.file_number - right.file_number)
    .map(async (file) => ({
      ...authorityRowSnapshot(file, await sha256(file.content_md)),
      authority_class: file.authority_class,
      storage_table: file.storage_table,
    })));
  const execution = await Promise.all([...authority.executionFilesByMonth.values()]
    .flat()
    .sort((left, right) => left.month.localeCompare(right.month) || left.file_number - right.file_number)
    .map(async (file) => ({
      month: file.month,
      ...authorityRowSnapshot(file, await sha256(file.content_md)),
    })));
  return {
    context,
    strategic_playbooks: strategicPlaybooks,
    execution,
  };
}
