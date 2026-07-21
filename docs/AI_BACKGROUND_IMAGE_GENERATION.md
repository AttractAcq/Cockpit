# AI background image generation configuration

The `generate-ai-background-image` Edge Function requires all four server-side deployment variables:

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL=gpt-image-2` — required production target. Confirm that the production OpenAI account can use this model before the controlled provider pilot.
- `OPENAI_IMAGE_SIZE_DEFAULT=1024x1024`
- `OPENAI_IMAGE_QUALITY_DEFAULT=high`

Production deployment must set every variable before the Edge Function is used. The Edge Function allowlists model-specific size and quality values before claiming a generation. Missing or unsupported models, missing or invalid size/quality defaults, and invalid caller values fail closed before any OpenAI request. There is no silent model fallback.

Prompt creation and approval capture a fingerprint of the approved production brief fields used for the prompt. The atomic generation claim revalidates brief ownership, source reference, format, approved status, and fingerprint. A materially edited or rejected brief leaves the prompt unclaimed and requires a new prompt draft and review.

These values belong in Supabase Edge Function secrets. They must not use a `VITE_` prefix or be added to the frontend environment. The function stores generated PNG files in the existing private `client-assets` bucket at `clients/{client_id}/ai-backgrounds/{source_ref}/{generation_id}.png` conceptually; the existing bucket convention omits the literal `clients/` prefix, so the implemented path is `{client_id}/ai-backgrounds/{source_ref}/{generation_id}.png`.

No secret is set, inspected, or printed by the implementation gate.

Image generation stores only a reviewed background. The operator must explicitly select it, after which it enters the existing `uploaded_background` / `uploaded_image_path` pipeline. Final asset generation remains a separate action and publishing is never triggered.

The browser never calls OpenAI and never receives the provider key. All provider operations are performed by authenticated server-side Edge Functions.

`generate-ai-background-image` uploads a one-line JSONL input file and creates one OpenAI Batch request for `/v1/images/generations`. The line explicitly contains `gpt-image-2`, `high`, and `1024x1024`. It stores the batch and input-file identifiers, then returns with the generation in `provider_submitted`; it does not wait for or store image bytes.

`check-ai-background-image` is a manual result check. It retrieves only the stored batch identifier and never submits another image generation. Running batches return to `provider_submitted`. A completed batch output is matched by generation ID, decoded, and uploaded once with `upsert: false` to private storage before the row becomes `generated`. Failed, expired, or cancelled batches become `failed`. A five-minute stale recovery remains available for interrupted `generating`, `provider_submitted`, or `checking` transitions. No automatic polling or cron is used.

OpenAI Batch currently uses a fixed `24h` completion window and output files should be retrieved promptly after completion. Provider calls use short defensive network deadlines. Logs contain only function name, generation ID, and stage; prompts, provider payloads, provider identifiers, and credentials are excluded.

Staff or service-role operators may call `recover_stale_ai_background_generation` for a generation left in an active provider state for more than five minutes only when it has no storage path, generated timestamp, or provider result. Recovery marks it failed and records an audit activity; it never retries generation or mutates storage, assets, distribution, publishing, or Phase 3.
