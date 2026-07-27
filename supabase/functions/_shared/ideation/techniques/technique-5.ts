import type { TechniqueModule } from "./types.ts";
import { ideationTechniqueDefinition } from "../config.ts";

const definition = ideationTechniqueDefinition("live-objection-log");

export const runTechnique5: TechniqueModule = async () => ({
  techniqueNumber: definition.order,
  techniqueSlug: definition.slug,
  state: "no_source",
  generatesCandidates: false,
  message: definition.effective_focus,
});
