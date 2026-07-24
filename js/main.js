
// ================= 全局系统状态 =================
let rawExcelData = [], headers = [], completedResults = {}, failedTasks = [], currentRunLogs = [];
let isRunning = false, forceStopFlag = false;

// 聊天区域引用（由 ui.js 使用）
const chatArea = document.getElementById('chatArea');

// 焦点模式状态
let isFocusMode = false;
let currentFocus = 'center'; // 'left', 'center', 'right'

// 策略存储相关全局变量
let currentStrategies = [], activeStrategyId = null, isSyncingUI = false, saveTimeout = null;
const STORE_KEY = 'Alchemist_V7';

// 设备 ID（用于后端绑定与审计）
let DEVICE_ID = null;
const DEVICE_ID_KEY = 'Alchemist_Device_ID';

function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = 'dev-' + crypto.randomUUID();
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

// 中继服务器地址
const RELAY_BASE_URL = 'http://localhost:5000';

// 初始化入口
window.addEventListener('DOMContentLoaded', () => {
    DEVICE_ID = getOrCreateDeviceId();
    console.log('🔑 Device ID:', DEVICE_ID);
    
    loadConfig();
    
    // 监听 Access Key 变化以查询密钥信息
    const accessKeyInput = document.getElementById('cfgAccessKey');
    if (accessKeyInput) {
        accessKeyInput.addEventListener('change', fetchKeyInfo);
        accessKeyInput.addEventListener('blur', fetchKeyInfo);
        // 页面加载时如果已有密钥则查询
        if (accessKeyInput.value.trim()) {
            setTimeout(fetchKeyInfo, 500);
        }
    }
    
    // 🔮 心跳包：每 30 秒主动发送一次 key-info，更新在线状态
    setInterval(() => {
        const ak = document.getElementById('cfgAccessKey')?.value.trim();
        if (ak) {
            fetchKeyInfo().catch(() => {});
        }
    }, 30000);
    
    appendSystemMessage("Alchemist 工作台 v8.0 (Relay Edition) 初始化完毕。<br><br>💡 特性：<br>1. 已切换到<b>中继模式</b>——使用管理员分发的 Access Key 安全调用 AI。<br>2. 所有真实模型名已<b>白牌封装</b>，仅显示展示模型。<br>3. 点击顶部 <strong>FOCUS MODE</strong> 即可开启聚焦流。<br>4. 30s 心跳保持在线状态。<br>5. 您的设备 ID: <code class='text-[0.65rem] bg-indigo-50 px-1 rounded'>" + DEVICE_ID.substring(0, 12) + "...</code>");
});
