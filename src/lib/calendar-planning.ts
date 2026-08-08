// Programme Stage G — Calendar Planning data access.
//
// Reads go direct to Supabase under RLS. Every write (proposal generation,
// edits, and the atomic commit) goes through an Edge Function, matching the
// "reads direct, writes via function" convention used throughout Cockpit.

import { supabase, invokeFn } from "./supabase";
import type {
  ContentCalendarProposal,
  ContentCalendarProposalSlot,
  CreateCalendarProposalInput,
  CreateCalendarProposalResponse,
  UpdateCalendarProposalSlotInput,
  UpdateCalendarProposalSlotResponse,
  ApproveCalendarProposalInput,
  ApproveCalendarProposalResponse,
} from "@/types/calendar-planning";

export async function fetchCalendarProposals(clientId: string): Promise<ContentCalendarProposal[]> {
  const { data, error } = await supabase
    .from("content_calendar_proposals")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ContentCalendarProposal[];
}

export async function fetchProposalSlots(proposalId: string): Promise<ContentCalendarProposalSlot[]> {
  const { data, error } = await supabase
    .from("content_calendar_proposal_slots")
    .select("*")
    .eq("proposal_id", proposalId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ContentCalendarProposalSlot[];
}

export async function createCalendarProposal(input: CreateCalendarProposalInput): Promise<CreateCalendarProposalResponse> {
  return await invokeFn<CreateCalendarProposalResponse>("create-calendar-proposal", {
    client_id: input.clientId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    mode: input.mode ?? "assisted",
  });
}

export async function updateCalendarProposalSlot(input: UpdateCalendarProposalSlotInput): Promise<UpdateCalendarProposalSlotResponse> {
  return await invokeFn<UpdateCalendarProposalSlotResponse>("update-calendar-proposal-slot", {
    client_id: input.clientId,
    proposal_id: input.proposalId,
    action: input.action,
    expected_edit_revision: input.expectedEditRevision,
    from_slot_id: input.fromSlotId,
    to_slot_id: input.toSlotId,
    slot_id: input.slotId,
  });
}

export async function approveCalendarProposal(input: ApproveCalendarProposalInput): Promise<ApproveCalendarProposalResponse> {
  return await invokeFn<ApproveCalendarProposalResponse>("approve-calendar-proposal", {
    client_id: input.clientId,
    proposal_id: input.proposalId,
    expected_edit_revision: input.expectedEditRevision,
  });
}
