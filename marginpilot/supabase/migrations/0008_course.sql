-- 0008_course.sql: course area (Phase 8). Additive only.
-- Seeds the six module shells from src/content/marketing.ts (COURSE_MODULES) when the
-- table is empty. Lessons are written by an admin in /admin/course; none are seeded.

-- ---------------------------------------------------------------------------
-- Lessons: optional WebVTT captions file (course-resources bucket) for storage videos
-- ---------------------------------------------------------------------------
alter table course_lessons add column if not exists captions_path text;
alter table course_lessons add column if not exists captions_label text;
alter table course_lessons add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Resources: file metadata shown next to the download link
-- ---------------------------------------------------------------------------
alter table course_resources add column if not exists kind text not null default 'file'
  check (kind in ('file', 'pdf', 'spreadsheet', 'template', 'checklist', 'other'));
alter table course_resources add column if not exists file_name text;
alter table course_resources add column if not exists content_type text;
alter table course_resources add column if not exists size_bytes bigint check (size_bytes is null or size_bytes >= 0);
alter table course_resources add column if not exists created_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Indexes for the outline (ordered lessons per module) and progress lookups
-- ---------------------------------------------------------------------------
create index if not exists course_modules_position_idx on course_modules (position);
create index if not exists course_lessons_module_position_idx on course_lessons (module_id, position);
create index if not exists course_resources_lesson_position_idx on course_resources (lesson_id, position);
create index if not exists lesson_progress_user_updated_idx on lesson_progress (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Seed the six modules (titles and summaries match COURSE_MODULES), only if empty
-- ---------------------------------------------------------------------------
insert into course_modules (title, summary, position)
select v.title, v.summary, v.position
from (values
  ('Account setup and selling limits',
   'Set up the account, business policies and payments correctly, and understand how selling limits work and grow.', 1),
  ('Finding products that already sell',
   'Use sold data and demand signals to choose products with proven buyers instead of guessing.', 2),
  ('Suppliers and eBay''s sourcing rules',
   'Pick reliable suppliers and stay inside eBay''s sourcing and drop shipping policy.', 3),
  ('Pricing and margin math',
   'Work out fees, ad spend, discounts and returns so every price leaves the margin you planned.', 4),
  ('Listings that get found',
   'Titles, item specifics, photos and descriptions that match how buyers search on eBay.', 5),
  ('Orders, returns and scaling to more stores',
   'Fulfil on time, handle returns and cases, and add stores without losing control of the work.', 6)
) as v (title, summary, position)
where not exists (select 1 from course_modules);
