CREATE TABLE providers (
  id             TEXT PRIMARY KEY,            -- 迁移行固定 'default'，新建为 uuid
  name           TEXT NOT NULL,
  protocol       TEXT NOT NULL CHECK (protocol IN ('openai_compatible', 'anthropic')),
  base_endpoint  TEXT NOT NULL,
  model          TEXT NOT NULL,               -- 该 provider 的默认模型
  credential_ref TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
-- 名字唯一性由 service 层校验（大小写不敏感），不加 DB 约束（改名冲突提示更友好）

INSERT INTO providers (id, name, protocol, base_endpoint, model,
                       credential_ref, created_at, updated_at)
  SELECT 'default', '默认', 'openai_compatible', base_endpoint, model,
         credential_ref, updated_at, updated_at
  FROM provider_profiles;
-- A first legacy `replace` persisted its recovery operation before the
-- singleton profile row. If the process stopped between that transaction and
-- the keyring write/reconcile, the operation is still valid but there is no
-- profile row to migrate. Seed the provider it references so the new
-- operation foreign key can preserve and replay that intent after upgrade.
INSERT INTO providers (id, name, protocol, base_endpoint, model,
                       credential_ref, created_at, updated_at)
  SELECT 'default', '默认', 'openai_compatible', base_endpoint, model,
         NULL, updated_at, updated_at
  FROM provider_credential_operations
  WHERE operation = 'save'
    AND NOT EXISTS (SELECT 1 FROM providers WHERE id = 'default')
  ORDER BY rowid ASC
  LIMIT 1;
DROP TABLE provider_profiles;

-- 凭据操作日志加 provider 维度（保留原 CHECK 语义）
CREATE TABLE provider_credential_operations_v2 (
  id                 TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL REFERENCES providers(id),
  operation          TEXT NOT NULL CHECK (operation IN ('save', 'delete')),
  base_endpoint      TEXT,
  model              TEXT,
  new_credential_ref TEXT,
  old_credential_ref TEXT,
  updated_at         INTEGER,
  CHECK ((operation = 'save' AND base_endpoint IS NOT NULL AND model IS NOT NULL AND updated_at IS NOT NULL)
      OR (operation = 'delete' AND base_endpoint IS NULL AND model IS NULL AND new_credential_ref IS NULL AND updated_at IS NULL))
);
INSERT INTO provider_credential_operations_v2
  SELECT id, 'default', operation, base_endpoint, model,
         new_credential_ref, old_credential_ref, updated_at
  FROM provider_credential_operations;
DROP TABLE provider_credential_operations;
ALTER TABLE provider_credential_operations_v2 RENAME TO provider_credential_operations;

-- 会话绑定（provider/model 二者同置同清；provider 删除 → 绑定回退全局；effort 独立列不受绑定清除影响）
ALTER TABLE conversations ADD COLUMN provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN model TEXT;
ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT
  CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('low', 'medium', 'high'));

-- 全局激活位（key-value，未来其他设置可复用）
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 迁移时 providers 至多一行（旧表 CHECK id='default'）；空库时 INSERT..SELECT 不产生行
INSERT INTO app_settings (key, value)
  SELECT 'active_provider_id', id FROM providers LIMIT 1;
