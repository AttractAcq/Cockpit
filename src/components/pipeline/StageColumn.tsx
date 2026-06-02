import { EntityCard } from "./EntityCard";
import { STAGE_LABELS, type PipelineStage, type Entity } from "@/types";
import { fmtZARCompact } from "@/lib/format";

interface StageColumnProps {
  stage: PipelineStage;
  entities: Entity[];
}

export function StageColumn({ stage, entities }: StageColumnProps) {
  const totalValue = entities.reduce((acc, e) => acc + e.pipeline_value + e.mrr, 0);

  return (
    <div className="bg-ink-200 border border-line rounded-[10px] flex flex-col min-w-[240px] flex-1">
      <div className="px-3 py-2.5 border-b border-line flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xs uppercase tracking-cap text-paper-2 font-medium">
            {STAGE_LABELS[stage]}
          </span>
          <span className="bg-ink-100 border border-line text-paper text-2xs px-1.5 py-0.5 rounded-full font-mono">
            {entities.length}
          </span>
        </div>
        {totalValue > 0 && (
          <span className="font-mono text-2xs text-paper-3">
            {fmtZARCompact(totalValue)}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
        {entities.length === 0 ? (
          <div className="text-2xs text-paper-3 text-center py-4 border border-dashed border-line rounded-md">
            empty
          </div>
        ) : (
          entities.map((e) => <EntityCard key={e.id} entity={e} />)
        )}
      </div>
    </div>
  );
}
