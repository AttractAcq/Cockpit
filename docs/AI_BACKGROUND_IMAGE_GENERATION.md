# AI background image generation configuration

The `generate-ai-background-image` Edge Function requires server-side secrets:

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL` — confirm the deployed model against the account's current image-model availability before enabling production use. The code fallback is `gpt-image-1`.

Optional server-side defaults:

- `OPENAI_IMAGE_SIZE_DEFAULT` (fallback `1024x1536`)
- `OPENAI_IMAGE_QUALITY_DEFAULT` (fallback `medium`)

These values belong in Supabase Edge Function secrets. They must not use a `VITE_` prefix or be added to the frontend environment. The function stores generated PNG files in the existing private `client-assets` bucket at `clients/{client_id}/ai-backgrounds/{source_ref}/{generation_id}.png` conceptually; the existing bucket convention omits the literal `clients/` prefix, so the implemented path is `{client_id}/ai-backgrounds/{source_ref}/{generation_id}.png`.

No secret is set, inspected, or printed by the implementation gate.
