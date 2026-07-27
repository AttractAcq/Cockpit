import type { TechniqueModule } from "./types.ts";
import { ideationTechniqueDefinition } from "../config.ts";

const definition = ideationTechniqueDefinition("trigger-event");

export const runTechnique6: TechniqueModule = async () => ({
  techniqueNumber: definition.order,
  techniqueSlug: definition.slug,
  state: "inactive",
  generatesCandidates: false,
  message: definition.effective_focus,
});
