# Context Inputs Editor

The Cockpit client detail page is the operating interface for entering and maintaining `client_inputs`. The editor reads and writes the selected client's row by `client_id`.

## Schema field mapping

| UI section | `client_inputs` column | Phase 1 recommendation |
| --- | --- | --- |
| Business Overview | `business_description` | Recommended |
| Offer / Services | `offer_details` | Recommended |
| Ideal Customer | `target_customer` | Recommended |
| Proof / Testimonials | `proof_notes` | Recommended |
| Sales Process | `sales_process` | Recommended |
| Current Marketing | `current_marketing` | Recommended |
| Brand Voice | `brand_voice` | Recommended |
| Competitors | `competitors` | Optional |
| Constraints / Approval Rules | `constraints_approval_rules` | Recommended |
| Raw Notes | `raw_notes` | Optional |

The last six columns were added by `20260702000002_batch_b_additions.sql`. No compatibility aliases or invented columns are used.

## Save behaviour

- **Save Section** sends only the changed column.
- **Save All** sends only fields whose draft value differs from the last loaded database value.
- A successful save refetches `client_inputs` from Supabase before updating the editor.
- **Reset Unsaved Changes** restores the last loaded database values without writing.
- **Reload From Database** discards local drafts and fetches the current row.
- If no row exists, the first save inserts one for the selected `client_id`. If a concurrent insert wins the unique-key race, the save retries as an update. Existing rows are updated directly; normal saves do not depend on a blanket upsert.
- Supabase errors are shown in the page with their message, code, details, and hint where provided. This includes authentication, RLS, invalid-column, network, and missing-row failures.

The workflow assumes the live schema has the existing unique constraint on `client_inputs.client_id`. RLS remains the authority for whether the signed-in user can select, insert, or update the row.

## Placeholder detection and Phase 1 safety

The readiness check treats the Batch C deployment-verification strings as placeholders, including minor punctuation/case changes and values containing those strings. Test/dummy content mentioning Batch C or deployment verification is also treated as placeholder content.

Readiness states are:

- **Ready** — all eight recommended sections contain saved, non-placeholder content.
- **Needs input** — no usable context is saved.
- **Placeholder detected** — one or more Batch C/test placeholders remain.
- **Missing recommended sections** — at least one recommended section is empty.

Immediately before Phase 1, Cockpit fetches a fresh `client_inputs` row. Placeholder content or missing recommended sections blocks the action. If only optional fields (`competitors`, `raw_notes`) are missing, Cockpit asks the operator to confirm before continuing. Unsaved editor drafts do not count as ready.

## AI Input Patch mode

The patch panel accepts pasted briefing text and creates a local draft using heading aliases first and keyword matching second. Explicit heading matches are labelled **mapped**; keyword matches are labelled **needs review**; content that cannot be classified goes to `raw_notes` and is labelled **unmatched**. The parser only moves text supplied by the operator and does not create proof, testimonials, claims, prices, or other client facts.

Every preview field is editable. Nothing is written until **Apply Patch to Client Inputs** is clicked.

- **Append to existing fields** is the default.
- **Replace fields** displays an overwrite warning and requires confirmation when real content would be replaced.
- Exact/substantial Batch C placeholders are replaced automatically rather than appended to.
- Empty preview fields are not written.
- A successful apply refetches the database row and clears the patch draft.

No external AI API is called from the browser and no API key is exposed. The current parser is deliberately conservative and should be treated as a review aid, not semantic extraction authority.

## Known limitations

- File upload and Supabase Storage integration are not built in this task.
- Transcript upload is not built in this task.
- Asset/proof upload is not built in this task.
- The browser does not call external AI directly.
- Heuristic patch mapping is a bridge until a backend normalisation function exists.
- The editor has one `updated_at` timestamp for the row because the schema does not store per-field save timestamps.

## Troubleshooting text entry

### Fixed: textareas visible but not clickable

The Context Inputs scroll region was previously both a fixed-height flex column and an overflow container. Because its section cards retained the default `flex-shrink: 1`, the browser compressed every card to only a few pixels instead of allowing the content to establish the scroll height. The textarea boxes overflowed those collapsed cards and visually overlapped. Later cards then received pointer hit-tests above the textareas, making every field appear visible but impossible to click or type into.

The scroll region now uses normal block flow with vertical spacing (`space-y-4`) instead of a shrinking flex column. Each card keeps its natural height, the panel scrolls normally, and `document.elementFromPoint()` resolves to the visible textarea.

To verify manually:

1. Open a client and select **Context Inputs**.
2. Click **Business Overview**, type temporary text, and confirm **Save Section** becomes enabled.
3. Click **Reset Unsaved Changes** and confirm the saved value is restored without a database write.
4. Scroll to **AI Input Patch**, type temporary raw notes, and confirm **Create Draft Patch** becomes enabled.
5. Click **Create Draft Patch** and confirm the editable ten-field preview appears.
6. Click **Clear Patch** to remove the temporary local draft.

AI Input Patch is a local parser. It does not require an edge function, does not call an external AI API, and does not expose browser API keys.

## Next batch

Add file, transcript, and proof/asset upload backed by Supabase Storage, then consider a server-side normalisation function with structured output and an operator approval step.
