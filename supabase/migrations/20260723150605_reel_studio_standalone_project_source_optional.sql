-- Relax video_projects_source_pair from a strict XOR (exactly one of
-- organic_master_id / ads_master_id) to "at most one", so a genuinely
-- original reel that isn't already planned in the content pipeline can be
-- created as a standalone project with neither source set.
alter table video_projects drop constraint video_projects_source_pair;
alter table video_projects add constraint video_projects_source_pair
  check (not (organic_master_id is not null and ads_master_id is not null));
