
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

function syncUIToData() {
    if(isSyncingUI) return; 
    const s = currentStrategies.find(x => x.id === activeStrategyId);
    if(s) {
        s.system = document.getElementById('cfgSystem')?.value || ""; 
        s.template = document.getElementById('cfgTemplate')?.value || "";
        s.maxChars = document.getElementById('cfgMaxChars')?.value || 20000; 
        s.enableRandomSample = document.getElementById('enableRandomSample')?.checked || false; 
        s.randomSampleCount = document.getElementById('randomSampleCount')?.value || 1;
        
        s.samples = []; 
        document.querySelectorAll('.sample-item').forEach(el => {
            s.samples.push({ 
                active: el.querySelector('.sample-active-toggle')?.checked, 
                collapsed: el.querySelector('.sample-content')?.classList.contains('hidden'), 
                user: el.querySelector('.sample-user')?.value, 
                assistant: el.querySelector('.sample-assistant')?.value 
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
                <div class="flex justify-between items-center mb-1">
                    <label class="text-[0.65rem] font-medium text-slate-500">Assistant Target JSON</label>
                    <button class="fs-sample-assistant-btn text-indigo-500 hover:text-indigo-700 text-[0.6rem] font-semibold flex items-center gap-1"><i class="fa-solid fa-expand text-[0.5rem]"></i> 全屏编辑</button>
                </div>
                <textarea class="sample-assistant workspace-input font-mono text-[0.65rem]" rows="2">${data?data.assistant:''}</textarea>
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

    div.querySelector('.fs-sample-assistant-btn').addEventListener('click', (e) => {
        e.preventDefault();
        const txtAssistant = div.querySelector('.sample-assistant');
        openFullscreenEditor(txtAssistant, `Sample #${idx} - Assistant Target JSON`);
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
}

document.getElementById('addSampleBtn').addEventListener('click', () => { 
    addSampleDOM({ active:true, collapsed:false, user:"", assistant:"" }); 
    syncUIToData(); 
});
