// ================= Alchemist 数据库初始化模块（含版本化迁移系统） =================
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'alchemist.db');

let db = null;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// ===================== 迁移定义 =====================

const migrations = [
  {
    version: 1,
    name: 'Initial schema — all base tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS time_weight_rules (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL UNIQUE,
          start_time  TEXT NOT NULL,
          end_time    TEXT NOT NULL,
          multiplier  REAL NOT NULL DEFAULT 1.0,
          description TEXT
        );

        CREATE TABLE IF NOT EXISTS real_api_keys (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          name                TEXT NOT NULL DEFAULT 'Default',
          api_key             TEXT NOT NULL,
          base_url            TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
          time_weight_rule_id INTEGER,
          auto_associate      INTEGER NOT NULL DEFAULT 0,
          created_at          TEXT NOT NULL,
          FOREIGN KEY (time_weight_rule_id) REFERENCES time_weight_rules(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS real_key_models (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          real_api_key_id    INTEGER NOT NULL,
          display_name       TEXT NOT NULL,
          upstream_model     TEXT NOT NULL,
          base_rate          REAL NOT NULL DEFAULT 1.0,
          description        TEXT,
          FOREIGN KEY (real_api_key_id) REFERENCES real_api_keys(id) ON DELETE CASCADE,
          UNIQUE(real_api_key_id, display_name)
        );

        CREATE TABLE IF NOT EXISTS access_keys (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          key_value       TEXT NOT NULL UNIQUE,
          name            TEXT NOT NULL DEFAULT 'Untitled',
          real_api_key_id INTEGER NOT NULL,
          credits_balance REAL NOT NULL DEFAULT 1000,
          total_calls     INTEGER NOT NULL DEFAULT 0,
          is_active       INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL,
          FOREIGN KEY (real_api_key_id) REFERENCES real_api_keys(id)
        );

        CREATE TABLE IF NOT EXISTS devices (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id   TEXT NOT NULL UNIQUE,
          access_key  TEXT NOT NULL,
          bound_at    TEXT NOT NULL,
          last_online TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_strategies (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          access_key_id  INTEGER NOT NULL,
          device_id      TEXT,
          system_prompt  TEXT DEFAULT '',
          template       TEXT DEFAULT '',
          few_shots      TEXT DEFAULT '[]',
          strategy_name  TEXT DEFAULT '',
          created_at     TEXT NOT NULL,
          updated_at     TEXT NOT NULL,
          FOREIGN KEY (access_key_id) REFERENCES access_keys(id)
        );

        CREATE TABLE IF NOT EXISTS usage_logs (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          access_key_id    INTEGER,
          device_id        TEXT,
          model            TEXT NOT NULL DEFAULT '',
          credits_used     REAL NOT NULL DEFAULT 0,
          time_weight      REAL NOT NULL DEFAULT 1.0,
          prompt_tokens    INTEGER DEFAULT 0,
          completion_tokens INTEGER DEFAULT 0,
          status           TEXT NOT NULL DEFAULT 'success',
          error_message    TEXT,
          created_at       TEXT NOT NULL,
          FOREIGN KEY (access_key_id) REFERENCES access_keys(id)
        );
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_access_keys_value ON access_keys(key_value);
        CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
        CREATE INDEX IF NOT EXISTS idx_devices_access_key ON devices(access_key);
        CREATE INDEX IF NOT EXISTS idx_devices_last_online ON devices(last_online);
        CREATE INDEX IF NOT EXISTS idx_usage_logs_access_key ON usage_logs(access_key_id);
        CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_user_strategies_access_key ON user_strategies(access_key_id);
        CREATE INDEX IF NOT EXISTS idx_real_key_models_key_id ON real_key_models(real_api_key_id);
      `);
    }
  },
  // 未来迁移在此追加：
  // { version: 2, name: 'Add xxx column', up(db) { db.exec("ALTER TABLE ... ADD COLUMN ..."); } },
];

// ===================== 迁移执行器 =====================

function ensureSchemaVersion(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const existing = db.prepare("SELECT value FROM admin_settings WHERE key = 'schema_version'").get();
  if (!existing) {
    db.prepare("INSERT OR IGNORE INTO admin_settings (key, value) VALUES ('schema_version', '0')").run();
  }
}

function runMigrations(db) {
  ensureSchemaVersion(db);

  const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'schema_version'").get();
  const currentVersion = parseInt(row.value, 10) || 0;

  const pending = migrations.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    console.log(`📦 Schema at v${currentVersion} — up to date`);
    return;
  }

  console.log(`📦 Schema v${currentVersion} → v${pending[pending.length - 1].version} (${pending.length} migration(s) pending)`);

  for (const m of pending) {
    console.log(`   🔄 v${m.version}: ${m.name}...`);
    m.up(db);
    db.prepare("UPDATE admin_settings SET value = ? WHERE key = 'schema_version'").run(String(m.version));
    console.log(`   ✅ v${m.version} done`);
  }

  console.log(`📦 All migrations complete. Schema at v${migrations[migrations.length - 1].version}`);
}

// ===================== 初始化入口 =====================

function initDB() {
  const database = getDB();

  runMigrations(database);

  const existingPassword = database.prepare("SELECT value FROM admin_settings WHERE key = 'admin_password'").get();
  if (!existingPassword) {
    database.prepare("INSERT INTO admin_settings (key, value) VALUES ('admin_password', 'alchemist-admin')").run();
  }

  console.log('✅ Database ready at:', DB_PATH);
}

// ===================== 数据导出/导入 =====================

const ALL_TABLES = [
  'admin_settings',
  'time_weight_rules',
  'real_api_keys',
  'real_key_models',
  'access_keys',
  'devices',
  'user_strategies',
  'usage_logs'
];

function exportAllData(db) {
  const tables = {};
  for (const tableName of ALL_TABLES) {
    try {
      tables[tableName] = db.prepare(`SELECT * FROM ${tableName}`).all();
    } catch (e) {
      tables[tableName] = [];
    }
  }

  const versionRow = db.prepare("SELECT value FROM admin_settings WHERE key = 'schema_version'").get();

  return {
    exported_at: new Date().toISOString(),
    schema_version: versionRow ? parseInt(versionRow.value, 10) : 0,
    tables
  };
}

function importAllData(db, data) {
  if (!data.tables || typeof data.tables !== 'object') {
    throw new Error('Invalid backup format: missing tables object');
  }

  const currentVersion = db.prepare("SELECT value FROM admin_settings WHERE key = 'schema_version'").get();
  const importVersion = data.schema_version || 0;
  if (importVersion !== parseInt(currentVersion.value, 10)) {
    throw new Error(
      `Schema version mismatch: backup is v${importVersion}, current database is v${currentVersion.value}. ` +
      'Import is only supported when versions match.'
    );
  }

  db.pragma('foreign_keys = OFF');

  try {
    const transaction = db.transaction(() => {
      const reversed = [...ALL_TABLES].reverse();
      for (const tableName of reversed) {
        db.prepare(`DELETE FROM ${tableName}`).run();
      }

      for (const tableName of ALL_TABLES) {
        const rows = data.tables[tableName];
        if (!rows || rows.length === 0) continue;

        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const insert = db.prepare(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`);

        for (const row of rows) {
          const values = columns.map(col => {
            const val = row[col];
            if (typeof val === 'boolean') return val ? 1 : 0;
            return val;
          });
          insert.run(...values);
        }
      }
    });

    transaction();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  return { imported_tables: ALL_TABLES.filter(t => data.tables[t] && data.tables[t].length > 0) };
}

module.exports = { getDB, initDB, exportAllData, importAllData };
