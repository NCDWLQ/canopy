ALTER TABLE providers ADD COLUMN models TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(models));

-- Every provider keeps at least its default model selectable, so the
-- conversation picker (which reads this list offline) never has an empty set.
UPDATE providers SET models = json_array(model);
