-- CloudPress DB Schema v3.0 — InstaWP 버전
-- [[action]].js의 ensureSchema()가 자동 실행하므로 수동 실행 불필요

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',   -- user | manager | admin
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  custom_domain TEXT,
  wp_url TEXT,
  wp_admin_url TEXT,
  wp_username TEXT,
  wp_password TEXT,
  -- InstaWP 관련 필드
  iwp_site_id TEXT,          -- InstaWP 사이트 ID (삭제/조회에 사용)
  iwp_task_id TEXT,          -- 비동기 생성 중일 때 task ID
  -- 레거시 필드 (하위 호환)
  vps_container_id TEXT,
  db_name TEXT,
  db_user TEXT,
  db_password TEXT,
  -- 공통
  status TEXT NOT NULL DEFAULT 'provisioning',  -- provisioning | active | error | stopped
  php_version TEXT DEFAULT 'latest',
  region TEXT DEFAULT 'ap-southeast-1',         -- Singapore
  plan TEXT NOT NULL DEFAULT 'free',
  disk_usage_mb INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  order_id TEXT UNIQUE NOT NULL,
  payment_key TEXT,
  amount INTEGER NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | done | canceled | failed
  method TEXT,
  card_company TEXT,
  receipt_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  confirmed_at INTEGER
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',   -- info | warning | success | error
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS traffic_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  path TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  device TEXT,
  ua TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sites_user      ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_subdomain ON sites(subdomain);
CREATE INDEX IF NOT EXISTS idx_sites_iwp       ON sites(iwp_site_id);
CREATE INDEX IF NOT EXISTS idx_payments_user   ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order  ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_traffic_time    ON traffic_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_traffic_user    ON traffic_logs(user_id);

-- 기본 설정값
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('plan_starter_price',    '9900'),
  ('plan_pro_price',        '29900'),
  ('plan_enterprise_price', '99000'),
  ('plan_starter_sites',    '3'),
  ('plan_pro_sites',        '10'),
  ('plan_enterprise_sites', '-1'),
  ('site_domain',           'cloudpress.cloud-in.co.kr'),
  ('toss_client_key',       ''),
  ('toss_secret_key',       ''),
  ('instawp_api_key',       ''),
  ('contact_email',         'choichoi3227@gmail.com');
