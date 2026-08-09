ALTER TABLE conversations
  ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0
    CHECK (is_archived IN (0, 1));

-- Node archive was provisional before the first release. Normalize that state
-- before installing the conversation-only archive guardrails.
UPDATE nodes SET is_archived = 0 WHERE is_archived <> 0;

CREATE TRIGGER nodes_reject_archive_on_insert
BEFORE INSERT ON nodes
WHEN NEW.is_archived <> 0
BEGIN
  SELECT RAISE(ABORT, 'node_archive_is_not_supported');
END;

CREATE TRIGGER nodes_reject_archive_on_update
BEFORE UPDATE OF is_archived ON nodes
WHEN NEW.is_archived <> 0
BEGIN
  SELECT RAISE(ABORT, 'node_archive_is_not_supported');
END;

CREATE TRIGGER nodes_reject_insert_into_archived_conversation
BEFORE INSERT ON nodes
WHEN EXISTS (
  SELECT 1
  FROM conversations AS c
  WHERE c.id = NEW.conversation_id AND c.is_archived = 1
)
BEGIN
  SELECT RAISE(ABORT, 'archived_conversation_is_read_only');
END;

CREATE TRIGGER conversations_archive_forward_only
BEFORE UPDATE OF is_archived ON conversations
WHEN NEW.is_archived <> 1
BEGIN
  SELECT RAISE(ABORT, 'conversation_archive_is_forward_only');
END;
