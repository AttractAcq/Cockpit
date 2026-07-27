import type { ApprovedClientAuthority } from "../../client-authority.ts";
import { IDEATION_TECHNIQUE_SLUGS } from "../config.ts";
import { runTechnique1 } from "./technique-1.ts";
import { runTechnique2 } from "./technique-2.ts";
import { runTechnique3 } from "./technique-3.ts";
import { runTechnique4 } from "./technique-4.ts";
import { runTechnique5 } from "./technique-5.ts";
import { runTechnique6 } from "./technique-6.ts";
import { runTechnique7 } from "./technique-7.ts";
import type { TechniqueModuleResult } from "./types.ts";

const MODULES = [
  runTechnique1,
  runTechnique2,
  runTechnique3,
  runTechnique4,
  runTechnique5,
  runTechnique6,
  runTechnique7,
];

export interface TechniqueFailure {
  techniqueNumber: number;
  techniqueSlug: string;
  error: string;
}

export async function runAllTechniqueModules(authority: ApprovedClientAuthority): Promise<{
  results: TechniqueModuleResult[];
  failures: TechniqueFailure[];
}> {
  const settled = await Promise.allSettled(MODULES.map((module) => module(authority)));
  const results: TechniqueModuleResult[] = [];
  const failures: TechniqueFailure[] = [];
  settled.forEach((item, index) => {
    if (item.status === "fulfilled") results.push(item.value);
    else failures.push({
      techniqueNumber: index + 1,
      techniqueSlug: IDEATION_TECHNIQUE_SLUGS[index],
      error: item.reason instanceof Error ? item.reason.message : String(item.reason),
    });
  });
  return {
    results: results.sort((a, b) => a.techniqueNumber - b.techniqueNumber),
    failures,
  };
}
