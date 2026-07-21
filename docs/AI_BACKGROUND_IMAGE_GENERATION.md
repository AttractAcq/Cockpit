# AI background image generation configuration

The `generate-ai-background-image` Edge Function requires all four server-side deployment variables:

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL=gpt-image-2` — required production target. Confirm that the production OpenAI account can use this model before the controlled provider pilot.
- `OPENAI_IMAGE_SIZE_DEFAULT=1024x1024`
- `OPENAI_IMAGE_QUALITY_DEFAULT=high`

Production deployment must set every variable before the Edge Function is used. The Edge Function allowlists model-specific size and quality values before claiming a generation. Missing or unsupported models, missing or invalid size/quality defaults, and invalid caller values fail closed before any OpenAI request. There is no silent fallback from `gpt-image-2` to `gpt-image-1`; the latter is only an explicitly configured compatibility profile.

Prompt creation and approval capture a fingerprint of the approved production brief fields used for the prompt. The atomic generation claim revalidates brief ownership, source reference, format, approved status, and fingerprint. A materially edited or rejected brief leaves the prompt unclaimed and requires a new prompt draft and review.

These values belong in Supabase Edge Function secrets. They must not use a `VITE_` prefix or be added to the frontend environment. The function stores generated PNG files in the existing private `client-assets` bucket at `clients/{client_id}/ai-backgrounds/{source_ref}/{generation_id}.png` conceptually; the existing bucket convention omits the literal `clients/` prefix, so the implemented path is `{client_id}/ai-backgrounds/{source_ref}/{generation_id}.png`.

No secret is set, inspected, or printed by the implementation gate.

Image generation stores only a reviewed background. The operator must explicitly select it, after which it enters the existing `uploaded_background` / `uploaded_image_path` pipeline. Final asset generation remains a separate action and publishing is never triggered.

The browser never calls OpenAI and never receives the provider key. All image generation is performed by the authenticated server-side Edge Function.

Provider requests use a 120-second deadline so the function retains time to persist a terminal failure before the Edge runtime budget is exhausted. Stage logs contain only the function name, generation ID, and stage; prompts, provider payloads, and credentials are excluded.

Staff or service-role operators may call `recover_stale_ai_background_generation` for a generation left in `generating` for more than five minutes only when it has no storage path, generated timestamp, or provider result. Recovery marks it failed and records an audit activity; it never retries generation or mutates storage, assets, distribution, publishing, or Phase 3.
