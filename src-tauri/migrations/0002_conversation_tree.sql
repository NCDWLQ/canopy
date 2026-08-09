CREATE TABLE conversations (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  FOREIGN KEY (root_node_id, id)
    REFERENCES nodes (id, conversation_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE nodes (
  id              TEXT PRIMARY KEY,
  parent_id       TEXT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL
                    CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content         TEXT NOT NULL,
  model           TEXT,
  created_at      INTEGER NOT NULL,
  metadata        TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(metadata)),
  is_archived     INTEGER NOT NULL DEFAULT 0
                    CHECK (is_archived IN (0, 1)),
  CHECK (parent_id IS NULL OR parent_id <> id),
  UNIQUE (id, conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  FOREIGN KEY (parent_id, conversation_id)
    REFERENCES nodes (id, conversation_id)
);

CREATE UNIQUE INDEX nodes_one_root_per_conversation
  ON nodes (conversation_id)
  WHERE parent_id IS NULL;

CREATE INDEX nodes_children_order
  ON nodes (conversation_id, parent_id, created_at, id);

CREATE INDEX nodes_conversation_order
  ON nodes (conversation_id, created_at, id);

CREATE TRIGGER nodes_reject_designated_root_parent
BEFORE INSERT ON nodes
WHEN NEW.parent_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM conversations AS c
   WHERE c.id = NEW.conversation_id AND c.root_node_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'designated_root_must_be_structural_root');
END;

CREATE TRIGGER nodes_reject_designated_root_archived_on_insert
BEFORE INSERT ON nodes
WHEN NEW.is_archived = 1
 AND EXISTS (
   SELECT 1 FROM conversations AS c
   WHERE c.id = NEW.conversation_id AND c.root_node_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'designated_root_cannot_be_archived');
END;

CREATE TRIGGER nodes_immutable_history
BEFORE UPDATE ON nodes
WHEN OLD.id IS NOT NEW.id
  OR OLD.parent_id IS NOT NEW.parent_id
  OR OLD.conversation_id IS NOT NEW.conversation_id
  OR OLD.role IS NOT NEW.role
  OR OLD.content IS NOT NEW.content
  OR OLD.model IS NOT NEW.model
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.metadata IS NOT NEW.metadata
BEGIN
  SELECT RAISE(ABORT, 'node_history_is_immutable');
END;

CREATE TRIGGER nodes_reject_designated_root_archive
BEFORE UPDATE OF is_archived ON nodes
WHEN NEW.is_archived = 1
 AND EXISTS (
   SELECT 1 FROM conversations AS c
   WHERE c.id = NEW.conversation_id AND c.root_node_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'designated_root_cannot_be_archived');
END;

CREATE TRIGGER nodes_reject_delete
BEFORE DELETE ON nodes
BEGIN
  SELECT RAISE(ABORT, 'node_history_cannot_be_deleted');
END;

CREATE TRIGGER conversations_immutable_identity_and_root
BEFORE UPDATE OF id, root_node_id ON conversations
WHEN OLD.id IS NOT NEW.id OR OLD.root_node_id IS NOT NEW.root_node_id
BEGIN
  SELECT RAISE(ABORT, 'conversation_identity_and_root_are_immutable');
END;
