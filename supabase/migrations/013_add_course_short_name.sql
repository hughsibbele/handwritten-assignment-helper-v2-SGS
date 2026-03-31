-- Teacher-set display name for the course, used in Google Drive folder names.
-- e.g. "FLC" instead of "2526-Fundamentals in Literature & Composition-Koeze"
ALTER TABLE courses ADD COLUMN short_name TEXT;
