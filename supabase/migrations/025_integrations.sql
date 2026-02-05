-- Table pour les intégrations externes (webhooks, API keys)
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'webhook', 'api_key'
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table pour les API keys d'accès externe
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(64) NOT NULL, -- SHA256 hash of the key
  key_prefix VARCHAR(8) NOT NULL, -- First 8 chars for identification
  permissions JSONB NOT NULL DEFAULT '["read:sales"]',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_integrations_shop ON integrations(shop_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_shop ON api_keys(shop_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- RLS
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integrations_select" ON integrations FOR SELECT USING (true);
CREATE POLICY "integrations_insert" ON integrations FOR INSERT WITH CHECK (true);
CREATE POLICY "integrations_update" ON integrations FOR UPDATE USING (true);
CREATE POLICY "integrations_delete" ON integrations FOR DELETE USING (true);

CREATE POLICY "api_keys_select" ON api_keys FOR SELECT USING (true);
CREATE POLICY "api_keys_insert" ON api_keys FOR INSERT WITH CHECK (true);
CREATE POLICY "api_keys_update" ON api_keys FOR UPDATE USING (true);
CREATE POLICY "api_keys_delete" ON api_keys FOR DELETE USING (true);

COMMENT ON TABLE integrations IS 'Configuration des intégrations externes (webhooks, etc.)';
COMMENT ON TABLE api_keys IS 'Clés API pour accès externe aux données Ivy';
COMMENT ON COLUMN api_keys.key_hash IS 'Hash SHA256 de la clé API (la clé en clair n est jamais stockée)';
COMMENT ON COLUMN api_keys.permissions IS 'Permissions accordées: read:sales, read:inventory, etc.';
