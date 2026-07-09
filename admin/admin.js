// ================= Alchemist Admin Dashboard Logic v2.0 =================

const API_BASE = '';
let authToken = localStorage.getItem('alchemist_admin_token');
let currentLogOffset = 0;
let currentEditRealKeyId = null;

// ===================== 初始化 =====================
window.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    verifyAndEnter(authToken);
  }
});

async function verifyAndEnter(token) {
  try {
    const r = await fetch('/api/admin/dashboard', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (r.ok) {
      authToken = token;
      localStorage.setItem('alchemist_admin_token', token);
      enterApp();
    } else {
      localStorage.removeItem('alchemist_admin_token');
      authToken = null;
    }
  } catch {}
}

// ===================== 登录 =====================
async function doLogin() {
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const errorEl = document.getElementById('loginError');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 登录中...';
  errorEl.classList.add('hidden');

  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await r.json();
    if (r.ok && data.token) {
      authToken = data.token;
      localStorage.setItem('alchemist_admin_token', data.token);
      enterApp();
    } else {
      errorEl.textContent = data.error || '密码错误';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = '无法连接服务器：' + err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> 登录控制台';
  }
}

function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  switchTab('dashboard');
  loadDashboard();
}

function doLogout() {
  localStorage.removeItem('alchemist_admin_token');
  authToken = null;
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
  document.getElementById('loginPassword').value = '';
}

// ===================== API 请求封装 =====================
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
    ...options.headers
  };
  const r = await fetch(path, { ...options, headers });
  if (r.status === 401) {
    doLogout();
    throw new Error('Session expired');
  }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ===================== Toast 提示 =====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const colors = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    error: 'bg-red-50 border-red-200 text-red-700',
    info: 'bg-indigo-50 border-indigo-200 text-indigo-700'
  };
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    info: 'fa-circle-info'
  };
  const el = document.createElement('div');
  el.className = `toast-in ${colors[type]} border px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2`;
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i> ${message}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ===================== Tab 切换 =====================
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const tabEl = document.getElementById(`tab-${tabName}`);
  if (tabEl) tabEl.classList.remove('hidden');

  const navEl = document.querySelector(`[data-tab="${tabName}"]`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard: '📊 仪表盘',
    keys: '🔑 密钥管理',
    realKeys: '🛡️ 真实 API 密钥',
    timeWeight: '🕒 时间加权规则',
    strategies: '🧠 策略审计',
    devices: '📱 在线设备',
    logs: '📋 消费日志',
    settings: '⚙️ 系统设置'
  };
  document.getElementById('tabTitle').textContent = titles[tabName] || tabName;

  switch (tabName) {
    case 'dashboard': loadDashboard(); break;
    case 'keys': loadAccessKeys(); break;
    case 'realKeys': loadRealApiKeys(); break;
    case 'timeWeight': loadTimeWeightRules(); break;
    case 'strategies': loadStrategies(); break;
    case 'devices': loadDevices(); break;
    case 'logs': loadLogs(0); break;
  }
}

// ===================== 仪表盘 =====================
async function loadDashboard() {
  try {
    const data = await api('/api/admin/dashboard');
    document.getElementById('statActiveKeys').textContent = data.active_keys;
    document.getElementById('statTotalKeys').textContent = data.total_keys + ' 总数';
    document.getElementById('statOnlineDevices').textContent = data.online_devices;
    document.getElementById('statTotalDevices').textContent = data.total_devices + ' 历史总数';
    document.getElementById('statTodayCredits').textContent = data.today_credits_used;
    document.getElementById('statTotalCredits').textContent = data.total_credits_assigned;

    const tbody = document.getElementById('dashboardLogsBody');
    tbody.innerHTML = (data.recent_logs || []).slice(0, 10).map(log => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-4 py-2.5 text-slate-500 font-mono text-[0.7rem]">${fmtTime(log.created_at)}</td>
        <td class="px-4 py-2.5 font-medium text-slate-700">${esc(log.key_name || log.key_value || '—')}</td>
        <td class="px-4 py-2.5 font-mono text-[0.7rem] text-slate-500">${esc(log.model)}</td>
        <td class="px-4 py-2.5 font-semibold ${log.credits_used > 0 ? 'text-orange-600' : 'text-slate-400'}">${log.credits_used}</td>
        <td class="px-4 py-2.5 text-slate-400">${log.time_weight ? '×' + log.time_weight : '—'}</td>
        <td class="px-4 py-2.5">${statusBadge(log.status)}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">暂无记录</td></tr>';
  } catch (err) {
    showToast('加载仪表盘失败: ' + err.message, 'error');
  }
}

// ===================== Access Keys 管理 =====================
async function loadAccessKeys() {
  try {
    const keys = await api('/api/admin/access-keys');
    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = keys.map(k => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-4 py-3 font-medium text-slate-700">${esc(k.name)}</td>
        <td class="px-4 py-3 font-mono text-xs text-indigo-600">${esc(k.key_value)}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${esc(k.real_key_name || '—')}</td>
        <td class="px-4 py-3 text-right font-bold font-mono ${k.credits_balance <= 0 ? 'text-red-500' : k.credits_balance < 100 ? 'text-orange-500' : 'text-emerald-600'}">${k.credits_balance}</td>
        <td class="px-4 py-3 text-right text-slate-500">${k.total_calls}</td>
        <td class="px-4 py-3 text-center">${k.is_active ? '<span class="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full text-xs font-medium"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>活跃</span>' : '<span class="inline-flex items-center gap-1 text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full text-xs font-medium">已禁用</span>'}</td>
        <td class="px-4 py-3 text-center text-slate-500">${k.device_count || 0}</td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="editKeyCredits(${k.id}, ${k.credits_balance})" class="text-xs px-2 py-1 bg-amber-50 text-amber-600 rounded hover:bg-amber-100 transition-all" title="修改积分"><i class="fa-solid fa-pen"></i></button>
            <button onclick="toggleKeyActive(${k.id}, ${k.is_active})" class="text-xs px-2 py-1 ${k.is_active ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'} rounded transition-all" title="${k.is_active ? '禁用' : '启用'}"><i class="fa-solid ${k.is_active ? 'fa-ban' : 'fa-check'}"></i></button>
            <button onclick="deleteAccessKey(${k.id}, '${esc(k.name)}')" class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 transition-all" title="删除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">暂无密钥，请先生成一个</td></tr>';
  } catch (err) {
    showToast('加载密钥失败: ' + err.message, 'error');
  }
}

async function showCreateKeyModal() {
  document.getElementById('createKeyModal').classList.remove('hidden');
  try {
    const keys = await api('/api/admin/real-api-keys');
    const select = document.getElementById('newKeyRealApiId');
    select.innerHTML = keys.map(k => `<option value="${k.id}">${esc(k.name)} (${esc(k.base_url)})</option>`).join('');
    if (keys.length === 0) {
      select.innerHTML = '<option value="">⚠️ 请先添加真实 API Key</option>';
    }
  } catch (err) {
    showToast('加载真实密钥列表失败', 'error');
  }
}

async function createAccessKey() {
  const name = document.getElementById('newKeyName').value.trim() || 'Untitled';
  const real_api_key_id = parseInt(document.getElementById('newKeyRealApiId').value);
  const initial_credits = parseInt(document.getElementById('newKeyCredits').value) || 1000;
  const is_active = document.getElementById('newKeyActive').checked;

  if (!real_api_key_id) {
    showToast('请先添加并选择真实 API Key', 'error');
    return;
  }

  try {
    const result = await api('/api/admin/access-keys', {
      method: 'POST',
      body: JSON.stringify({ name, real_api_key_id, initial_credits, is_active })
    });
    closeModal('createKeyModal');
    showToast(`密钥已生成: ${result.key_value}`, 'success');
    loadAccessKeys();
    try {
      await navigator.clipboard.writeText(result.key_value);
      showToast('密钥已自动复制到剪贴板!', 'info');
    } catch {}
  } catch (err) {
    showToast('创建失败: ' + err.message, 'error');
  }
}

async function editKeyCredits(id, currentCredits) {
  const newCredits = prompt('修改积分余额（当前: ' + currentCredits + '）:', currentCredits);
  if (newCredits === null) return;
  const val = parseFloat(newCredits);
  if (isNaN(val) || val < 0) {
    showToast('请输入有效的非负数字', 'error');
    return;
  }
  try {
    await api(`/api/admin/access-keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ credits_balance: val })
    });
    showToast('积分已更新', 'success');
    loadAccessKeys();
  } catch (err) {
    showToast('更新失败: ' + err.message, 'error');
  }
}

async function toggleKeyActive(id, currentActive) {
  try {
    await api(`/api/admin/access-keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !currentActive })
    });
    showToast(currentActive ? '密钥已禁用' : '密钥已启用', 'success');
    loadAccessKeys();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function deleteAccessKey(id, name) {
  if (!confirm(`确定删除密钥「${name}」吗？此操作不可撤销。`)) return;
  try {
    await api(`/api/admin/access-keys/${id}`, { method: 'DELETE' });
    showToast('密钥已删除', 'success');
    loadAccessKeys();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

// ==================== 🕒 时间加权规则 CRUD ====================

async function loadTimeWeightRules() {
  try {
    const rules = await api('/api/admin/time-weight-rules');
    const tbody = document.getElementById('timeWeightTableBody');
    tbody.innerHTML = rules.map(r => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-4 py-3 font-medium text-slate-700">${esc(r.name)}</td>
        <td class="px-4 py-3 font-mono text-sm text-indigo-600">${r.start_time}</td>
        <td class="px-4 py-3 font-mono text-sm text-indigo-600">${r.end_time}</td>
        <td class="px-4 py-3 text-right"><span class="model-pill ${r.multiplier < 1 ? 'bg-emerald-50 text-emerald-700' : r.multiplier > 1 ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-600'}">×${r.multiplier}</span></td>
        <td class="px-4 py-3 text-xs text-slate-500">${esc(r.description || '—')}</td>
        <td class="px-4 py-3 text-right">
          <button onclick="showEditTimeWeightModal(${r.id})" class="text-xs px-2 py-1 bg-amber-50 text-amber-600 rounded hover:bg-amber-100 transition-all mr-1"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deleteTimeWeightRule(${r.id}, '${esc(r.name)}')" class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 transition-all"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">暂无时间加权规则，请创建一个</td></tr>';
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function showCreateTimeWeightModal() {
  document.getElementById('createTimeWeightModal').classList.remove('hidden');
  document.getElementById('twModalTitle').textContent = '新建时间加权规则';
  document.getElementById('editTWId').value = '';
  document.getElementById('newTWName').value = '';
  document.getElementById('newTWStart').value = '01:00';
  document.getElementById('newTWEnd').value = '06:00';
  document.getElementById('newTWMultiplier').value = '0.8';
  document.getElementById('newTWDesc').value = '';
}

async function showEditTimeWeightModal(ruleId) {
  try {
    const rules = await api('/api/admin/time-weight-rules');
    const r = rules.find(x => x.id === ruleId);
    if (!r) { showToast('规则未找到', 'error'); return; }

    document.getElementById('createTimeWeightModal').classList.remove('hidden');
    document.getElementById('twModalTitle').textContent = '编辑时间加权规则';
    document.getElementById('editTWId').value = r.id;
    document.getElementById('newTWName').value = r.name;
    document.getElementById('newTWStart').value = r.start_time;
    document.getElementById('newTWEnd').value = r.end_time;
    document.getElementById('newTWMultiplier').value = r.multiplier;
    document.getElementById('newTWDesc').value = r.description || '';
  } catch (err) {
    showToast('加载规则失败: ' + err.message, 'error');
  }
}

async function saveTimeWeightRule() {
  const editId = document.getElementById('editTWId').value;
  const name = document.getElementById('newTWName').value.trim();
  const start_time = document.getElementById('newTWStart').value;
  const end_time = document.getElementById('newTWEnd').value;
  const multiplier = parseFloat(document.getElementById('newTWMultiplier').value);
  const description = document.getElementById('newTWDesc').value.trim();

  if (!name) { showToast('请输入规则名称', 'error'); return; }
  if (!start_time || !end_time) { showToast('请设置开始和结束时间', 'error'); return; }
  if (isNaN(multiplier) || multiplier <= 0) { showToast('加权系数必须大于 0', 'error'); return; }

  try {
    if (editId) {
      await api(`/api/admin/time-weight-rules/${editId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, start_time, end_time, multiplier, description })
      });
      showToast('规则已更新', 'success');
    } else {
      await api('/api/admin/time-weight-rules', {
        method: 'POST',
        body: JSON.stringify({ name, start_time, end_time, multiplier, description })
      });
      showToast('规则已创建', 'success');
    }
    closeModal('createTimeWeightModal');
    loadTimeWeightRules();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteTimeWeightRule(id, name) {
  if (!confirm(`确定删除规则「${name}」吗？`)) return;
  try {
    await api(`/api/admin/time-weight-rules/${id}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    loadTimeWeightRules();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

// ==================== 🛡️ 真实 API 密钥（大改版：卡片式+模型管理） ====================

async function loadRealApiKeys() {
  try {
    const keys = await api('/api/admin/real-api-keys');
    const timeWeightRules = await api('/api/admin/time-weight-rules');
    const container = document.getElementById('realKeysList');

    if (keys.length === 0) {
      container.innerHTML = '<div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">暂无真实 API 密钥，请添加一个</div>';
      return;
    }

    container.innerHTML = keys.map(k => {
      const twLabel = k.time_weight_rule_name
        ? `<span class="model-pill bg-purple-50 text-purple-700"><i class="fa-solid fa-clock"></i> ${esc(k.time_weight_rule_name)} ×${k.time_weight_multiplier}</span>`
        : '<span class="text-xs text-slate-400">无时间加权</span>';

      const autoBadge = k.auto_associate
        ? '<span class="model-pill bg-emerald-50 text-emerald-700"><i class="fa-solid fa-link"></i> 自动关联</span>'
        : '';

      return `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div class="flex items-center gap-3 flex-wrap">
            <span class="font-bold text-slate-700">${esc(k.name)}</span>
            <span class="font-mono text-xs text-slate-400">${esc(k.api_key)}</span>
            <span class="text-xs text-slate-400">${esc(k.base_url)}</span>
            ${twLabel}
            ${autoBadge}
            <span class="text-xs text-slate-400">${k.model_count || 0} 个展示模型</span>
          </div>
          <div class="flex items-center gap-1.5">
            <button onclick="openEditRealKey(${k.id})" class="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium"><i class="fa-solid fa-pen-to-square"></i> 编辑</button>
            <button onclick="deleteRealKey(${k.id}, '${esc(k.name)}')" class="text-xs px-3 py-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 font-medium"><i class="fa-solid fa-trash"></i> 删除</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function showCreateRealKeyModal() {
  document.getElementById('createRealKeyModal').classList.remove('hidden');
  document.getElementById('newRealKeyName').value = '';
  document.getElementById('newRealApiKey').value = '';
  document.getElementById('newRealBaseUrl').value = 'https://api.deepseek.com';
  document.getElementById('newRealAutoAssociate').checked = false;
}

async function createRealApiKey() {
  const name = document.getElementById('newRealKeyName').value.trim() || 'Default';
  const api_key = document.getElementById('newRealApiKey').value.trim();
  const base_url = document.getElementById('newRealBaseUrl').value.trim() || 'https://api.deepseek.com';
  const auto_associate = document.getElementById('newRealAutoAssociate').checked;

  if (!api_key) {
    showToast('请输入 API Key', 'error');
    return;
  }

  try {
    await api('/api/admin/real-api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, api_key, base_url, auto_associate })
    });
    closeModal('createRealKeyModal');
    showToast('真实 API 密钥已保存。请在编辑界面中手动添加展示模型映射', 'success');
    document.getElementById('newRealApiKey').value = '';
    loadRealApiKeys();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function openEditRealKey(id) {
  currentEditRealKeyId = id;
  try {
    const keys = await api('/api/admin/real-api-keys');
    const key = keys.find(k => k.id === id);
    if (!key) { showToast('密钥未找到', 'error'); return; }

    document.getElementById('editRealKeyId').value = key.id;
    document.getElementById('editRealKeyName').value = key.name;
    document.getElementById('editRealBaseUrl').value = key.base_url;
    document.getElementById('editRealApiKey').value = '';
    document.getElementById('editRealAutoAssociate').checked = !!key.auto_associate;

    // 加载时间加权规则下拉
    const rules = await api('/api/admin/time-weight-rules');
    const twSelect = document.getElementById('editRealTimeWeight');
    twSelect.innerHTML = '<option value="">不使用时间加权</option>' +
      rules.map(r => `<option value="${r.id}" ${key.time_weight_rule_id === r.id ? 'selected' : ''}>${esc(r.name)} (${r.start_time}-${r.end_time}, ×${r.multiplier})</option>`).join('');

    // 加载展示模型
    const models = await api(`/api/admin/real-api-keys/${id}/models`);
    renderRealKeyModels(models);

    document.getElementById('editRealKeyModal').classList.remove('hidden');
  } catch (err) {
    showToast('加载编辑表单失败: ' + err.message, 'error');
  }
}

function renderRealKeyModels(models) {
  const container = document.getElementById('editRealKeyModels');
  container.innerHTML = models.map(m => `
    <div class="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
      <span class="font-bold text-indigo-600 text-sm min-w-[120px]">🔮 ${esc(m.display_name)}</span>
      <i class="fa-solid fa-arrow-right text-slate-300 text-xs"></i>
      <span class="font-mono text-xs text-slate-500 flex-1">${esc(m.upstream_model)}</span>
      <span class="text-xs font-semibold text-slate-600">${m.base_rate} 积分/次</span>
      <span class="text-xs text-slate-400 hidden sm:inline">${esc(m.description || '')}</span>
      <button onclick="showModelFormModal(${m.id})" class="text-xs px-2 py-1 bg-amber-50 text-amber-600 rounded hover:bg-amber-100" title="编辑"><i class="fa-solid fa-pen"></i></button>
      <button onclick="deleteRealKeyModel(${m.id}, '${esc(m.display_name)}')" class="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100" title="删除"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('') || '<p class="text-xs text-slate-400 py-2">暂无展示模型，请点击「添加模型」按钮手动创建</p>';
}

// ==================== 🔮 展示模型表单（新增/编辑共用） ====================

async function showModelFormModal(modelId) {
  if (!currentEditRealKeyId) return;

  const modal = document.getElementById('modelFormModal');
  const title = document.getElementById('modelFormTitle');

  if (modelId) {
    // 编辑模式：从 API 加载已有数据
    title.textContent = '编辑展示模型';
    document.getElementById('modelFormId').value = modelId;
    try {
      const models = await api(`/api/admin/real-api-keys/${currentEditRealKeyId}/models`);
      const m = models.find(x => x.id === modelId);
      if (m) {
        document.getElementById('modelFormDisplayName').value = m.display_name;
        document.getElementById('modelFormUpstream').value = m.upstream_model;
        document.getElementById('modelFormBaseRate').value = m.base_rate;
        document.getElementById('modelFormDesc').value = m.description || '';
      }
    } catch (err) {
      showToast('加载模型数据失败: ' + err.message, 'error');
      return;
    }
  } else {
    // 新增模式
    title.textContent = '添加展示模型';
    document.getElementById('modelFormId').value = '';
    document.getElementById('modelFormDisplayName').value = '';
    document.getElementById('modelFormUpstream').value = '';
    document.getElementById('modelFormBaseRate').value = '1';
    document.getElementById('modelFormDesc').value = '';
  }

  modal.classList.remove('hidden');
}

async function saveModelForm() {
  const modelId = document.getElementById('modelFormId').value;
  const display_name = document.getElementById('modelFormDisplayName').value.trim();
  const upstream_model = document.getElementById('modelFormUpstream').value.trim();
  const base_rate = parseFloat(document.getElementById('modelFormBaseRate').value);
  const description = document.getElementById('modelFormDesc').value.trim();

  if (!display_name) { showToast('请输入展示模型名称', 'error'); return; }
  if (!upstream_model) { showToast('请输入真实上游模型名', 'error'); return; }
  if (isNaN(base_rate) || base_rate <= 0) { showToast('请输入有效的积分值（>0）', 'error'); return; }

  try {
    if (modelId) {
      // 编辑
      await api(`/api/admin/real-key-models/${modelId}`, {
        method: 'PUT',
        body: JSON.stringify({ display_name, upstream_model, base_rate, description })
      });
      showToast('模型已更新', 'success');
    } else {
      // 新增
      await api(`/api/admin/real-api-keys/${currentEditRealKeyId}/models`, {
        method: 'POST',
        body: JSON.stringify({ display_name, upstream_model, base_rate, description })
      });
      showToast('展示模型已添加', 'success');
    }
    closeModal('modelFormModal');
    const models = await api(`/api/admin/real-api-keys/${currentEditRealKeyId}/models`);
    renderRealKeyModels(models);
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteRealKeyModel(modelId, displayName) {
  if (!confirm(`确定删除展示模型「${displayName}」吗？`)) return;
  try {
    await api(`/api/admin/real-key-models/${modelId}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    const models = await api(`/api/admin/real-api-keys/${currentEditRealKeyId}/models`);
    renderRealKeyModels(models);
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

async function saveRealKeyEdit() {
  const id = document.getElementById('editRealKeyId').value;
  const name = document.getElementById('editRealKeyName').value.trim();
  const base_url = document.getElementById('editRealBaseUrl').value.trim();
  const api_key = document.getElementById('editRealApiKey').value.trim();
  const time_weight_rule_id = document.getElementById('editRealTimeWeight').value || null;
  const auto_associate = document.getElementById('editRealAutoAssociate').checked;

  const body = { name, base_url, auto_associate };
  if (api_key) body.api_key = api_key;
  body.time_weight_rule_id = time_weight_rule_id === '' ? null : parseInt(time_weight_rule_id);

  try {
    await api(`/api/admin/real-api-keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    closeModal('editRealKeyModal');
    showToast('已保存', 'success');
    loadRealApiKeys();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteRealKey(id, name) {
  if (!confirm(`确定删除真实 API 密钥「${name}」吗？`)) return;
  try {
    await api(`/api/admin/real-api-keys/${id}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    loadRealApiKeys();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

// ===================== 策略审计 =====================
async function loadStrategies() {
  try {
    const strategies = await api('/api/admin/strategies');
    const container = document.getElementById('strategiesList');
    if (strategies.length === 0) {
      container.innerHTML = '<div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">暂无策略数据 — 用户开始使用后会自动同步</div>';
      return;
    }
    container.innerHTML = strategies.map(s => `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div class="flex items-center gap-3">
            <span class="font-bold text-slate-700 text-sm">${esc(s.strategy_name || '未命名策略')}</span>
            <span class="text-xs text-slate-400">→</span>
            <span class="text-xs font-medium text-white bg-indigo-600 px-2.5 py-0.5 rounded-full">${esc(s.key_name || 'Unknown')}</span>
            <span class="text-xs font-mono text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">${esc(s.key_value || '—')}</span>
            <span class="text-xs text-slate-400">${fmtTime(s.updated_at)}</span>
          </div>
          <button onclick="openStrategyEdit(${s.id}, '${esc((s.system_prompt||'').replace(/'/g, "\\'").replace(/\n/g, '\\n'))}', '${esc((s.template||'').replace(/'/g, "\\'").replace(/\n/g, '\\n'))}', '${esc(JSON.stringify(s.few_shots).replace(/'/g, "\\'"))}')" class="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-all font-medium"><i class="fa-solid fa-pen-to-square"></i> 编辑</button>
        </div>
        <div class="p-5 space-y-3">
          <div>
            <span class="text-[0.65rem] font-semibold text-slate-400 uppercase tracking-wider">System Prompt</span>
            <pre class="mt-1 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">${esc(s.system_prompt || '(空)')}</pre>
          </div>
          <div>
            <span class="text-[0.65rem] font-semibold text-slate-400 uppercase tracking-wider">Template</span>
            <pre class="mt-1 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg max-h-24 overflow-y-auto whitespace-pre-wrap font-mono">${esc(s.template || '(空)')}</pre>
          </div>
          <div>
            <span class="text-[0.65rem] font-semibold text-slate-400 uppercase tracking-wider">Few-Shot 样本 (${(s.few_shots || []).length} 个)</span>
            <div class="mt-1 space-y-1.5 max-h-40 overflow-y-auto">
              ${(s.few_shots || []).map((fs, i) => `
                <div class="bg-slate-50 p-2.5 rounded-lg text-xs">
                  <span class="font-semibold text-indigo-500">#${i + 1}</span>
                  <div class="mt-1 grid grid-cols-2 gap-2">
                    <div><span class="text-slate-400">User:</span> <span class="text-slate-600">${esc((fs.user || '').substring(0, 80))}${(fs.user || '').length > 80 ? '...' : ''}</span></div>
                    <div><span class="text-slate-400">Assistant:</span> <span class="text-slate-600">${esc((fs.assistant || '').substring(0, 80))}${(fs.assistant || '').length > 80 ? '...' : ''}</span></div>
                  </div>
                </div>
              `).join('') || '<p class="text-slate-400">无样本</p>'}
            </div>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    showToast('加载策略失败: ' + err.message, 'error');
  }
}

let editingStrategyId = null;

function openStrategyEdit(id, systemPrompt, template, fewShotsStr) {
  editingStrategyId = id;
  document.getElementById('editStrategyId').value = id;
  document.getElementById('editStrategySystem').value = systemPrompt.replace(/\\n/g, '\n');
  document.getElementById('editStrategyTemplate').value = template.replace(/\\n/g, '\n');

  try {
    const parsed = JSON.parse(fewShotsStr.replace(/\\'/g, "'"));
    document.getElementById('editStrategyFewShots').value = JSON.stringify(parsed, null, 2);
  } catch {
    document.getElementById('editStrategyFewShots').value = fewShotsStr;
  }

  document.getElementById('editStrategyModal').classList.remove('hidden');
}

async function saveStrategyEdit() {
  const id = document.getElementById('editStrategyId').value;
  const system_prompt = document.getElementById('editStrategySystem').value;
  const template = document.getElementById('editStrategyTemplate').value;
  const fewShotsRaw = document.getElementById('editStrategyFewShots').value;

  let few_shots;
  try {
    few_shots = JSON.parse(fewShotsRaw);
    if (!Array.isArray(few_shots)) throw new Error('Not an array');
  } catch {
    showToast('Few-Shot JSON 格式错误，需为数组', 'error');
    return;
  }

  try {
    await api(`/api/admin/strategies/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ system_prompt, template, few_shots })
    });
    closeModal('editStrategyModal');
    showToast('策略已更新', 'success');
    loadStrategies();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

// ===================== 设备 =====================
async function loadDevices() {
  try {
    const devices = await api('/api/admin/devices');
    const tbody = document.getElementById('devicesTableBody');
    tbody.innerHTML = devices.map(d => {
      const isOnline = new Date(d.last_online).getTime() > Date.now() - 5 * 60 * 1000;
      return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="px-4 py-3 font-mono text-xs text-slate-600">${esc(d.device_id)}</td>
          <td class="px-4 py-3 font-mono text-xs text-indigo-600">${esc(d.access_key)}</td>
          <td class="px-4 py-3 text-sm text-slate-600">${esc(d.key_name || '—')}</td>
          <td class="px-4 py-3 text-xs text-slate-400">${fmtTime(d.bound_at)}</td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center gap-1.5 ${isOnline ? 'text-emerald-600' : 'text-slate-400'}">
              <span class="w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 pulse-dot' : 'bg-slate-300'}"></span>
              ${isOnline ? '在线' : fmtTime(d.last_online)}
            </span>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">暂无设备记录</td></tr>';
  } catch (err) {
    showToast('加载设备失败: ' + err.message, 'error');
  }
}

// ===================== 消费日志 =====================
async function loadLogs(offset = 0) {
  currentLogOffset = offset;
  try {
    const data = await api(`/api/admin/usage-logs?limit=100&offset=${offset}`);
    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = data.logs.map(log => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-4 py-2.5 text-slate-500 font-mono text-[0.7rem]">${fmtTime(log.created_at)}</td>
        <td class="px-4 py-2.5 font-medium text-slate-700 text-xs">${esc(log.key_name || log.key_value || '—')}</td>
        <td class="px-4 py-2.5 font-mono text-[0.65rem] text-slate-400 max-w-[120px] truncate" title="${esc(log.device_id || '')}">${esc((log.device_id || '—').substring(0, 12))}</td>
        <td class="px-4 py-2.5 font-mono text-[0.7rem] text-slate-500">${esc(log.model)}</td>
        <td class="px-4 py-2.5 text-right font-semibold ${log.credits_used > 0 ? 'text-orange-600' : 'text-slate-400'}">${log.credits_used}</td>
        <td class="px-4 py-2.5 text-right text-slate-400">${log.time_weight ? '×' + log.time_weight : '—'}</td>
        <td class="px-4 py-2.5 text-right text-slate-400 font-mono text-[0.7rem]">${log.prompt_tokens || 0}</td>
        <td class="px-4 py-2.5 text-right text-slate-400 font-mono text-[0.7rem]">${log.completion_tokens || 0}</td>
        <td class="px-4 py-2.5 text-center">${statusBadge(log.status)}</td>
      </tr>
    `).join('') || '<tr><td colspan="9" class="px-4 py-8 text-center text-slate-400">暂无日志</td></tr>';
    document.getElementById('logsPagination').textContent = `显示 ${offset + 1}-${offset + data.logs.length} / 共 ${data.total} 条`;
  } catch (err) {
    showToast('加载日志失败: ' + err.message, 'error');
  }
}

// ===================== 系统设置 =====================
async function changePassword() {
  const newPassword = document.getElementById('newAdminPassword').value.trim();
  if (!newPassword) {
    showToast('请输入新密码', 'error');
    return;
  }
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ admin_password: newPassword })
    });
    showToast('密码已修改', 'success');
    document.getElementById('newAdminPassword').value = '';
  } catch (err) {
    showToast('修改失败: ' + err.message, 'error');
  }
}

// ===================== 数据备份与恢复 =====================

async function exportBackup() {
  const btn = document.getElementById('btnExportBackup');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 导出中...';
  btn.disabled = true;

  try {
    const r = await fetch('/api/admin/export', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!r.ok) throw new Error('导出失败');

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 从 Content-Disposition 提取文件名，或使用默认名
    const disposition = r.headers.get('Content-Disposition');
    const match = disposition && disposition.match(/filename="?([^"]+)"?/);
    a.download = match ? match[1] : `alchemist-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('数据已导出', 'success');
  } catch (err) {
    showToast('导出失败: ' + err.message, 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function importBackup() {
  const fileInput = document.getElementById('importFileInput');
  const msgEl = document.getElementById('importResultMsg');
  const file = fileInput.files[0];
  if (!file) return;

  if (!confirm(`⚠️ 导入将清空当前数据库并替换为备份文件「${file.name}」的全部数据。确定继续？`)) {
    fileInput.value = '';
    return;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    msgEl.classList.remove('hidden', 'text-red-600', 'text-emerald-600');
    msgEl.classList.add('text-amber-600');
    msgEl.textContent = '⏳ 导入中，请稍候...';

    await api('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify({ data })
    });

    msgEl.classList.remove('text-amber-600');
    msgEl.classList.add('text-emerald-600');
    msgEl.textContent = '✅ 数据恢复成功。建议刷新页面以确保界面同步。';
    showToast('数据已恢复', 'success');
  } catch (err) {
    msgEl.classList.remove('text-amber-600');
    msgEl.classList.add('text-red-600');
    msgEl.textContent = '❌ 导入失败: ' + err.message;
    showToast('导入失败: ' + err.message, 'error');
  } finally {
    fileInput.value = '';
  }
}

// ===================== 工具函数 =====================
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function statusBadge(status) {
  if (status === 'success') {
    return '<span class="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full text-[0.65rem] font-medium">成功</span>';
  } else if (status === 'failed') {
    return '<span class="inline-flex items-center gap-1 text-red-500 bg-red-50 px-2 py-0.5 rounded-full text-[0.65rem] font-medium">失败</span>';
  }
  return `<span class="inline-flex items-center gap-1 text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full text-[0.65rem] font-medium">${esc(status)}</span>`;
}
