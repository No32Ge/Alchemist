
// ================= UI 工具函数 =================

function scrollToBottom() { 
    chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' }); 
}

function appendSystemMessage(text) { 
    chatArea.insertAdjacentHTML('beforeend', `<div class="chat-msg"><div class="avatar system"><i class="fa-solid fa-bolt"></i></div><div class="bubble"><div class="bubble-header text-slate-500">System <span class="font-normal text-[0.65rem] text-slate-400">${new Date().toLocaleTimeString()}</span></div><div class="text-sm leading-relaxed text-slate-600">${text}</div></div></div>`); 
    scrollToBottom(); 
}

function appendUserMessage(text) { 
    chatArea.insertAdjacentHTML('beforeend', `<div class="chat-msg"><div class="avatar user"><i class="fa-solid fa-user-astronaut"></i></div><div class="bubble border-indigo-100 bg-indigo-50/50"><div class="bubble-header text-indigo-700">You <span class="font-normal text-[0.65rem] text-slate-400">${new Date().toLocaleTimeString()}</span></div><div class="text-sm leading-relaxed whitespace-pre-wrap">${text}</div></div></div>`); 
    scrollToBottom(); 
}

function createAITaskBubble(totalTasks) {
    const bId = 'ai-task-' + Date.now();
    chatArea.insertAdjacentHTML('beforeend', `<div class="chat-msg"><div class="avatar ai"><i class="fa-solid fa-microchip"></i></div><div class="bubble shadow-md border-emerald-100"><div class="bubble-header text-emerald-700">Engine Worker <span class="font-normal text-[0.65rem] text-slate-400">${new Date().toLocaleTimeString()}</span></div><div class="text-sm mb-3 font-semibold text-slate-700" id="${bId}-text">任务分发中... [并发: ${totalTasks}]</div><div class="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs font-mono shadow-inner"><div class="flex justify-between mb-1 text-slate-600"><span>已完成: <span id="${bId}-count" class="font-bold text-indigo-600">0</span> / ${totalTasks}</span><span id="${bId}-percent" class="text-slate-500">0%</span></div><div class="progress-container"><div id="${bId}-bar" class="progress-bar" style="width: 0%"></div></div><div class="flex gap-4 mt-2 font-semibold"><span class="text-emerald-600">SUCCESS <span id="${bId}-success">0</span></span><span class="text-red-500">FAIL <span id="${bId}-error">0</span></span></div><div id="${bId}-log" class="mt-2 text-[0.65rem] text-slate-400 max-h-24 overflow-y-auto"></div></div></div></div>`);
    scrollToBottom();
    return {
        updateProgress: (successCount, errorCount, latestLog, isErr=false) => {
            const done = successCount + errorCount, pct = Math.floor((done/totalTasks)*100);
            document.getElementById(`${bId}-count`).innerText = done; document.getElementById(`${bId}-percent`).innerText = `${pct}%`; document.getElementById(`${bId}-bar`).style.width = `${pct}%`;
            document.getElementById(`${bId}-success`).innerText = successCount; document.getElementById(`${bId}-error`).innerText = errorCount;
            if(latestLog) { const l = document.getElementById(`${bId}-log`); l.innerHTML = `<div class="${isErr?'text-red-500':'text-slate-500'}"><span class="opacity-60">[${new Date().toLocaleTimeString()}]</span> ${latestLog}</div>` + l.innerHTML; }
        },
        finish: (txt) => { document.getElementById(`${bId}-text`).innerHTML = txt; document.getElementById(`${bId}-bar`).classList.add('success'); scrollToBottom(); }
    };
}

// 保存指示器
function showSaveIndicator() {
    const ind = document.getElementById('saveIndicator');
    if (!ind) return;
    ind.style.opacity = '1'; ind.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 同步中';
    setTimeout(() => { ind.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 已保存'; setTimeout(() => { ind.style.opacity = '0.3'; }, 2000); }, 300);
}

// 持久化保存
function saveConfig() {
    const data = {
        api: {
            accessKey: document.getElementById('cfgAccessKey')?.value,
            model: document.getElementById('cfgModel')?.value, maxWorkers: document.getElementById('cfgMaxWorkers')?.value,
            maxRetries: document.getElementById('cfgMaxRetries')?.value, delay: document.getElementById('cfgDelay')?.value
        },
        isFocusMode: isFocusMode,
        currentFocus: currentFocus,
        strategies: currentStrategies,
        activeStrategyId: activeStrategyId
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    showSaveIndicator();
}

function debounceSave() { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveConfig, 500); }

// Config Modal
function openConfigModal() { const m=document.getElementById('configModal'), c=document.getElementById('configModalContent'); m.classList.remove('hidden'); void m.offsetWidth; m.classList.remove('opacity-0'); c.classList.remove('scale-95'); }
function closeConfigModal() { const m=document.getElementById('configModal'), c=document.getElementById('configModalContent'); m.classList.add('opacity-0'); c.classList.add('scale-95'); setTimeout(()=>m.classList.add('hidden'), 200); }

// 导出/导入应用配置
window.exportAppConfig = () => { const d=localStorage.getItem(STORE_KEY); if(!d)return alert("无配置"); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([d],{type:'application/json'})); a.download=`BatchPro_${Date.now()}.json`; a.click(); };
window.copyAppConfig = () => { const d=localStorage.getItem(STORE_KEY); if(!d)return alert("无配置"); navigator.clipboard.writeText(d).then(()=>alert("📋 已复制！")); };
window.importAppConfigFromText = () => { try { const r=document.getElementById('importArea').value.trim(); const p=JSON.parse(r); if(!p.strategies)throw new Error("JSON格式缺少核心架构"); localStorage.setItem(STORE_KEY, r); alert("✅ 载入成功"); location.reload(); }catch(e){alert("❌ 失败: "+e.message);} };
document.getElementById('configFileImport').addEventListener('change', e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=evt=>{ try{ const p=JSON.parse(evt.target.result); if(!p.strategies)throw new Error(); localStorage.setItem(STORE_KEY, evt.target.result); alert("✅ 载入成功"); location.reload(); }catch(err){alert("❌ 失败");} }; r.readAsText(f); });
window.resetAppConfig = () => { if(confirm("🚨 将彻底删除所有配置与自定义变量，确定重置？")){ localStorage.removeItem(STORE_KEY); location.reload(); } };

// 日志弹窗
function showLogsModal() { const modal = document.getElementById('logModal'), body = document.getElementById('logModalBody'); body.innerHTML = currentRunLogs.map(log => log.includes('FAIL') ? `<div class="text-red-400 mb-1">${log}</div>` : `<div class="mb-1 text-emerald-400/80">${log}</div>`).join('') || '<div class="text-slate-500">无日志记录。</div>'; modal.classList.remove('hidden'); void modal.offsetWidth; modal.classList.remove('opacity-0'); document.getElementById('logModalContent').classList.remove('scale-95'); setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50); }
function closeLogsModal() { const m = document.getElementById('logModal'), c = document.getElementById('logModalContent'); m.classList.add('opacity-0'); c.classList.add('scale-95'); setTimeout(() => m.classList.add('hidden'), 200); }

// 导出功能（由 ai.js 调用）
function getFlattenedData() { return Object.keys(completedResults).sort((a,b)=>a-b).reduce((acc, k) => { const res = completedResults[k]; Array.isArray(res) ? acc.push(...res) : acc.push(res); return acc; }, []); }
window.exportJSON = function() { const data = getFlattenedData(); if(!data.length) return alert("无数据导出"); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); link.download = `Alchemist_${Date.now()}.json`; link.click(); };
window.exportExcel = function() { const data = getFlattenedData(); if(!data.length) return alert("无数据导出"); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Sheet1"); XLSX.writeFile(wb, `Alchemist_${Date.now()}.xlsx`); };



// ================= 标签页切换逻辑 =================
window.switchRightTab = function(tabName) {
    const tabs = ['system', 'template', 'fewshot'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tabBtn-${t}`);
        const sec = document.getElementById(`sec-${t}`);
        if (t === tabName) {
            btn.className = "right-tab-btn flex-1 py-1.5 text-xs font-bold rounded-md transition-all text-indigo-600 bg-white shadow-sm border border-slate-200";
            sec.classList.remove('hidden');
        } else {
            btn.className = "right-tab-btn flex-1 py-1.5 text-xs font-semibold rounded-md transition-all text-slate-500 hover:text-indigo-600";
            sec.classList.add('hidden');
        }
    });
};

// ================= 沉浸式全屏文本编辑器逻辑 =================
let activeFullscreenTextarea = null;

window.openFullscreenEditor = function(target, titleText) {
    let el = null;
    if (typeof target === 'string') {
        el = document.getElementById(target);
    } else {
        el = target;
    }
    if (!el) return;
    activeFullscreenTextarea = el;
    
    document.getElementById('fsEditorTitle').innerText = titleText || '编辑文本';
    document.getElementById('fsEditorTextarea').value = el.value;
    
    const m = document.getElementById('fullscreenEditorModal');
    const c = document.getElementById('fsEditorContent');
    m.classList.remove('hidden');
    void m.offsetWidth;
    m.classList.remove('opacity-0');
    c.classList.remove('scale-95');
};

window.closeFullscreenEditor = function(save) {
    const m = document.getElementById('fullscreenEditorModal');
    const c = document.getElementById('fsEditorContent');
    
    if (save && activeFullscreenTextarea) {
        activeFullscreenTextarea.value = document.getElementById('fsEditorTextarea').value;
        // 触发 input 事件以保证主界面与持久化逻辑可以正确感应数据变动
        activeFullscreenTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => {
        m.classList.add('hidden');
        activeFullscreenTextarea = null;
    }, 200);
};

// ================= 🔮 镜像着色与自动补全引擎 =================
let activeAutocompleteIdx = -1;

window.updateTemplateMirror = function() {
    const textarea = document.getElementById('cfgTemplate');
    const mirror = document.getElementById('cfgTemplateMirror');
    if (!textarea || !mirror) return;
    
    let text = textarea.value;
    let escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
        
    // 关键修复：移除 px-1.5, mx-0.5, border 等会导致物理占位变宽、阻碍光标对齐的布局样式
    // 改用无占位的 outline 属性，配合 bg 完成完美的原位高光着色，实现光标与文本100%同步
    const tokenized = escaped.replace(/\{\{([^\}]+)\}\}/g, (match, varName) => {
        return `<span class="bg-indigo-50 text-indigo-600 font-bold rounded-sm outline outline-1 outline-indigo-200/40 select-all">${match}</span>`;
    });
    
    mirror.innerHTML = tokenized + (text.endsWith('\n') || text.endsWith(' ') ? ' &nbsp;' : '');
    mirror.scrollTop = textarea.scrollTop;
};

function showAutocomplete(matches) {
    const popup = document.getElementById('autocompletePopup');
    if (!popup) return;
    
    popup.innerHTML = matches.map((m) => {
        return `<button onclick="selectAutocomplete('${m}')" class="autocomplete-item text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer pointer-events-auto" data-header="${m}"><i class="fa-solid fa-magnet text-[0.6rem] text-indigo-400"></i> <span>${m}</span></button>`;
    }).join('');
    
    popup.classList.remove('hidden');
    activeAutocompleteIdx = -1;
}

window.hideAutocomplete = function() {
    const popup = document.getElementById('autocompletePopup');
    if (popup) {
        popup.classList.add('hidden');
        popup.innerHTML = '';
    }
    activeAutocompleteIdx = -1;
};

window.selectAutocomplete = function(headerName) {
    const textarea = document.getElementById('cfgTemplate');
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const textUpToCursor = textarea.value.substring(0, start);
    const lastOpen = textUpToCursor.lastIndexOf('{{');
    
    if (lastOpen === -1) return;
    
    const textBefore = textarea.value.substring(0, lastOpen);
    let textAfter = textarea.value.substring(start);
    
    // 关键修复：消除由于浏览器/输入法自动联想可能产生的多余闭合大括号，防止出现 }} 多余后缀
    if (textAfter.startsWith('}}')) {
        textAfter = textAfter.substring(2);
    } else if (textAfter.startsWith('}')) {
        textAfter = textAfter.substring(1);
    }
    
    const insertedText = `{{${headerName}}}`;
    textarea.value = textBefore + insertedText + textAfter;
    const newCursorPos = lastOpen + insertedText.length;
    
    textarea.focus();
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    
    window.updateTemplateMirror();
    window.hideAutocomplete();
    
    // 派发输入事件，触发持久化与同步逻辑
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
};

function initTokenizerAndAutocomplete() {
    const textarea = document.getElementById('cfgTemplate');
    const mirror = document.getElementById('cfgTemplateMirror');
    if (!textarea) return;
    
    // 镜像滚动条物理双向同步
    textarea.addEventListener('scroll', () => {
        if (mirror) mirror.scrollTop = textarea.scrollTop;
    });
    
    // 输入变化实时更新高亮着色
    textarea.addEventListener('input', window.updateTemplateMirror);
    
    const checkAutocomplete = () => {
        const val = textarea.value;
        const start = textarea.selectionStart;
        const textUpToCursor = val.substring(0, start);
        const lastOpen = textUpToCursor.lastIndexOf('{{');
        const lastClose = textUpToCursor.lastIndexOf('}}');
        
        // 捕获未闭合的 {{ 双大括号，并限制不超过20个字以防止性能耗损
        if (lastOpen !== -1 && lastOpen > lastClose && (start - lastOpen <= 20)) {
            const query = textUpToCursor.substring(lastOpen + 2);
            if (!query.includes('\n')) {
                const list = (typeof headers !== 'undefined' ? headers : []);
                const matches = list.filter(h => h && h.toLowerCase().includes(query.toLowerCase()));
                if (matches.length > 0) {
                    showAutocomplete(matches);
                    return;
                }
            }
        }
        window.hideAutocomplete();
    };

    textarea.addEventListener('input', checkAutocomplete);
    textarea.addEventListener('keyup', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter') {
            checkAutocomplete();
        }
    });
    textarea.addEventListener('click', checkAutocomplete);
    
    // 键盘上下导航与回车选择拦截
    textarea.addEventListener('keydown', (e) => {
        const popup = document.getElementById('autocompletePopup');
        if (popup && !popup.classList.contains('hidden')) {
            const items = popup.querySelectorAll('.autocomplete-item');
            if (items.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeAutocompleteIdx = (activeAutocompleteIdx + 1) % items.length;
                    updateActiveItem(items);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeAutocompleteIdx = (activeAutocompleteIdx - 1 + items.length) % items.length;
                    updateActiveItem(items);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (activeAutocompleteIdx >= 0 && activeAutocompleteIdx < items.length) {
                        items[activeAutocompleteIdx].click();
                    } else {
                        items[0].click(); // 默认完成首个检索匹配项
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    window.hideAutocomplete();
                }
            }
        }
    });
}

function updateActiveItem(items) {
    items.forEach((item, idx) => {
        if (idx === activeAutocompleteIdx) {
            item.classList.add('bg-indigo-50', 'text-indigo-600');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('bg-indigo-50', 'text-indigo-600');
        }
    });
}

// 延迟注入绑定，避开DOM竞争
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initTokenizerAndAutocomplete, 150);
});

// 全局输入监听（同步 UI 到数据）
document.addEventListener('input', e => { if(e.target.id!=='strategySelector' && e.target.matches('input, textarea, select')) syncUIToData(); });
document.addEventListener('change', e => { if(e.target.id!=='strategySelector' && e.target.matches('input[type="checkbox"]')) syncUIToData(); });
