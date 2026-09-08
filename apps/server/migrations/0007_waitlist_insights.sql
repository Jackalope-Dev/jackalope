ALTER TABLE access_members ADD COLUMN preferences TEXT;
ALTER TABLE access_members ADD COLUMN campaign TEXT;
ALTER TABLE access_members ADD COLUMN survey_hash TEXT;
ALTER TABLE access_members ADD COLUMN survey_expires_at INTEGER;
CREATE UNIQUE INDEX access_survey_token ON access_members(survey_hash) WHERE survey_hash IS NOT NULL;
