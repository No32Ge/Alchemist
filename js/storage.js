
// ================= 🧠 LocalStorage 引擎与策略管理 =================

function getDefaultStrategy(name) { 
    return { 
        id: 'strat_'+Date.now(), 
        name: name, 
        system: "你是一位拥有10年经验的亚马逊大卖操盘手。任务是将杂乱信息转化为高转化JSON。\n务必直接输出原生JSON数组。\n[ { \"ID\": \"提取的SKU\", \"Title\": \"高转化英文标题\" } ]", 
        template: "数据：{{描述}}", 
        maxChars: 20000, 
        enableRandomSample: false, 
        randomSampleCount: 1, 
        outputColumns: ["ID", "Title"],
        samples: [{ active: true, collapsed: true, user: "編號SKU: GE32\n描述: Lighter...", assistant: '[{"ID":"GE32","Title":"Arc Lighter"}]' }] 
    }; 
}

function loadConfig() {
    try {
        let data = localStorage.getItem(STORE_KEY);
        if (!data) {
            // 无缝迁移旧版数据避免配置丢失
            const oldData = localStorage.getItem('AIBatchPro_V7');
            if (oldData) {
                data = oldData;
                localStorage.setItem(STORE_KEY, oldData);
                localStorage.removeItem('AIBatchPro_V7');
            }
        }
        if (data) {
            const cfg = JSON.parse(data);
            
            const setVal = (id, val) => { const el = document.getElementById(id); if(el && val!==undefined) el.value = val; };
            setVal('cfgAccessKey', cfg.api?.accessKey || cfg.api?.apiKey || '');
            // 🔮 cfgModel 现在是 <select> 下拉，setVal 仍然可用（设置 value）
            setVal('cfgModel', cfg.api?.model);
            setVal('cfgMaxWorkers', cfg.api?.maxWorkers); setVal('cfgMaxRetries', cfg.api?.maxRetries); setVal('cfgDelay', cfg.api?.delay);
            
            if(cfg.isFocusMode) {
                isFocusMode = false;
                currentFocus = cfg.currentFocus || 'center';
                toggleFocusMode();
            }
            currentStrategies = Array.isArray(cfg.strategies) && cfg.strategies.length > 0 ? cfg.strategies : [getDefaultStrategy("Default Logic")];
            activeStrategyId = cfg.activeStrategyId || currentStrategies[0].id;
            
            // 🔮 向后兼容：旧策略可能没有 outputColumns 字段
            currentStrategies.forEach(s => {
                if (!s.outputColumns || !Array.isArray(s.outputColumns)) {
                    s.outputColumns = ["ID", "Title"];
                }
            });
        } else {
            currentStrategies = [getDefaultStrategy("Default Logic")];
            activeStrategyId = currentStrategies[0].id;
        }
    } catch (e) {
        console.error("Config load error:", e);
        currentStrategies = [getDefaultStrategy("Default Logic")];
        activeStrategyId = currentStrategies[0].id;
    }
    if(!currentStrategies.find(s=>s.id===activeStrategyId)) activeStrategyId = currentStrategies[0].id;
    renderStrategySelector(); 
    applyActiveStrategyToUI();
}

function applyActiveStrategyToUI() {
    isSyncingUI = true; 
    const s = currentStrategies.find(x => x.id === activeStrategyId);
    if(s) {
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val||""; };
        setVal('cfgSystem', s.system); setVal('cfgTemplate', s.template); setVal('cfgMaxChars', s.maxChars || 20000);
        
        const chk = document.getElementById('enableRandomSample'); if(chk) chk.checked = s.enableRandomSample || false;
        setVal('randomSampleCount', s.randomSampleCount || 1);
        
        // 🔮 渲染输出列 UI
        renderOutputColumnsUI();
        
        const c = document.getElementById('samplesContainer'); if(c) {
            c.innerHTML = '';
            if(s.samples) s.samples.forEach((x,i) => addSampleDOM(x,i+1));
        }
        // 动态加载新策略时，立即刷新语法着色渲染
        if (window.updateTemplateMirror) {
            setTimeout(window.updateTemplateMirror, 20);
        }
    }
    isSyncingUI = false;
}

// ================= 🔮 输出列管理 UI 渲染 =================

function renderOutputColumnsUI() {
    const s = currentStrategies.find(x => x.id === activeStrategyId);
    if (!s) return;
    
    const container = document.getElementById('outputColsList');
    if (!container) return;
    
    const cols = s.outputColumns || [];
    
    container.innerHTML = cols.map((colName, idx) => `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded-full text-[0.65rem] font-semibold text-slate-700 shadow-sm transition-all hover:border-indigo-300 group">
            <i class="fa-solid fa-table-columns text-[0.55rem] text-emerald-400"></i>
            <span>${escHtml(colName)}</span>
            <button class="remove-output-col-btn text-slate-300 hover:text-red-500 transition-colors ml-0.5" data-col-index="${idx}" title="删除此列">
                <i class="fa-solid fa-xmark text-[0.6rem]"></i>
            </button>
        </span>
    `).join('') || '<span class="text-[0.65rem] text-slate-400 italic">尚未定义输出列，请添加至少一列</span>';
    
    // 绑定删除按钮事件
    container.querySelectorAll('.remove-output-col-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.colIndex, 10);
            s.outputColumns.splice(idx, 1);
            syncUIToData();
            // 级联刷新 Few-Shot 样本表单
            applyActiveStrategyToUI();
        });
    });
}

// 🔮 添加输出列的按钮事件
function initOutputColEvents() {
    const btn = document.getElementById('btnAddOutputCol');
    const input = document.getElementById('newOutputColInput');
    if (!btn || !input) return;
    
    btn.addEventListener('click', () => {
        const s = currentStrategies.find(x => x.id === activeStrategyId);
        if (!s) return;
        
        const colName = input.value.trim();
        if (!colName) {
            alert('请输入列名');
            return;
        }
        if (s.outputColumns.includes(colName)) {
            alert('该列名已存在');
            return;
        }
        
        s.outputColumns.push(colName);
        input.value = '';
        syncUIToData();
        
        // 🔮 级联刷新：输出列列表 + Few-Shot 样本表单
        applyActiveStrategyToUI();
    });
}

// HTML 转义工具函数
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function syncUIToData() {
    if(isSyncingUI) return; 
    const s = currentStrategies.find(x => x.id === activeStrategyId);
    if(s) {
        s.system = document.getElementById('cfgSystem')?.value || ""; 
        s.template = document.getElementById('cfgTemplate')?.value || "";
        s.maxChars = document.getElementById('cfgMaxChars')?.value || 20000; 
        s.enableRandomSample = document.getElementById('enableRandomSample')?.checked || false; 
        s.randomSampleCount = document.getElementById('randomSampleCount')?.value || 1;
        
        // 🔮 保存输出列（从 DOM 标签中读取，保证与当前状态一致）
        // outputColumns 已通过 renderOutputColumnsUI 在策略对象中直接维护，此处不需额外处理
        
        s.samples = []; 
        document.querySelectorAll('.sample-item').forEach(el => {
            // 🔮 新逻辑：从动态表单字段自动组装 JSON
            const fieldsContainer = el.querySelector('.sample-assistant-fields-container');
            let assistantJSON = '';
            
            if (fieldsContainer) {
                // 存在表单字段容器 → 从表单组装 JSON
                const fieldInputs = fieldsContainer.querySelectorAll('.sample-assistant-field');
                const resultObj = {};
                fieldInputs.forEach(input => {
                    const colName = input.dataset.columnName;
                    if (colName) {
                        resultObj[colName] = input.value || '';
                    }
                });
                // 包装为单元素 JSON 数组以保持兼容
                assistantJSON = JSON.stringify([resultObj], null, 2);
            } else {
                // 旧版兼容：读取隐藏的 JSON textarea
                const legacyTextarea = el.querySelector('.sample-assistant');
                assistantJSON = legacyTextarea ? legacyTextarea.value : '';
            }
            
            s.samples.push({ 
                active: el.querySelector('.sample-active-toggle')?.checked, 
                collapsed: el.querySelector('.sample-content')?.classList.contains('hidden'), 
                user: el.querySelector('.sample-user')?.value, 
                assistant: assistantJSON
            });
        });
    }
    debounceSave();
}

function renderStrategySelector() { 
    const sel = document.getElementById('strategySelector'); 
    sel.innerHTML = ''; 
    currentStrategies.forEach(s => { 
        const opt = document.createElement('option'); 
        opt.value = s.id; 
        opt.textContent = s.name; 
        if(s.id===activeStrategyId) opt.selected=true; 
        sel.appendChild(opt); 
    }); 
}

document.getElementById('strategySelector').addEventListener('change', e => { 
    activeStrategyId = e.target.value; 
    applyActiveStrategyToUI(); 
    saveConfig(); 
});

document.getElementById('btnNewStrategy').addEventListener('click', () => { 
    const n = prompt("新策略名:","New Profile"); 
    if(n&&n.trim()){ 
        const ns = getDefaultStrategy(n.trim()); 
        currentStrategies.push(ns); 
        activeStrategyId = ns.id; 
        renderStrategySelector(); 
        applyActiveStrategyToUI(); 
        saveConfig(); 
    } 
});

document.getElementById('btnRenameStrategy').addEventListener('click', () => { 
    const s = currentStrategies.find(x=>x.id===activeStrategyId); 
    const n = prompt("重命名:",s.name); 
    if(n&&n.trim()){ 
        s.name=n.trim(); 
        renderStrategySelector(); 
        saveConfig(); 
    } 
});

document.getElementById('btnDeleteStrategy').addEventListener('click', () => { 
    if(currentStrategies.length <= 1) return alert("需至少保留一套配置！"); 
    if(confirm(`确定删除策略【${currentStrategies.find(s=>s.id===activeStrategyId).name}】？`)) { 
        currentStrategies = currentStrategies.filter(s => s.id !== activeStrategyId); 
        activeStrategyId = currentStrategies[0].id; 
        renderStrategySelector(); 
        applyActiveStrategyToUI(); 
        saveConfig(); 
    } 
});

// ================= 🔮 Few-Shot 样本渲染（表单化替代 JSON 文本框） =================

function addSampleDOM(data=null, index=null) {
    const c = document.getElementById('samplesContainer'); 
    const idx = index || c.children.length+1;
    const div = document.createElement('div'); 
    div.className = "sample-item bg-white border border-slate-200 rounded-lg shadow-sm transition-opacity duration-200 overflow-hidden";
    // 默认让Few-Shot样本折叠，节省空间
    const isActive = data ? data.active!==false : true, isCollapsed = data ? data.collapsed!==false : true;
    if(!isActive) div.classList.add('opacity-40');
    
    const initialVal = data ? (data.user || "") : "";
    const previewTxt = initialVal.trim().substring(0, 16).replace(/\n/g, ' ');
    const initialPreview = previewTxt ? ': ' + previewTxt + (initialVal.length > 16 ? '...' : '') : '';

    div.innerHTML = `
        <div class="flex justify-between items-center p-2.5 bg-slate-50 border-b border-slate-100 select-none">
            <div class="flex items-center gap-1.5 overflow-hidden flex-1 mr-2">
                <input type="checkbox" class="sample-active-toggle rounded text-indigo-500 border-slate-300 focus:ring-indigo-500 shrink-0" ${isActive?'checked':''}>
                <span class="text-[0.7rem] font-bold text-slate-600 sample-index shrink-0">Sample #${idx}</span>
                <span class="text-[0.65rem] text-slate-400 font-normal truncate sample-preview">${initialPreview}</span>
            </div>
            <div class="flex gap-2 text-slate-400 shrink-0">
                <button class="toggle-collapse-btn hover:text-indigo-600 px-1"><i class="fa-solid ${isCollapsed?'fa-chevron-down':'fa-chevron-up'}"></i></button>
                <button class="remove-sample-btn hover:text-red-500 px-1"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div class="sample-content p-3 space-y-3 ${isCollapsed?'hidden':''}">
            <div>
                <div class="flex justify-between items-center mb-1">
                    <label class="text-[0.65rem] font-medium text-slate-500">User Input</label>
                    <button class="fs-sample-user-btn text-indigo-500 hover:text-indigo-700 text-[0.6rem] font-semibold flex items-center gap-1"><i class="fa-solid fa-expand text-[0.5rem]"></i> 全屏编辑</button>
                </div>
                <textarea class="sample-user workspace-input font-mono text-[0.65rem]" rows="2">${data?data.user:''}</textarea>
            </div>
            <div>
                <label class="text-[0.65rem] font-medium text-slate-500 block mb-2">
                    <i class="fa-solid fa-table-columns text-emerald-400 mr-1"></i> Assistant 目标值
                </label>
                <!-- 🔮 隐藏的旧版 JSON textarea（保持 DOM 兼容性，实际通过表单组装） -->
                <textarea class="sample-assistant hidden" rows="1">${data?data.assistant:''}</textarea>
                <!-- 🔮 动态生成的表单字段容器 -->
                <div class="sample-assistant-fields-container space-y-2"></div>
            </div>
        </div>`;

    const txtUser = div.querySelector('.sample-user');
    const previewSpan = div.querySelector('.sample-preview');
    txtUser.addEventListener('input', () => {
        const val = txtUser.value.trim().substring(0, 16).replace(/\n/g, ' ');
        previewSpan.innerText = val ? ': ' + val + (txtUser.value.length > 16 ? '...' : '') : '';
    });

    div.querySelector('.fs-sample-user-btn').addEventListener('click', (e) => {
        e.preventDefault();
        openFullscreenEditor(txtUser, `Sample #${idx} - User Input`);
    });

    div.querySelector('.sample-active-toggle').addEventListener('change', e=>{ e.target.checked?div.classList.remove('opacity-40'):div.classList.add('opacity-40'); syncUIToData();});
    const t = div.querySelector('.toggle-collapse-btn'); 
    t.addEventListener('click', ()=>{ 
        const ct = div.querySelector('.sample-content'); 
        ct.classList.toggle('hidden'); 
        const i = t.querySelector('i'); 
        ct.classList.contains('hidden')?i.classList.replace('fa-chevron-up','fa-chevron-down'):i.classList.replace('fa-chevron-down','fa-chevron-up'); 
        syncUIToData(); 
    });
    div.querySelector('.remove-sample-btn').addEventListener('click', ()=>{ 
        div.remove(); 
        Array.from(c.children).forEach((child, i) => child.querySelector('.sample-index').innerText = `Sample #${i + 1}`); 
        syncUIToData(); 
    });
    c.appendChild(div);
    
    // 🔮 动态生成输出列表单行
    buildSampleFields(div, data);
}

/** 🔮 根据当前策略的 outputColumns 动态生成表单输入行 */
function buildSampleFields(sampleDiv, data) {
    const container = sampleDiv.querySelector('.sample-assistant-fields-container');
    if (!container) return;
    
    const s = currentStrategies.find(x => x.id === activeStrategyId);
    if (!s || !s.outputColumns || s.outputColumns.length === 0) {
        container.innerHTML = '<p class="text-[0.6rem] text-amber-500 italic">⚠️ 请先在右侧「定义要生成的 Excel 列」中添加至少一列</p>';
        return;
    }
    
    // 🔮 解析已有 JSON 数据（兼容旧版）
    let existingObj = {};
    if (data && data.assistant) {
        try {
            const parsed = JSON.parse(data.assistant);
            // 提取第一个元素对象
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
                existingObj = parsed[0];
            } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                existingObj = parsed;
            }
        } catch(e) {
            // 旧数据解析失败，使用空对象
        }
    }
    
    container.innerHTML = s.outputColumns.map(colName => {
        const existingVal = existingObj[colName] !== undefined ? String(existingObj[colName]) : '';
        return `
            <div class="flex items-center gap-2 bg-slate-50/60 rounded-md px-2.5 py-1.5 border border-slate-100">
                <label class="text-[0.65rem] font-semibold text-slate-600 shrink-0 min-w-[60px]">${escHtml(colName)}</label>
                <input 
                    type="text" 
                    class="sample-assistant-field flex-1 bg-white border border-slate-200 rounded-md px-2 py-1 text-[0.65rem] font-mono text-slate-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 transition-all" 
                    data-column-name="${escHtml(colName)}" 
                    value="${escHtml(existingVal)}" 
                    placeholder="输入 ${escHtml(colName)} 的示例值..."
                >
            </div>
        `;
    }).join('');
    
    // 🔮 绑定 input 事件 → 自动保存
    container.querySelectorAll('.sample-assistant-field').forEach(input => {
        input.addEventListener('input', () => {
            syncUIToData();
        });
    });
}

// 🔮 初始化输出列事件（在 DOM 就绪后调用）
function initAllOutputColListeners() {
    initOutputColEvents();
}

document.getElementById('addSampleBtn').addEventListener('click', () => { 
    addSampleDOM({ active:true, collapsed:false, user:"", assistant:"" }); 
    syncUIToData(); 
});

// 🔮 DOM 就绪后绑定输出列事件
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAllOutputColListeners, 200);
});
