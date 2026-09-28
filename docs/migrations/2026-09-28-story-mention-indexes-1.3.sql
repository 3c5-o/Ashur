-- ASHUR 1.3 story mention indexes
-- Applied to project pwpjrwcynnicexrmunkd on 2026-09-28.

create index if not exists stories_reshared_from_story_idx
  on public.stories(reshared_from_story_id)
  where reshared_from_story_id is not null;

create index if not exists story_mentions_mentioned_by_created_idx
  on public.story_mentions(mentioned_by, created_at desc);
