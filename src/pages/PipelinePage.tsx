import { useSearchParams } from "react-router-dom";
import { PipelineBoard } from "@/components/pipeline";
import { PIPELINE_STAGES, type PipelineStage } from "@/types";

export function PipelinePage() {
  const [params] = useSearchParams();
  const stageParam = params.get("stage") as PipelineStage | null;
  const filterStage =
    stageParam && PIPELINE_STAGES.includes(stageParam) ? stageParam : undefined;

  return <PipelineBoard filterStage={filterStage} />;
}
