import { useEffect, useState } from "react";
import { StageColumn } from "./StageColumn";
import { mockApi } from "@/lib/mock";
import { PIPELINE_STAGES, type Entity, type PipelineStage } from "@/types";

interface PipelineBoardProps {
  /** Optional filter to highlight a single stage (passed via ?stage= query). */
  filterStage?: PipelineStage;
}

export function PipelineBoard({ filterStage }: PipelineBoardProps) {
  const [entities, setEntities] = useState<Entity[]>([]);

  useEffect(() => {
    mockApi.clients.list().then(setEntities);
  }, []);

  const stages = filterStage ? [filterStage] : PIPELINE_STAGES;

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 py-3">
      <div className="flex gap-3 h-full min-w-max">
        {stages.map((stage) => {
          const stageEntities = entities.filter((e) => e.pipeline_stage === stage);
          return <StageColumn key={stage} stage={stage} entities={stageEntities} />;
        })}
      </div>
    </div>
  );
}
