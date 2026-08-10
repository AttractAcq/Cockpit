import type { ApprovedExecutionFile } from "../client-authority.ts";
import { LEGACY_QUANTITY_SECTION, quantityAuthorityFromCalendar } from "../execution/quantity-authority.ts";
import { IDEATION_QUANTITY_SCHEMA_VERSION } from "./config.ts";

export type IdeationPeriodType = "one_day" | "one_week" | "date_range" | "one_month";
export type IdeationAssetType = "reel" | "carousel" | "static" | "story";

export interface IdeationPeriodInput {
  period_type?: string;
  start_date?: string;
  end_date?: string;
  month?: string;
}

export interface IdeationPeriod {
  periodType: IdeationPeriodType;
  startDate: string;
  endDate: string;
  executionMonths: string[];
}

export interface IdeationMonthlyQuantityPlan {
  month: string;
  weekly_quotas: Record<IdeationAssetType, number>;
  by_asset_type: Record<IdeationAssetType, number>;
  total: number;
  source_file_id: string;
  source_file_name: string;
  source_file_version: number;
  source_section: "Ideation Quantity Contract" | typeof LEGACY_QUANTITY_SECTION;
  authority_mode: "machine_contract" | "legacy_rule_2";
  source_fields: Record<IdeationAssetType, string>;
}

export interface IdeationQuantityPlan {
  total: number;
  by_asset_type: Record<IdeationAssetType, number>;
  cadence_source: "approved_execution_files";
  schema_version: string;
  monthly_plans: IdeationMonthlyQuantityPlan[];
  authority_files: string[];
  slots: IdeationAssetType[];
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERIOD_TYPES = new Set<IdeationPeriodType>(["one_day", "one_week", "date_range", "one_month"]);
const ASSET_TYPES: IdeationAssetType[] = ["reel", "carousel", "static", "story"];
const QUANTITY_FILES = new Set([2, 4, 5]);
const QUANTITY_SECTION_HEADING = "Ideation Quantity Contract";
const QUANTITY_FIELDS: Record<IdeationAssetType, string> = {
  reel: "reel_per_week",
  carousel: "carousel_per_week",
  static: "static_per_week",
  story: "story_per_week",
};
const WEEKDAY_ORDER: Record<IdeationAssetType, number[]> = {
  reel: [1, 2, 4, 6, 0, 3, 5],
  carousel: [3, 5, 1, 4, 2, 6, 0],
  static: [0, 3, 1, 4, 2, 5, 6],
  story: [0, 1, 2, 3, 4, 5, 6],
};

function parseDate(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

export function resolveIdeationPeriod(
  input: IdeationPeriodInput,
  today = new Date(),
): IdeationPeriod {
  const periodType = input.period_type as IdeationPeriodType;
  if (!PERIOD_TYPES.has(periodType)) throw new Error("period_type is not supported.");
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  let start: Date;
  let end: Date;
  if (periodType === "one_day") {
    const requestedStart = input.start_date ? parseDate(input.start_date) : todayUtc;
    if (!requestedStart) throw new Error("start_date must be a valid date.");
    start = requestedStart;
    end = start;
  } else if (periodType === "one_week") {
    const requestedStart = input.start_date ? parseDate(input.start_date) : todayUtc;
    if (!requestedStart) throw new Error("start_date must be a valid date.");
    start = requestedStart;
    end = addDays(start, 6);
  } else if (periodType === "one_month") {
    if (!input.month || !MONTH_RE.test(input.month)) throw new Error("A valid month is required.");
    const [year, month] = input.month.split("-").map(Number);
    start = new Date(Date.UTC(year, month - 1, 1));
    end = new Date(Date.UTC(year, month, 0));
  } else {
    const parsedStart = input.start_date ? parseDate(input.start_date) : null;
    const parsedEnd = input.end_date ? parseDate(input.end_date) : null;
    if (!parsedStart || !parsedEnd || parsedEnd < parsedStart) {
      throw new Error("A valid inclusive start_date and end_date are required.");
    }
    start = parsedStart;
    end = parsedEnd;
  }

  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (dayCount > 31) throw new Error("Ideation periods may contain at most 31 inclusive days.");
  const executionMonths = [...new Set(
    Array.from({ length: dayCount }, (_, index) => iso(addDays(start, index)).slice(0, 7)),
  )];
  return { periodType, startDate: iso(start), endDate: iso(end), executionMonths };
}

interface ParsedQuantityContract {
  weeklyQuotas: Record<IdeationAssetType, number>;
  sourceFile: ApprovedExecutionFile;
  sourceSection: IdeationMonthlyQuantityPlan["source_section"];
  authorityMode: IdeationMonthlyQuantityPlan["authority_mode"];
}

function sectionBodies(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, "\n");
  const heading = /^##[ \t]+Ideation Quantity Contract[ \t]*$/gim;
  const matches = [...normalized.matchAll(heading)];
  return matches.map((match) => {
    const start = (match.index ?? 0) + match[0].length;
    const rest = normalized.slice(start);
    const nextHeading = rest.search(/^##[ \t]+/m);
    return (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim();
  });
}

function parseQuantityContract(month: string, files: ApprovedExecutionFile[]): ParsedQuantityContract {
  const relevantFiles = files.filter((file) => QUANTITY_FILES.has(file.file_number));
  for (const fileNumber of QUANTITY_FILES) {
    const matches = relevantFiles.filter((file) => file.file_number === fileNumber);
    if (matches.length !== 1) {
      throw new Error(`${month} requires exactly one approved E${String(fileNumber).padStart(2, "0")} quantity authority file.`);
    }
  }
  const candidates = relevantFiles
    .flatMap((file) => sectionBodies(file.content_md).map((body) => ({ file, body })));
  if (candidates.length === 0) {
    const calendarFile = relevantFiles.find((file) => file.file_number === 5)!;
    const legacy = quantityAuthorityFromCalendar(calendarFile.content_md);
    if (!legacy.ok) {
      throw new Error(`${month} is missing the exact "## ${QUANTITY_SECTION_HEADING}" authority section, and its approved E05 legacy authority cannot be used: ${legacy.error}`);
    }
    return {
      weeklyQuotas: legacy.weeklyQuotas,
      sourceFile: calendarFile,
      sourceSection: LEGACY_QUANTITY_SECTION,
      authorityMode: "legacy_rule_2",
    };
  }
  if (candidates.length > 1) {
    throw new Error(`${month} contains duplicate Ideation quantity authority sections.`);
  }

  const { file, body } = candidates[0];
  const allowedKeys = new Set(["schema", ...Object.values(QUANTITY_FIELDS)]);
  const values = new Map<string, string>();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("<!--") || line.startsWith("#")) continue;
    const match = line.match(/^([a-z][a-z0-9_]*):[ \t]*(.+)$/);
    if (!match || !allowedKeys.has(match[1])) {
      throw new Error(`${month} has an invalid line in the Ideation quantity authority section: "${line}".`);
    }
    if (values.has(match[1])) {
      throw new Error(`${month} defines ${match[1]} more than once.`);
    }
    values.set(match[1], match[2].trim());
  }
  if (values.get("schema") !== IDEATION_QUANTITY_SCHEMA_VERSION) {
    throw new Error(`${month} requires schema: ${IDEATION_QUANTITY_SCHEMA_VERSION}.`);
  }

  const weeklyQuotas = {} as Record<IdeationAssetType, number>;
  for (const assetType of ASSET_TYPES) {
    const field = QUANTITY_FIELDS[assetType];
    const raw = values.get(field);
    if (raw === undefined || !/^(?:0|[1-9]|1[0-4])$/.test(raw)) {
      throw new Error(`${month} requires one unambiguous integer ${field} between 0 and 14.`);
    }
    weeklyQuotas[assetType] = Number(raw);
  }
  return {
    weeklyQuotas,
    sourceFile: file,
    sourceSection: QUANTITY_SECTION_HEADING,
    authorityMode: "machine_contract",
  };
}

function occurrencesForWeekday(assetType: IdeationAssetType, weeklyCount: number, weekday: number): number {
  const order = WEEKDAY_ORDER[assetType];
  let count = 0;
  for (let index = 0; index < weeklyCount; index += 1) {
    if (order[index % order.length] === weekday) count += 1;
  }
  return count;
}

export function deriveIdeationQuantityPlan(
  period: IdeationPeriod,
  executionFilesByMonth: Map<string, ApprovedExecutionFile[]>,
): IdeationQuantityPlan {
  const contracts = new Map<string, ParsedQuantityContract>();
  for (const month of period.executionMonths) {
    contracts.set(month, parseQuantityContract(month, executionFilesByMonth.get(month) ?? []));
  }

  const monthlyCounters = new Map<string, Record<IdeationAssetType, number>>(
    period.executionMonths.map((month) => [month, { reel: 0, carousel: 0, static: 0, story: 0 }]),
  );
  const slots: IdeationAssetType[] = [];
  const start = new Date(`${period.startDate}T00:00:00.000Z`);
  const end = new Date(`${period.endDate}T00:00:00.000Z`);
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const month = iso(date).slice(0, 7);
    const contract = contracts.get(month);
    const counter = monthlyCounters.get(month);
    if (!contract || !counter) throw new Error(`Quantity authority was not resolved for ${month}.`);
    for (const assetType of ASSET_TYPES) {
      const occurrences = occurrencesForWeekday(assetType, contract.weeklyQuotas[assetType], date.getUTCDay());
      for (let index = 0; index < occurrences; index += 1) {
        slots.push(assetType);
        counter[assetType] += 1;
      }
    }
  }

  const monthlyPlans = period.executionMonths.map((month): IdeationMonthlyQuantityPlan => {
    const contract = contracts.get(month)!;
    const byAssetType = monthlyCounters.get(month)!;
    return {
      month,
      weekly_quotas: contract.weeklyQuotas,
      by_asset_type: byAssetType,
      total: Object.values(byAssetType).reduce((total, count) => total + count, 0),
      source_file_id: contract.sourceFile.id,
      source_file_name: contract.sourceFile.file_name,
      source_file_version: contract.sourceFile.version,
      source_section: contract.sourceSection,
      authority_mode: contract.authorityMode,
      source_fields: QUANTITY_FIELDS,
    };
  });
  const byAssetType: Record<IdeationAssetType, number> = { reel: 0, carousel: 0, static: 0, story: 0 };
  for (const plan of monthlyPlans) {
    for (const assetType of ASSET_TYPES) byAssetType[assetType] += plan.by_asset_type[assetType];
  }
  return {
    total: slots.length,
    by_asset_type: byAssetType,
    cadence_source: "approved_execution_files",
    schema_version: IDEATION_QUANTITY_SCHEMA_VERSION,
    monthly_plans: monthlyPlans,
    authority_files: monthlyPlans.map((plan) => `${plan.month}:${plan.source_file_name}`),
    slots,
  };
}
