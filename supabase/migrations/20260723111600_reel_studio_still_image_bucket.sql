-- Reel Studio Phase A correction (part 2): the still-frame step downloads an
-- image, not a video, into the existing video-assets bucket. Extend the
-- bucket's allowed_mime_types to permit the still-image formats DoP itself
-- documents (jpeg/png/webp). No new bucket, no storage RLS change --
-- existing staff-only policies are scoped by bucket_id, not mime type.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'video/mp4', 'video/quicktime', 'video/webm',
  'image/jpeg', 'image/png', 'image/webp'
]
WHERE id = 'video-assets';
