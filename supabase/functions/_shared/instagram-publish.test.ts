// Unit tests for the Meta container-readiness publishing logic.
//
// Run with:  deno test supabase/functions/_shared/instagram-publish.test.ts
//
// These exercise the pure, dependency-injected helpers — no network, no Supabase.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  classifyMetaError,
  earlierFramesAllPublished,
  hasPublicationEvidence,
  MetaPublishError,
  runPublish,
  validateStoryMedia,
  waitForContainerReady,
  type PublishDeps,
} from "./instagram-publish.ts";

// A controllable clock: sleep advances virtual time so timeouts are deterministic.
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => { t += ms; return Promise.resolve(); },
    advance: (ms: number) => { t += ms; },
  };
}

// A fetchStatus that returns queued statuses, then repeats the last one forever.
function statusSequence(...statuses: (string | undefined)[]) {
  let i = 0;
  const calls: string[] = [];
  const fn = (id: string, _token: string) => {
    calls.push(id);
    const value = i < statuses.length ? statuses[i] : statuses[statuses.length - 1];
    if (i < statuses.length - 1) i += 1;
    return Promise.resolve(value);
  };
  return { fn, calls };
}

Deno.test("waitForContainerReady: FINISHED immediately resolves after one poll", async () => {
  const clock = fakeClock();
  const status = statusSequence("FINISHED");
  await waitForContainerReady("child_1", "tok", { maxWaitMs: 45_000, pollIntervalMs: 2_500, now: clock.now, sleep: clock.sleep, fetchStatus: status.fn });
  assertEquals(status.calls.length, 1);
});

Deno.test("waitForContainerReady: IN_PROGRESS then FINISHED resolves", async () => {
  const clock = fakeClock();
  const status = statusSequence("IN_PROGRESS", "FINISHED");
  await waitForContainerReady("child_1", "tok", { maxWaitMs: 45_000, pollIntervalMs: 2_500, now: clock.now, sleep: clock.sleep, fetchStatus: status.fn });
  assertEquals(status.calls.length, 2);
});

Deno.test("waitForContainerReady: ERROR is a permanent container_error", async () => {
  const clock = fakeClock();
  const status = statusSequence("IN_PROGRESS", "ERROR");
  const err = await assertRejects(
    () => waitForContainerReady("child_1", "tok", { maxWaitMs: 45_000, pollIntervalMs: 2_500, now: clock.now, sleep: clock.sleep, fetchStatus: status.fn }),
    MetaPublishError,
  );
  assertEquals(err.classification.category, "container_error");
});

Deno.test("waitForContainerReady: EXPIRED is a permanent container_expired", async () => {
  const clock = fakeClock();
  const status = statusSequence("EXPIRED");
  const err = await assertRejects(
    () => waitForContainerReady("child_1", "tok", { maxWaitMs: 45_000, pollIntervalMs: 2_500, now: clock.now, sleep: clock.sleep, fetchStatus: status.fn }),
    MetaPublishError,
  );
  assertEquals(err.classification.category, "container_expired");
});

Deno.test("waitForContainerReady: never-ready hits container_processing_timeout within budget", async () => {
  const clock = fakeClock();
  const status = statusSequence("IN_PROGRESS");
  const err = await assertRejects(
    () => waitForContainerReady("child_1", "tok", { maxWaitMs: 10_000, pollIntervalMs: 2_500, now: clock.now, sleep: clock.sleep, fetchStatus: status.fn }),
    MetaPublishError,
  );
  assertEquals(err.classification.category, "container_processing_timeout");
  assert(err.classification.retryable);
  // Bounded: it must have stopped, not polled forever.
  assert(status.calls.length <= 5, `expected bounded polling, got ${status.calls.length}`);
});

Deno.test("waitForContainerReady: overall deadline caps a generous per-container ceiling", async () => {
  const clock = fakeClock();
  const status = statusSequence("IN_PROGRESS");
  // maxWaitMs is huge, but the shared deadline is only 5s → must time out ~5s.
  await assertRejects(
    () => waitForContainerReady("parent_1", "tok", { maxWaitMs: 600_000, pollIntervalMs: 2_500, deadline: 5_000, now: clock.now, sleep: clock.sleep, fetchStatus: status.fn }),
    MetaPublishError,
  );
  assert(clock.now() <= 5_000, `stopped by the overall deadline, elapsed ${clock.now()}ms`);
});

Deno.test("classifyMetaError: code 9007 / subcode 2207027 → container_not_ready retryable", () => {
  const c = classifyMetaError(400, { error: { code: 9007, error_subcode: 2207027, message: "Media ID is not available" } });
  assertEquals(c.provider, "meta");
  assertEquals(c.category, "container_not_ready");
  assertEquals(c.retryable, true);
});

Deno.test("classifyMetaError: token error (190) → meta_authentication non-retryable", () => {
  const c = classifyMetaError(400, { error: { code: 190, message: "Invalid OAuth access token" } });
  assertEquals(c.category, "meta_authentication");
  assertEquals(c.retryable, false);
});

// ── runPublish orchestration ─────────────────────────────────────────────────
interface Recorder {
  deps: PublishDeps;
  log: string[];
  publishCalls: number;
  childOrder: string[];
  parentChildren: string[];
  storyUrls: string[];
}

function fakeDeps(overrides: Partial<PublishDeps> = {}): Recorder {
  const log: string[] = [];
  const rec: Recorder = { log, publishCalls: 0, childOrder: [], parentChildren: [], storyUrls: [], deps: {} as PublishDeps };
  rec.deps = {
    signMedia: (_b, path) => { log.push(`sign:${path}`); return Promise.resolve(`url://${path}`); },
    createChildContainer: (_ig, url, _t) => { const id = `child_of_${url}`; rec.childOrder.push(url); log.push(`child:${url}`); return Promise.resolve(id); },
    createSingleContainer: (_ig, url, _c, _t) => { log.push(`single:${url}`); return Promise.resolve(`single_of_${url}`); },
    createCarouselContainer: (_ig, childIds, _c, _t) => { rec.parentChildren = [...childIds]; log.push(`parent:${childIds.join(",")}`); return Promise.resolve("parent_1"); },
    createStoryContainer: (_ig, url, _t) => { rec.storyUrls.push(url); log.push(`story:${url}`); return Promise.resolve(`story_of_${url}`); },
    waitReady: (id, _t, _m) => { log.push(`wait:${id}`); return Promise.resolve(); },
    mediaPublish: (_ig, creationId, _t) => { rec.publishCalls += 1; log.push(`publish:${creationId}`); return Promise.resolve("PUBLISHED_ID"); },
    fetchPermalink: (_id, _t) => Promise.resolve("https://instagram.com/p/xyz"),
    now: () => 0,
    ...overrides,
  };
  return rec;
}

const STORY_OPTS = { caption: "planning caption", contentType: "STORIES", igUserId: "ig", token: "tok", overallDeadline: 1_000_000, childMaxWaitMs: 45_000, parentMaxWaitMs: 60_000 };

Deno.test("runPublish carousel: no media_publish before every container is FINISHED", async () => {
  // waitReady rejects on the first child (ERROR) → publish must never run.
  const rec = fakeDeps({
    waitReady: (id) => Promise.reject(new MetaPublishError({ provider: "meta", category: "container_error", retryable: true, message: `err ${id}` })),
  });
  await assertRejects(() => runPublish(rec.deps, {
    media: [{ storage_bucket: "b", storage_path: "01.png", sequence_index: 1 }, { storage_bucket: "b", storage_path: "02.png", sequence_index: 2 }],
    caption: "c", contentType: "CAROUSEL", igUserId: "ig", token: "tok",
    overallDeadline: 1_000_000, childMaxWaitMs: 45_000, parentMaxWaitMs: 60_000,
  }), MetaPublishError);
  assertEquals(rec.publishCalls, 0);
  assert(!rec.log.includes("publish:parent_1"));
});

Deno.test("runPublish carousel: children keep sequence_index order; parent gets them ordered; publish last", async () => {
  const rec = fakeDeps();
  const result = await runPublish(rec.deps, {
    // Deliberately out of order — must be sorted to 01,02,03.
    media: [
      { storage_bucket: "b", storage_path: "03.png", sequence_index: 3 },
      { storage_bucket: "b", storage_path: "01.png", sequence_index: 1 },
      { storage_bucket: "b", storage_path: "02.png", sequence_index: 2 },
    ],
    caption: "c", contentType: "CAROUSEL", igUserId: "ig", token: "tok",
    overallDeadline: 1_000_000, childMaxWaitMs: 45_000, parentMaxWaitMs: 60_000,
  });
  assertEquals(rec.childOrder, ["url://01.png", "url://02.png", "url://03.png"]);
  assertEquals(rec.parentChildren, ["child_of_url://01.png", "child_of_url://02.png", "child_of_url://03.png"]);
  assertEquals(result.external_post_id, "PUBLISHED_ID");
  // publish happens after the parent wait.
  assert(rec.log.indexOf("wait:parent_1") < rec.log.indexOf("publish:parent_1"));
  assertEquals(rec.publishCalls, 1);
});

Deno.test("runPublish: overall deadline reached → timeout, no publish", async () => {
  const rec = fakeDeps({ now: () => 999_999_999 }); // already past any deadline
  await assertRejects(() => runPublish(rec.deps, {
    media: [{ storage_bucket: "b", storage_path: "01.png" }],
    caption: "c", contentType: "IMAGE", igUserId: "ig", token: "tok",
    overallDeadline: 1_000, childMaxWaitMs: 45_000, parentMaxWaitMs: 60_000,
  }), MetaPublishError);
  assertEquals(rec.publishCalls, 0);
});

Deno.test("hasPublicationEvidence: duplicate-publication guard", () => {
  assertEquals(hasPublicationEvidence({ external_post_id: null, published_at: null, published_url: null }), false);
  assertEquals(hasPublicationEvidence({ external_post_id: "123", published_at: null, published_url: null }), true);
  assertEquals(hasPublicationEvidence({ external_post_id: null, published_at: "2026-07-09T00:00:00Z", published_url: null }), true);
  assertEquals(hasPublicationEvidence({ external_post_id: null, published_at: null, published_url: "https://instagram.com/p/x" }), true);
});

// ── Image Story publishing ───────────────────────────────────────────────────
Deno.test("runPublish STORIES: uses the Story container (media_type=STORIES) with the signed image_url, not a feed/carousel container", async () => {
  const rec = fakeDeps();
  await runPublish(rec.deps, { ...STORY_OPTS, media: [{ storage_bucket: "b", storage_path: "frame01.png", mime_type: "image/png", sequence_index: 1 }] });
  assertEquals(rec.storyUrls, ["url://frame01.png"]); // Story container got the signed url
  assert(!rec.log.some((l) => l.startsWith("single:") || l.startsWith("child:") || l.startsWith("parent:")));
});

Deno.test("runPublish STORIES: no media_publish before the container is FINISHED", async () => {
  const rec = fakeDeps({ waitReady: (id) => Promise.reject(new MetaPublishError({ provider: "meta", category: "container_error", retryable: true, message: `err ${id}` })) });
  await assertRejects(() => runPublish(rec.deps, { ...STORY_OPTS, media: [{ storage_bucket: "b", storage_path: "frame01.png", mime_type: "image/png", sequence_index: 1 }] }), MetaPublishError);
  assertEquals(rec.publishCalls, 0);
});

Deno.test("runPublish STORIES: success with external_post_id and a null permalink", async () => {
  const rec = fakeDeps({ fetchPermalink: () => Promise.resolve(null) });
  const result = await runPublish(rec.deps, { ...STORY_OPTS, media: [{ storage_bucket: "b", storage_path: "frame01.jpg", mime_type: "image/jpeg", sequence_index: 1 }] });
  assertEquals(result.external_post_id, "PUBLISHED_ID");
  assertEquals(result.permalink, null);
  assertEquals(rec.publishCalls, 1);
});

Deno.test("runPublish STORIES: zero media rejected as story_validation (non-retryable)", async () => {
  const rec = fakeDeps();
  const err = await assertRejects(() => runPublish(rec.deps, { ...STORY_OPTS, media: [] }), MetaPublishError);
  assertEquals(err.classification.category, "story_validation");
  assertEquals(err.classification.retryable, false);
  assertEquals(rec.publishCalls, 0);
});

Deno.test("runPublish STORIES: more than one media rejected (must be one frame per record)", async () => {
  const rec = fakeDeps();
  const err = await assertRejects(() => runPublish(rec.deps, { ...STORY_OPTS, media: [
    { storage_bucket: "b", storage_path: "01.png", mime_type: "image/png", sequence_index: 1 },
    { storage_bucket: "b", storage_path: "02.png", mime_type: "image/png", sequence_index: 2 },
  ] }), MetaPublishError);
  assertEquals(err.classification.category, "story_validation");
  assertEquals(rec.storyUrls.length, 0);
});

Deno.test("runPublish STORIES: video media rejected", async () => {
  const rec = fakeDeps();
  const err = await assertRejects(() => runPublish(rec.deps, { ...STORY_OPTS, media: [{ storage_bucket: "b", storage_path: "clip.mp4", mime_type: "video/mp4", sequence_index: 1 }] }), MetaPublishError);
  assertEquals(err.classification.category, "story_validation");
  assert(/video/i.test(err.message));
});

Deno.test("validateStoryMedia: accepts a single PNG/JPEG, returns the item", () => {
  const item = validateStoryMedia([{ storage_bucket: "b", storage_path: "01.png", mime_type: "image/png" }]);
  assertEquals(item.storage_path, "01.png");
});

Deno.test("earlierFramesAllPublished: sequence gate holds later frames until earlier ones publish", () => {
  assertEquals(earlierFramesAllPublished([]), true); // frame 1 (no earlier)
  assertEquals(earlierFramesAllPublished(["published"]), true);
  assertEquals(earlierFramesAllPublished(["published", "published"]), true);
  assertEquals(earlierFramesAllPublished(["published", "scheduled"]), false);
  assertEquals(earlierFramesAllPublished(["ready"]), false);
  assertEquals(earlierFramesAllPublished(["failed"]), false);
});
