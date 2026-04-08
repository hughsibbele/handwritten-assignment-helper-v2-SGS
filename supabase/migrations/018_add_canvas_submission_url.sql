-- Store the Canvas submission URL so we can link to it on the success screen
ALTER TABLE submissions ADD COLUMN canvas_submission_url TEXT;
