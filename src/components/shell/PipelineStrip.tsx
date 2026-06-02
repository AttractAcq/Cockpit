import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { mockApi } from "@/lib/mock";
import { PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@/types";
import { ROUTES } from "@/lib/constants";

/**
 * Horizontal pipeline strip — always visible across the top of every primary view.
 * Click a stage to jump to the Pipeline page filtered to that stage.
 */

interface StageMeta {
  hint?: string; // e.g. "· 4 unread", "· 1 today"
  highlight?: boolean;
}

const stageHints: Partial<Record<PipelineStage, StageMeta>> = {
  cold: { hint: "prospects" },
  contacted: { hint: "· 3 new today" },
  engaged: { hint: "· 4 unread", highlight: true },
  booked: { hint: "· 1 today" },
  onboarding: {},
  active: { hint: "clients" },
  delivering: { hint: "this wk" },
};

export function PipelineStrip() {
  const [counts, setCounts] = useState<Record<PipelineStage, number>>(
    {} as Record<PipelineStage, number>
  );
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    mockApi.clients.stageCounts().then(setCounts);
  }, []);

  // Hide on settings (orthogonal to the pipeline)
  if (location.pathname.startsWith(ROUTES.settings)) return null;

  return (
    <div className="h-16 border-b border-line flex px-4 py-2 flex-shrink-0">
      {PIPELINE_STAGES.map((stage, i) => {
        const meta = stageHints[stage] ?? {};
        const isLast = i === PIPELINE_STAGES.length - 1;
        const count = counts[stage] ?? 0;

        return (
          <button
            key={stage}
            onClick={() => navigate(`${ROUTES.pipeline}?stage=${stage}`)}
            className={`flex-1 flex items-center pl-[22px] pr-3.5 relative cursor-pointer rounded-none hover:bg-ink-200 transition-colors group ${
              isLast ? "" : "after:content-[''] after:absolute after:-right-2 after:top-1/2 after:-translate-y-1/2 after:rotate-45 after:w-4 after:h-4 after:border-t after:border-r after:border-line after:bg-ink after:z-[1] after:group-hover:bg-ink-200"
            }`}
          >
            <div className="flex flex-col leading-tight z-[2] items-start">
              <span className="text-[9.5px] uppercase tracking-cap text-paper-3">
                {STAGE_LABELS[stage]}
              </span>
              <span
                className={`font-serif text-[22px] mt-0.5 ${
                  meta.highlight ? "text-teal" : "text-paper"
                }`}
              >
                {count}
                {meta.hint && (
                  <small className="text-xs text-paper-3 font-sans ml-1.5">
                    {meta.hint}
                  </small>
                )}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
