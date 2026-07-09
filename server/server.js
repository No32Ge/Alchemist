// ================= Alchemist Relay Server =================
// 端口 5000：用户 API 中继服务
// 端口 8080：管理员后台服务

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { initDB, getDB, exportAllData, importAllData } = require('./db');

// ===================== 配置 =====================
const USER_API_PORT = process.env.USER_API_PORT || 5000;
const ADMIN_PORT = process.env.ADMIN_PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'alchemist-admin';
const DEFAULT_DEEPSEEK_BASE = 'https://api.deepseek.com';

// ===================== 数据库初始化 =====================
initDB();

// ===================== 工具函数 =====================

function generateAccessKey() {
  return 'alk-' + crypto.randomBytes(16).toString('hex');
}

function signAdminJWT(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function nowISO() {
  return new Date().toISOString();
}

function nowTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function extractTokensFromResponse(body, field) {
  try {
    const data = JSON.parse(body);
    return data.usage ? (data.usage[field] || 0) : 0;
  } catch {
    return 0;
  }
}

/** 计算当前时间加权系数 */
function getCurrentTimeMultiplier(db, realApiKeyId) {
  const realKey = db.prepare('SELECT time_weight_rule_id FROM real_api_keys WHERE id = ?').get(realApiKeyId);
  if (!realKey || !realKey.time_weight_rule_id) return 1.0;

  const rule = db.prepare('SELECT * FROM time_weight_rules WHERE id = ?').get(realKey.time_weight_rule_id);
  if (!rule) return 1.0;

  const current = nowTime();
  // 支持跨夜时间区间（如 22:00 - 06:00）
  if (rule.start_time <= rule.end_time) {
    // 正常区间
    if (current >= rule.start_time && current < rule.end_time) {
      return rule.multiplier;
    }
  } else {
    // 跨午夜区间
    if (current >= rule.start_time || current < rule.end_time) {
      return rule.multiplier;
    }
  }
  return 1.0;
}

// ===================== 用户 API 服务（端口 5000） =====================
const userApp = express();
userApp.use(cors());
userApp.use(express.json({ limit: '10mb' }));

// ---- 健康检查 ----
userApp.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'alchemist-relay', timestamp: nowISO() });
});

// ---- 核心中继：POST /api/v1/chat/completions ----
userApp.post('/api/v1/chat/completions', async (req, res) => {
  const db = getDB();
  const accessKey = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const deviceId = req.headers['x-device-id'] || '';

  // 1. 验证 Access Key
  if (!accessKey) {
    return res.status(401).json({ error: 'Missing Access Key. Provide Authorization: Bearer <access-key>' });
  }
  const keyRow = db.prepare('SELECT * FROM access_keys WHERE key_value = ?').get(accessKey);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid Access Key' });
  }
  if (!keyRow.is_active) {
    return res.status(403).json({ error: 'Access Key has been disabled' });
  }

  // 2. 验证 / 绑定 Device ID
  if (deviceId) {
    const existingDevice = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
    if (!existingDevice) {
      db.prepare('INSERT INTO devices (device_id, access_key, bound_at, last_online) VALUES (?, ?, ?, ?)').run(
        deviceId, accessKey, nowISO(), nowISO()
      );
    } else if (existingDevice.access_key !== accessKey) {
      db.prepare('UPDATE devices SET access_key = ?, bound_at = ?, last_online = ? WHERE device_id = ?').run(
        accessKey, nowISO(), nowISO(), deviceId
      );
    } else {
      db.prepare('UPDATE devices SET last_online = ? WHERE device_id = ?').run(nowISO(), deviceId);
    }
  }

  // 3. 获取真实 API Key
  const realKeyRow = db.prepare('SELECT * FROM real_api_keys WHERE id = ?').get(keyRow.real_api_key_id);
  if (!realKeyRow) {
    return res.status(500).json({ error: 'Backend configuration error: Real API Key not found' });
  }

  // 4. 🔮 验证展示模型并改写为真实上游模型
  const requestModel = (req.body && req.body.model) || '';
  if (!requestModel) {
    return res.status(400).json({ error: 'Missing model in request body' });
  }

  const modelMapping = db.prepare(
    'SELECT * FROM real_key_models WHERE real_api_key_id = ? AND display_name = ?'
  ).get(keyRow.real_api_key_id, requestModel);

  if (!modelMapping) {
    return res.status(400).json({
      error: `Unknown model: "${requestModel}". This model is not available for your access key.`
    });
  }

  // 真实上游模型名
  const upstreamModel = modelMapping.upstream_model;
  const baseRate = modelMapping.base_rate;

  // 5. 计算时间加权后的实际积分
  const timeMultiplier = getCurrentTimeMultiplier(db, keyRow.real_api_key_id);
  const creditsPerCall = Math.ceil(baseRate * timeMultiplier * 100) / 100; // 保留两位小数

  // 6. 检查积分
  if (keyRow.credits_balance < creditsPerCall) {
    return res.status(402).json({
      error: 'Insufficient Credits',
      detail: `Required: ${creditsPerCall}, Balance: ${keyRow.credits_balance}`,
      required_credits: creditsPerCall,
      balance: keyRow.credits_balance
    });
  }

  // 7. 🔮 秘密改写 Payload：将展示模型替换为真实上游模型
  const forwardBody = { ...req.body, model: upstreamModel };
  const deepseekBase = realKeyRow.base_url || DEFAULT_DEEPSEEK_BASE;
  const deepseekUrl = deepseekBase.replace(/\/$/, '') + '/chat/completions';

  try {
    const upstreamResp = await fetch(deepseekUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${realKeyRow.api_key}`
      },
      body: JSON.stringify(forwardBody),
      signal: AbortSignal.timeout(300000)
    });

    const responseBody = await upstreamResp.text();

    if (upstreamResp.ok) {
      // 扣减积分
      db.prepare('UPDATE access_keys SET credits_balance = credits_balance - ?, total_calls = total_calls + 1 WHERE id = ?').run(
        creditsPerCall, keyRow.id
      );

      // 记录消费日志（含展示模型名和加权系数）
      const promptTokens = extractTokensFromResponse(responseBody, 'prompt_tokens');
      const completionTokens = extractTokensFromResponse(responseBody, 'completion_tokens');
      db.prepare(`
        INSERT INTO usage_logs (access_key_id, device_id, model, credits_used, time_weight, prompt_tokens, completion_tokens, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?)
      `).run(keyRow.id, deviceId || null, requestModel, creditsPerCall, timeMultiplier, promptTokens, completionTokens, nowISO());
    } else {
      db.prepare(`
        INSERT INTO usage_logs (access_key_id, device_id, model, credits_used, time_weight, prompt_tokens, completion_tokens, status, error_message, created_at)
        VALUES (?, ?, ?, 0, ?, 0, 0, 'failed', ?, ?)
      `).run(keyRow.id, deviceId || null, requestModel, timeMultiplier, `HTTP ${upstreamResp.status}: ${responseBody.substring(0, 500)}`, nowISO());
    }

    res.status(upstreamResp.status).set('Content-Type', 'application/json').send(responseBody);

  } catch (err) {
    db.prepare(`
      INSERT INTO usage_logs (access_key_id, device_id, model, credits_used, time_weight, prompt_tokens, completion_tokens, status, error_message, created_at)
      VALUES (?, ?, ?, 0, ?, 0, 0, 'error', ?, ?)
    `).run(keyRow.id, deviceId || null, requestModel, timeMultiplier, 'Network error: ' + err.message, nowISO());

    res.status(502).json({ error: 'Upstream API unreachable', detail: err.message });
  }
});

// ---- 策略同步接口 ----
userApp.post('/api/v1/sync-strategy', (req, res) => {
  const db = getDB();
  const accessKey = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const deviceId = req.headers['x-device-id'] || '';
  const { system_prompt, template, few_shots, strategy_name } = req.body;

  if (!accessKey) {
    return res.status(401).json({ error: 'Missing Access Key' });
  }

  const keyRow = db.prepare('SELECT id FROM access_keys WHERE key_value = ?').get(accessKey);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid Access Key' });
  }

  const existing = db.prepare(
    'SELECT id FROM user_strategies WHERE access_key_id = ? AND device_id = ?'
  ).get(keyRow.id, deviceId || null);

  const fewShotsJSON = JSON.stringify(few_shots || []);

  if (existing) {
    db.prepare(`
      UPDATE user_strategies SET system_prompt = ?, template = ?, few_shots = ?, strategy_name = ?, updated_at = ?
      WHERE id = ?
    `).run(system_prompt || '', template || '', fewShotsJSON, strategy_name || '', nowISO(), existing.id);
  } else {
    db.prepare(`
      INSERT INTO user_strategies (access_key_id, device_id, system_prompt, template, few_shots, strategy_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(keyRow.id, deviceId || null, system_prompt || '', template || '', fewShotsJSON, strategy_name || '', nowISO(), nowISO());
  }

  res.json({ status: 'synced', timestamp: nowISO() });
});

// ---- 用户获取自己的策略 ----
userApp.get('/api/v1/strategy', (req, res) => {
  const db = getDB();
  const accessKey = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const deviceId = req.headers['x-device-id'] || '';

  if (!accessKey) {
    return res.status(401).json({ error: 'Missing Access Key' });
  }

  const keyRow = db.prepare('SELECT id FROM access_keys WHERE key_value = ?').get(accessKey);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid Access Key' });
  }

  const strategy = db.prepare(
    'SELECT * FROM user_strategies WHERE access_key_id = ? AND device_id = ?'
  ).get(keyRow.id, deviceId || null);

  if (!strategy) {
    return res.json({ exists: false });
  }

  res.json({
    exists: true,
    system_prompt: strategy.system_prompt,
    template: strategy.template,
    few_shots: JSON.parse(strategy.few_shots || '[]'),
    strategy_name: strategy.strategy_name,
    updated_at: strategy.updated_at
  });
});

// ---- 🔮 密钥信息查询（返回展示模型 + 实时加权系数） ----
userApp.get('/api/v1/key-info', (req, res) => {
  const db = getDB();
  const accessKey = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const deviceId = req.headers['x-device-id'] || '';

  if (!accessKey) {
    return res.status(401).json({ error: 'Missing Access Key' });
  }

  const keyRow = db.prepare('SELECT * FROM access_keys WHERE key_value = ?').get(accessKey);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid Access Key' });
  }

  // 🔮 心跳：更新设备在线时间
  if (deviceId) {
    const existingDevice = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
    if (!existingDevice) {
      db.prepare('INSERT INTO devices (device_id, access_key, bound_at, last_online) VALUES (?, ?, ?, ?)').run(
        deviceId, accessKey, nowISO(), nowISO()
      );
    } else if (existingDevice.access_key !== accessKey) {
      db.prepare('UPDATE devices SET access_key = ?, bound_at = ?, last_online = ? WHERE device_id = ?').run(
        accessKey, nowISO(), nowISO(), deviceId
      );
    } else {
      db.prepare('UPDATE devices SET last_online = ? WHERE device_id = ?').run(nowISO(), deviceId);
    }
  }

  // 获取当前时间加权系数
  const timeMultiplier = getCurrentTimeMultiplier(db, keyRow.real_api_key_id);

  // 获取该真实密钥下的所有展示模型
  const models = db.prepare(
    'SELECT display_name, base_rate, description FROM real_key_models WHERE real_api_key_id = ?'
  ).all(keyRow.real_api_key_id);

  res.json({
    key_value: keyRow.key_value,
    name: keyRow.name,
    credits_balance: keyRow.credits_balance,
    is_active: keyRow.is_active,
    total_calls: keyRow.total_calls,
    created_at: keyRow.created_at,
    current_time_weight: timeMultiplier,
    models: models.map(m => ({
      display_name: m.display_name,
      base_rate: m.base_rate,
      description: m.description
    }))
  });
});

// ===================== 管理员后台服务（端口 8080） =====================
const adminApp = express();
adminApp.use(cors());
adminApp.use(express.json({ limit: '10mb' }));

const path = require('path');
adminApp.use(express.static(path.join(__dirname, '..', 'admin')));

// ---- 管理员登录 ----
adminApp.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const db = getDB();

  const setting = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_password'").get();
  const storedPassword = setting ? setting.value : ADMIN_PASSWORD;

  if (password !== storedPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = signAdminJWT({ role: 'admin', login_at: nowISO() });
  res.json({ token, expires_in: '12h' });
});

adminApp.use('/api/admin', adminAuthMiddleware);

// ---- 仪表盘数据 ----
adminApp.get('/api/admin/dashboard', (req, res) => {
  const db = getDB();

  const activeKeys = db.prepare('SELECT COUNT(*) as count FROM access_keys WHERE is_active = 1').get();
  const totalKeys = db.prepare('SELECT COUNT(*) as count FROM access_keys').get();

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const onlineDevices = db.prepare(
    'SELECT COUNT(DISTINCT device_id) as count FROM devices WHERE last_online >= ?'
  ).get(fiveMinAgo);

  const totalDevices = db.prepare('SELECT COUNT(*) as count FROM devices').get();

  const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
  const todayUsage = db.prepare(
    "SELECT COALESCE(SUM(credits_used), 0) as total FROM usage_logs WHERE status = 'success' AND created_at >= ?"
  ).get(todayStart);

  const totalCreditsAssigned = db.prepare('SELECT COALESCE(SUM(credits_balance), 0) as total FROM access_keys').get();

  const recentLogs = db.prepare(`
    SELECT ul.*, ak.name as key_name, ak.key_value
    FROM usage_logs ul
    LEFT JOIN access_keys ak ON ul.access_key_id = ak.id
    ORDER BY ul.created_at DESC
    LIMIT 20
  `).all();

  res.json({
    active_keys: activeKeys.count,
    total_keys: totalKeys.count,
    online_devices: onlineDevices.count,
    total_devices: totalDevices.count,
    today_credits_used: todayUsage.total,
    total_credits_assigned: totalCreditsAssigned.total,
    recent_logs: recentLogs
  });
});

// ---- 获取所有 Access Keys ----
adminApp.get('/api/admin/access-keys', (req, res) => {
  const db = getDB();
  const keys = db.prepare(`
    SELECT ak.*, rak.name as real_key_name, rak.base_url,
      (SELECT COUNT(DISTINCT device_id) FROM devices WHERE access_key = ak.key_value) as device_count
    FROM access_keys ak
    LEFT JOIN real_api_keys rak ON ak.real_api_key_id = rak.id
    ORDER BY ak.created_at DESC
  `).all();
  res.json(keys);
});

// ---- 创建 Access Key ----
adminApp.post('/api/admin/access-keys', (req, res) => {
  const db = getDB();
  const { name, real_api_key_id, initial_credits, is_active } = req.body;

  if (!real_api_key_id) {
    return res.status(400).json({ error: 'real_api_key_id is required' });
  }

  const keyValue = generateAccessKey();
  const result = db.prepare(`
    INSERT INTO access_keys (key_value, name, real_api_key_id, credits_balance, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(keyValue, name || 'Untitled Key', real_api_key_id, initial_credits || 1000, is_active !== false ? 1 : 0, nowISO());

  res.json({
    id: result.lastInsertRowid,
    key_value: keyValue,
    name: name || 'Untitled Key',
    credits_balance: initial_credits || 1000,
    is_active: is_active !== false ? 1 : 0
  });
});

// ---- 更新 Access Key ----
adminApp.put('/api/admin/access-keys/:id', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { name, real_api_key_id, credits_balance, is_active } = req.body;

  const existing = db.prepare('SELECT * FROM access_keys WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Access Key not found' });
  }

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (real_api_key_id !== undefined) { updates.push('real_api_key_id = ?'); params.push(real_api_key_id); }
  if (credits_balance !== undefined) { updates.push('credits_balance = ?'); params.push(credits_balance); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE access_keys SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM access_keys WHERE id = ?').get(id);
  res.json(updated);
});

// ---- 删除 Access Key ----
adminApp.delete('/api/admin/access-keys/:id', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  db.prepare('DELETE FROM access_keys WHERE id = ?').run(id);
  res.json({ deleted: true });
});

// ==================== 🕒 时间加权规则 CRUD ====================

adminApp.get('/api/admin/time-weight-rules', (req, res) => {
  const db = getDB();
  const rules = db.prepare('SELECT * FROM time_weight_rules ORDER BY id').all();
  res.json(rules);
});

adminApp.post('/api/admin/time-weight-rules', (req, res) => {
  const db = getDB();
  const { name, start_time, end_time, multiplier, description } = req.body;

  if (!name || !start_time || !end_time || multiplier === undefined) {
    return res.status(400).json({ error: 'name, start_time, end_time, multiplier are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO time_weight_rules (name, start_time, end_time, multiplier, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, start_time, end_time, multiplier, description || '');
    res.json({ id: result.lastInsertRowid, name, start_time, end_time, multiplier, description });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '规则名称已存在' });
    }
    throw err;
  }
});

adminApp.put('/api/admin/time-weight-rules/:id', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { name, start_time, end_time, multiplier, description } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (start_time !== undefined) { updates.push('start_time = ?'); params.push(start_time); }
  if (end_time !== undefined) { updates.push('end_time = ?'); params.push(end_time); }
  if (multiplier !== undefined) { updates.push('multiplier = ?'); params.push(multiplier); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE time_weight_rules SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  res.json({ updated: true });
});

adminApp.delete('/api/admin/time-weight-rules/:id', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  db.prepare('DELETE FROM time_weight_rules WHERE id = ?').run(id);
  res.json({ deleted: true });
});

// ==================== 🛡️ 真实 API 密钥 CRUD ====================

adminApp.get('/api/admin/real-api-keys', (req, res) => {
  const db = getDB();
  const keys = db.prepare(`
    SELECT rak.*, twr.name as time_weight_rule_name, twr.multiplier as time_weight_multiplier,
      (SELECT COUNT(*) FROM real_key_models WHERE real_api_key_id = rak.id) as model_count
    FROM real_api_keys rak
    LEFT JOIN time_weight_rules twr ON rak.time_weight_rule_id = twr.id
    ORDER BY rak.created_at DESC
  `).all();

  const masked = keys.map(k => ({
    ...k,
    api_key: k.api_key ? k.api_key.substring(0, 8) + '****' + k.api_key.substring(k.api_key.length - 4) : ''
  }));
  res.json(masked);
});

adminApp.post('/api/admin/real-api-keys', (req, res) => {
  const db = getDB();
  const { name, api_key, base_url, time_weight_rule_id, auto_associate } = req.body;

  if (!api_key) {
    return res.status(400).json({ error: 'api_key is required' });
  }

  const result = db.prepare(`
    INSERT INTO real_api_keys (name, api_key, base_url, time_weight_rule_id, auto_associate, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name || 'Default', api_key, base_url || DEFAULT_DEEPSEEK_BASE, time_weight_rule_id || null, auto_associate ? 1 : 0, nowISO());

  const newId = result.lastInsertRowid;

  // 不再自动注入默认模型——管理员在编辑界面中自行添加

  res.json({ id: newId, name: name || 'Default', base_url: base_url || DEFAULT_DEEPSEEK_BASE });
});

adminApp.put('/api/admin/real-api-keys/:id', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { name, api_key, base_url, time_weight_rule_id, auto_associate } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (api_key !== undefined) { updates.push('api_key = ?'); params.push(api_key); }
  if (base_url !== undefined) { updates.push('base_url = ?'); params.push(base_url); }
  if (time_weight_rule_id !== undefined) { updates.push('time_weight_rule_id = ?'); params.push(time_weight_rule_id); }
  if (auto_associate !== undefined) { updates.push('auto_associate = ?'); params.push(auto_associate ? 1 : 0); }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE real_api_keys SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  res.json({ updated: true });
});

adminApp.delete('/api/admin/real-api-keys/:id', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const refCount = db.prepare('SELECT COUNT(*) as count FROM access_keys WHERE real_api_key_id = ?').get(id);
  if (refCount.count > 0) {
    return res.status(400).json({ error: `Cannot delete: ${refCount.count} access key(s) still reference this real API key` });
  }
  db.prepare('DELETE FROM real_api_keys WHERE id = ?').run(id);
  res.json({ deleted: true });
});

// ==================== 🔮 展示模型管理（嵌套在 Real API Key 下） ====================

adminApp.get('/api/admin/real-api-keys/:id/models', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const models = db.prepare('SELECT * FROM real_key_models WHERE real_api_key_id = ? ORDER BY id').all(id);
  res.json(models);
});

adminApp.post('/api/admin/real-api-keys/:id/models', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { display_name, upstream_model, base_rate, description } = req.body;

  if (!display_name || !upstream_model) {
    return res.status(400).json({ error: 'display_name and upstream_model are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO real_key_models (real_api_key_id, display_name, upstream_model, base_rate, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, display_name, upstream_model, base_rate || 1, description || '');
    res.json({ id: result.lastInsertRowid, display_name, upstream_model, base_rate });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `展示模型 "${display_name}" 在此密钥下已存在` });
    }
    throw err;
  }
});

adminApp.put('/api/admin/real-key-models/:modelId', (req, res) => {
  const db = getDB();
  const { modelId } = req.params;
  const { display_name, upstream_model, base_rate, description } = req.body;

  const updates = [];
  const params = [];
  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (upstream_model !== undefined) { updates.push('upstream_model = ?'); params.push(upstream_model); }
  if (base_rate !== undefined) { updates.push('base_rate = ?'); params.push(base_rate); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }

  if (updates.length > 0) {
    params.push(modelId);
    db.prepare(`UPDATE real_key_models SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  res.json({ updated: true });
});

adminApp.delete('/api/admin/real-key-models/:modelId', (req, res) => {
  const db = getDB();
  const { modelId } = req.params;
  db.prepare('DELETE FROM real_key_models WHERE id = ?').run(modelId);
  res.json({ deleted: true });
});

// ---- 获取用户策略（审计） ----
adminApp.get('/api/admin/strategies', (req, res) => {
  const db = getDB();
  const strategies = db.prepare(`
    SELECT us.*, ak.name as key_name, ak.key_value
    FROM user_strategies us
    LEFT JOIN access_keys ak ON us.access_key_id = ak.id
    ORDER BY us.updated_at DESC
  `).all();

  const parsed = strategies.map(s => ({
    ...s,
    few_shots: JSON.parse(s.few_shots || '[]')
  }));

  res.json(parsed);
});

adminApp.put('/api/admin/strategies/:id', (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { system_prompt, template, few_shots } = req.body;

  const updates = [];
  const params = [];
  if (system_prompt !== undefined) { updates.push('system_prompt = ?'); params.push(system_prompt); }
  if (template !== undefined) { updates.push('template = ?'); params.push(template); }
  if (few_shots !== undefined) { updates.push('few_shots = ?'); params.push(JSON.stringify(few_shots)); }

  if (updates.length > 0) {
    updates.push("updated_at = ?");
    params.push(nowISO());
    params.push(id);
    db.prepare(`UPDATE user_strategies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  res.json({ updated: true });
});

// ---- 获取设备列表 ----
adminApp.get('/api/admin/devices', (req, res) => {
  const db = getDB();
  const devices = db.prepare(`
    SELECT d.*, ak.name as key_name
    FROM devices d
    LEFT JOIN access_keys ak ON d.access_key = ak.key_value
    ORDER BY d.last_online DESC
  `).all();
  res.json(devices);
});

// ---- 获取消费日志 ----
adminApp.get('/api/admin/usage-logs', (req, res) => {
  const db = getDB();
  const { limit = 100, offset = 0 } = req.query;
  const logs = db.prepare(`
    SELECT ul.*, ak.name as key_name, ak.key_value
    FROM usage_logs ul
    LEFT JOIN access_keys ak ON ul.access_key_id = ak.id
    ORDER BY ul.created_at DESC
    LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset));

  const total = db.prepare('SELECT COUNT(*) as count FROM usage_logs').get();
  res.json({ logs, total: total.count });
});

// ---- 修改管理员密码 ----
adminApp.put('/api/admin/settings', (req, res) => {
  const db = getDB();
  const { admin_password } = req.body;
  if (admin_password) {
    db.prepare("UPDATE admin_settings SET value = ? WHERE key = 'admin_password'").run(admin_password);
  }
  res.json({ updated: true });
});

// ---- 获取设置 ----
adminApp.get('/api/admin/settings', (req, res) => {
  const db = getDB();
  const settings = db.prepare("SELECT * FROM admin_settings").all();
  const result = {};
  settings.forEach(s => {
    if (s.key === 'admin_password') {
      result[s.key] = '********';
    } else {
      result[s.key] = s.value;
    }
  });
  res.json(result);
});

// ---- 数据导出 ----
adminApp.get('/api/admin/export', (req, res) => {
  const db = getDB();
  const data = exportAllData(db);
  const json = JSON.stringify(data, null, 2);
  res.set('Content-Type', 'application/json');
  res.set('Content-Disposition', `attachment; filename="alchemist-backup-${new Date().toISOString().split('T')[0]}.json"`);
  res.send(json);
});

// ---- 数据导入 ----
adminApp.post('/api/admin/import', (req, res) => {
  const db = getDB();
  const { data } = req.body;

  if (!data) {
    return res.status(400).json({ error: 'Missing data field in request body' });
  }

  try {
    const result = importAllData(db, data);
    res.json({
      status: 'ok',
      message: '数据导入成功',
      tables_imported: result.imported_tables.length,
      details: result.imported_tables
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===================== 启动服务 =====================

userApp.listen(USER_API_PORT, () => {
  console.log(`🔮 Alchemist User API  running on http://localhost:${USER_API_PORT}`);
  console.log(`   → POST /api/v1/chat/completions  (AI relay with model masking)`);
  console.log(`   → POST /api/v1/sync-strategy      (strategy sync)`);
  console.log(`   → GET  /api/v1/strategy           (fetch strategy)`);
  console.log(`   → GET  /api/v1/key-info           (key info + models + time weight)`);
  console.log(`   → GET  /api/health                 (health check)`);
});

adminApp.listen(ADMIN_PORT, () => {
  console.log(`🛡️  Alchemist Admin Panel on http://localhost:${ADMIN_PORT}`);
  console.log(`   → Default password: ${ADMIN_PASSWORD}`);
  console.log(`   → GET  /api/admin/export  (data backup)`);
  console.log(`   → POST /api/admin/import  (data restore)`);
});

console.log('');
console.log('📋 快速开始:');
console.log('   1. 打开 http://localhost:8080 进入管理后台');
console.log('   2. 使用默认密码登录，添加 Real API Key (DeepSeek)');
console.log('   3. 配置展示模型 (display model → upstream model mapping)');
console.log('   4. 可选：创建时间加权规则并应用到密钥');
console.log('   5. 生成 Access Key 并分发给用户');
