-- Repair released rows where ON DELETE SET NULL cleared provider_id but left
-- an orphaned model value, then keep provider_id and model paired on delete.
UPDATE conversations
SET model = NULL
WHERE provider_id IS NULL AND model IS NOT NULL;

-- Runs before the provider_id FK ON DELETE SET NULL action so both binding
-- columns clear together. reasoning_effort is independent and untouched.
CREATE TRIGGER provider_delete_clears_conversation_binding
BEFORE DELETE ON providers
FOR EACH ROW
BEGIN
  UPDATE conversations
  SET provider_id = NULL, model = NULL
  WHERE provider_id = OLD.id;
END;
