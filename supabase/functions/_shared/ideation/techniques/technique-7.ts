import type { TechniqueModule } from "./types.ts";
import { authorityResearch } from "./research.ts";
import { ideationTechniqueDefinition } from "../config.ts";

const definition = ideationTechniqueDefinition("format-swipe");

export const runTechnique7: TechniqueModule = (authority) => authorityResearch(authority, {
  techniqueNumber: definition.order,
  techniqueSlug: definition.slug,
  sourceTitle: definition.source_title,
  contextFileNumbers: [...definition.context_file_numbers],
  focus: definition.effective_focus,
  generatesCandidates: false,
  state: "reference_ready",
});
