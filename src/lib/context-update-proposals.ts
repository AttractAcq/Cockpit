import type { ClientIterationCandidate, ContextUpdateChangeIntent, ContextUpdateProposalStatus, ContextUpdateProposalType, ContextUpdateTargetType } from "@/types/phase";

export const CONTEXT_UPDATE_PROPOSAL_TYPES:ContextUpdateProposalType[] = ["context_file_update","master_context_update","positioning_update","offer_update","proof_angle_update","cta_update","distribution_update","content_rule_update","calendar_rule_update","other"];
export const CONTEXT_UPDATE_TARGET_TYPES:ContextUpdateTargetType[] = ["context_file","master_context","playbook","content_rule","distribution_rule","approval_rule","offer","positioning","other"];
export const CONTEXT_UPDATE_CHANGE_INTENTS:ContextUpdateChangeIntent[] = ["add","revise","remove","clarify","emphasize","de_emphasize"];

export function validContextUpdateProposalTransition(from:ContextUpdateProposalStatus,to:ContextUpdateProposalStatus):boolean {
  return (from==="needs_review"&&(to==="approved"||to==="dismissed"))
    || (from==="approved"&&(to==="converted_to_patch"||to==="dismissed"))
    || (from==="dismissed"&&to==="dismissed");
}

export function contextProposalEvidenceFromCandidate(candidate:ClientIterationCandidate):Record<string,unknown> {
  return {iteration_candidate_id:candidate.id,candidate_type:candidate.candidate_type,recommendation:candidate.recommendation,rationale:candidate.rationale,evidence:candidate.evidence};
}
