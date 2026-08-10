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

export async function buildIntelligenceEvidenceSources(
  authority: ApprovedClientAuthority,
): Promise<IdeationEvidenceSource[]> {
  return await Promise.all(authority.intelligenceReleases.map((release) => createEvidenceSource({
    sourceId: `intelligence:${release.intelligence_domain}:${release.id}:v${release.version}`,
    sourceRef: `${release.intelligence_domain}:v${release.version}`,
    sourceType: "approved_intelligence",
    sourceUrl: `aa-authority://client/${authority.client.id}/intelligence/${release.id}`,
    excerpt: [
      `${release.title}: ${release.summary}`,
      ...release.records.map((record) =>
        `[${record.record_type}/${record.record_key}] ${record.title}: ${record.summary}`
      ),
    ].join("\n"),
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
  const intelligence = Object.fromEntries(await Promise.all(authority.intelligenceReleases.map(async (release) => {
    const contentHash = await sha256(JSON.stringify({
      title: release.title,
      summary: release.summary,
      records: release.records.map((record) => ({
        record_type: record.record_type,
        record_key: record.record_key,
        title: record.title,
        summary: record.summary,
        payload: record.payload,
      })),
    }));
    return [release.intelligence_domain, {
      release_id: release.id,
      version: release.version,
      approved_at: release.approved_at,
      freshness: release.freshness,
      content_hash: contentHash,
    }];
  })));
  return {
    context,
    strategic_playbooks: strategicPlaybooks,
    execution,
    intelligence,
  };
}
