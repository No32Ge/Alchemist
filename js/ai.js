// ================= 核心 AI 处理流 =================
let activeAbortController = null;

async function fetchAIResponse(messages, config, attempt = 1, signal = null) {
    if (config.delay > 0 && attempt === 1) {
        const delayMs = config.delay * 1000;
        let timer;
        const delayPromise = new Promise(r => { timer = setTimeout(r, delayMs); });
        const cancelPromise = new Promise((_, reject) => {
            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            }
        });
        await Promise.race([delayPromise, cancelPromise]);
    }
    
    try {
        // 🔮 中继模式：请求发送到后端 relay 服务器
        const relayUrl = (typeof RELAY_BASE_URL !== 'undefined' ? RELAY_BASE_URL : 'http://localhost:5000') + '/api/v1/chat/completions';
        const r = await fetch(relayUrl, { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${config.accessKey}`,
                'X-Device-ID': (typeof DEVICE_ID !== 'undefined' ? DEVICE_ID : '')
            }, 
            body: JSON.stringify({ model: config.model, messages: messages }),
            signal: signal
        });
        
        // 处理积分不足
        if (r.status === 402) {
            const errData = await r.json().catch(() => ({}));
            throw new Error(`积分不足: 需要 ${errData.required_credits || '?'} 积分, 余额 ${errData.balance || '?'}`);
        }
        
        if (!r.ok) {
            const errText = await r.text().catch(() => '');
            let errMsg = `HTTP ${r.status}`;
            try {
                const errJson = JSON.parse(errText);
                errMsg = errJson.error || errMsg;
            } catch {}
            throw new Error(errMsg);
        }
        
        const d = await r.json(); let text = d.choices[0].message.content.replace(/```json/gi, '').replace(/```/g, '').trim();
        let f1 = text.search(/[\{\[]/), f2 = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
        if (f1 !== -1 && f2 !== -1) return JSON.parse(text.substring(f1, f2 + 1));
        throw new Error("AI Returned Malformed JSON");
    } catch (err) {
        if (err.name === 'AbortError') {
            throw err;
        }
        if (attempt < config.maxRetries && !forceStopFlag) { 
            let retryTimer;
            const retryDelayPromise = new Promise(r => { retryTimer = setTimeout(r, 2000); });
            const retryCancelPromise = new Promise((_, reject) => {
                if (signal) {
                    signal.addEventListener('abort', () => {
                        clearTimeout(retryTimer);
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                }
            });
            await Promise.race([retryDelayPromise, retryCancelPromise]);
            return fetchAIResponse(messages, config, attempt + 1, signal); 
        }
        throw err;
    }
}

async function executeBatchLogic(dataToProcess) {
    activeAbortController = new AbortController();
    const accessKey = document.getElementById('cfgAccessKey')?.value.trim() || '';
    if (!accessKey) {
        appendSystemMessage('<span class="text-red-500">❌ 请先在左侧面板输入 Alchemist 访问密钥（Access Key）</span>');
        cleanupRunState();
        return;
    }
    const config = { 
        accessKey: accessKey,
        model: document.getElementById('cfgModel')?.value || '', 
        maxWorkers: parseInt(document.getElementById('cfgMaxWorkers')?.value, 10) || 100, 
        maxRetries: parseInt(document.getElementById('cfgMaxRetries')?.value, 10) || 3, 
        delay: parseFloat(document.getElementById('cfgDelay')?.value) || 0, 
        maxChars: parseInt(document.getElementById('cfgMaxChars')?.value, 10) || 20000, 
        system: document.getElementById('cfgSystem')?.value.trim() || '', 
        template: document.getElementById('cfgTemplate')?.value.trim() || '', 
        samples: [] 
    };
    let actS = []; 
    document.querySelectorAll('.sample-item').forEach(el => { 
        if (el.querySelector('.sample-active-toggle').checked) actS.push({ user: el.querySelector('.sample-user').value.trim(), assistant: el.querySelector('.sample-assistant').value.trim() }); 
    });
    config.samples = (document.getElementById('enableRandomSample')?.checked && actS.length > 0) ? actS.sort(() => 0.5 - Math.random()).slice(0, parseInt(document.getElementById('randomSampleCount')?.value, 10) || 1) : actS;

    const uiT = createAITaskBubble(dataToProcess.length);
    let fail = [], sCount = 0, eCount = 0, i = 0;
    
    const worker = async () => {
        while (i < dataToProcess.length && !forceStopFlag) {
            const item = dataToProcess[i++]; 
            try {
                let pt = config.template; 
                headers.forEach((h, idx) => { 
                    if (!h) return; 
                    let v = item.row[idx] !== undefined ? String(item.row[idx]) : '[空]'; 
                    if (v.length > config.maxChars) v = v.substring(0, config.maxChars) + "\n...[截断]"; 
                    pt = pt.split(`{{${h}}}`).join(v); 
                });
                const msgs = []; 
                if (config.system) msgs.push({ role: "system", content: config.system }); 
                config.samples.forEach(s => { msgs.push({ role: "user", content: s.user }); msgs.push({ role: "assistant", content: s.assistant }); }); 
                msgs.push({ role: "user", content: pt });
                
                const res = await fetchAIResponse(msgs, config, 1, activeAbortController.signal); 
                if (forceStopFlag) break;
                completedResults[item.index] = res; sCount++;
                currentRunLogs.push(`ID[${item.index}] SUCCESS`); uiT.updateProgress(sCount, eCount, `Record[${item.index}] Created`);
            } catch (e) {
                if (forceStopFlag || e.name === 'AbortError') {
                    break;
                }
                fail.push({ index: item.index, row: item.row, error: e.message }); eCount++;
                currentRunLogs.push(`ID[${item.index}] FAIL: ${e.message}`); uiT.updateProgress(sCount, eCount, `Record[${item.index}] ${e.message}`, true);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(config.maxWorkers, dataToProcess.length) }, () => worker()));
    failedTasks = fail;
    activeAbortController = null;
    
    // 🔮 同步策略到后端供管理员审计
    syncStrategyToBackend(config).catch(() => {});
    // 刷新密钥信息
    fetchKeyInfo().catch(() => {});
    
    uiT.finish(forceStopFlag ? `<span class="text-red-500">✋ 执行被强行中止</span>` : `✅ 引擎处理完毕`);
    setTimeout(() => {
        let hTxt = forceStopFlag ? '任务已中止' : '运行结果汇总';
        let btns = sCount>0 ? `<button onclick="exportExcel()" class="btn-action bg-emerald-500 hover:bg-emerald-600 text-white mr-2 shadow-sm"><i class="fa-solid fa-file-excel"></i> 导出 Excel</button><button onclick="exportJSON()" class="btn-action bg-slate-200 hover:bg-slate-300 text-slate-700 mr-2"><i class="fa-solid fa-file-code"></i> JSON</button>`:'';
        if(eCount>0) btns+=`<button onclick="triggerRetry()" class="btn-action bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"><i class="fa-solid fa-rotate-right"></i> 一键重试失败项 (${eCount})</button>`;
        chatArea.insertAdjacentHTML('beforeend', `<div class="chat-msg"><div class="avatar report"><i class="fa-solid fa-clipboard-check"></i></div><div class="bubble border-indigo-100 bg-white shadow-lg"><div class="bubble-header text-indigo-700">Execution Report <span class="font-normal text-[0.65rem] text-slate-400">${new Date().toLocaleTimeString()}</span></div><div class="text-[0.9rem] text-slate-700"><h3 class="font-bold mb-1">${hTxt}</h3><div class="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200"><p class="text-sm mb-2"><strong class="text-emerald-600">${sCount}</strong> 成功 / <strong class="text-red-500">${eCount}</strong> 失败</p><button onclick="showLogsModal()" class="text-xs bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded shadow-sm"><i class="fa-solid fa-rectangle-list"></i> 查看详细执行日志</button></div><div class="mt-3 pt-3 border-t border-slate-100">${btns}</div></div></div></div>`);
        scrollToBottom();
    }, 600);
}

// 主执行按钮
const fabBtn = document.getElementById('fabBtn'), fabIcon = document.getElementById('fabIcon'), fabTooltip = document.getElementById('fabTooltip');
fabBtn.addEventListener('click', async () => {
    if (isRunning) {
        forceStopFlag = true; fabBtn.disabled = true; fabIcon.className = "fa-solid fa-spinner fa-spin";
        if (activeAbortController) {
            activeAbortController.abort();
        }
    } else {
        if (rawExcelData.length === 0) return alert("请先上传并解析数据源文件！");
        
        completedResults = {}; failedTasks = []; currentRunLogs = []; isRunning = true; forceStopFlag = false;
        fabIcon.className = "fa-solid fa-stop"; fabBtn.classList.replace('bg-indigo-600', 'bg-red-500'); fabBtn.classList.replace('hover:bg-indigo-700', 'hover:bg-red-600'); fabTooltip.innerText = "中止任务";
        document.getElementById('systemStatusIndicator').innerHTML = `<i class="fa-solid fa-circle text-indigo-500 text-[0.5rem] align-middle mr-1 animate-pulse"></i> 运行中`;
        
        const sel = document.getElementById('strategySelector');
        const strategyName = sel.options[sel.selectedIndex].text;
        appendUserMessage(`采用策略 <b>[${strategyName}]</b> 执行，队列总计: <b>${rawExcelData.length}</b> 行。`);
        await executeBatchLogic(rawExcelData); 
        cleanupRunState();
    }
});

window.triggerRetry = async function() {
    if (failedTasks.length === 0 || isRunning) return;
    isRunning = true; forceStopFlag = false; fabIcon.className = "fa-solid fa-stop"; fabBtn.classList.replace('bg-indigo-600', 'bg-red-500'); fabBtn.classList.replace('hover:bg-indigo-700', 'hover:bg-red-600');
    document.getElementById('systemStatusIndicator').innerHTML = `<i class="fa-solid fa-circle text-orange-500 text-[0.5rem] align-middle mr-1 animate-pulse"></i> 重载修复中`;
    appendUserMessage(`开始重试 <b>${failedTasks.length}</b> 条失败任务...`);
    await executeBatchLogic(failedTasks.map(f => ({ index: f.index, row: f.row }))); 
    cleanupRunState();
};

function cleanupRunState() {
    isRunning = false; fabBtn.disabled = false; fabIcon.className = "fa-solid fa-play ml-1"; 
    fabBtn.classList.remove('bg-red-500', 'hover:bg-red-600'); fabBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
    fabTooltip.innerText = "开始执行当前策略"; 
    document.getElementById('systemStatusIndicator').innerHTML = `<i class="fa-solid fa-circle text-emerald-500 text-[0.5rem] align-middle mr-1"></i> 空闲`;
}

// ================= 🔮 后端同步函数 =================

async function syncStrategyToBackend(config) {
    try {
        const relayBase = typeof RELAY_BASE_URL !== 'undefined' ? RELAY_BASE_URL : 'http://localhost:5000';
        const s = currentStrategies.find(x => x.id === activeStrategyId);
        if (!s) return;
        
        await fetch(`${relayBase}/api/v1/sync-strategy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.accessKey}`,
                'X-Device-ID': (typeof DEVICE_ID !== 'undefined' ? DEVICE_ID : '')
            },
            body: JSON.stringify({
                system_prompt: s.system || '',
                template: s.template || '',
                few_shots: (s.samples || []).map(smp => ({ user: smp.user, assistant: smp.assistant })),
                strategy_name: s.name || ''
            })
        });
    } catch (err) {
        console.warn('策略同步失败:', err.message);
    }
}

// ================= 🔮 密钥信息查询 + 动态模型下拉 + 预估消耗 =================

/** 全局缓存最新的 key-info 数据 */
let cachedKeyInfo = null;

async function fetchKeyInfo() {
    const accessKey = document.getElementById('cfgAccessKey')?.value.trim();
    const modelSelect = document.getElementById('cfgModel');
    
    if (!accessKey) {
        document.getElementById('keyStatusArea')?.classList.add('hidden');
        if (modelSelect) {
            modelSelect.innerHTML = '<option value="">请先填写 Access Key 以加载模型...</option>';
        }
        return;
    }
    
    try {
        const relayBase = typeof RELAY_BASE_URL !== 'undefined' ? RELAY_BASE_URL : 'http://localhost:5000';
        const r = await fetch(`${relayBase}/api/v1/key-info`, {
            headers: {
                'Authorization': `Bearer ${accessKey}`,
                'X-Device-ID': (typeof DEVICE_ID !== 'undefined' ? DEVICE_ID : '')
            }
        });
        
        if (r.ok) {
            const data = await r.json();
            cachedKeyInfo = data;
            
            // 显示密钥状态区
            document.getElementById('keyStatusArea')?.classList.remove('hidden');
            const creditsEl = document.getElementById('keyCreditsDisplay');
            const callsEl = document.getElementById('keyCallsDisplay');
            if (creditsEl) {
                creditsEl.textContent = data.credits_balance;
                creditsEl.className = 'font-bold font-mono ' + 
                    (data.credits_balance <= 0 ? 'text-red-500' : 
                     data.credits_balance < 50 ? 'text-orange-500' : 'text-emerald-600');
            }
            if (callsEl) callsEl.textContent = data.total_calls;
            
            // 🔮 动态填充模型下拉菜单
            if (modelSelect && data.models && data.models.length > 0) {
                const currentVal = modelSelect.value;
                modelSelect.innerHTML = data.models.map(m => {
                    const selected = (currentVal === m.display_name) ? ' selected' : '';
                    return `<option value="${m.display_name}" data-base-rate="${m.base_rate}"${selected}>🔮 ${m.display_name} (${m.base_rate} 积分/次)</option>`;
                }).join('');
                
                // 如果之前没有选中任何模型，默认选第一个
                if (!currentVal || !data.models.find(m => m.display_name === currentVal)) {
                    modelSelect.value = data.models[0].display_name;
                }
            } else if (modelSelect) {
                modelSelect.innerHTML = '<option value="">⚠️ 此密钥暂无可用模型</option>';
            }
            
            // 🔮 更新预估消耗
            updateEstimatedCost(data);
            
            // 🔮 显示时间加权徽章
            const twBadge = document.getElementById('timeWeightBadge');
            const twLabel = document.getElementById('timeWeightLabel');
            if (twBadge && twLabel && data.current_time_weight) {
                if (data.current_time_weight !== 1.0) {
                    twBadge.classList.remove('hidden');
                    const pct = Math.round((data.current_time_weight - 1) * 100);
                    const sign = pct >= 0 ? '+' : '';
                    twLabel.textContent = `时段加权 ×${data.current_time_weight} (${sign}${pct}%)`;
                    twBadge.className = data.current_time_weight < 1 
                        ? 'mt-1.5 text-center inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6rem] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : 'mt-1.5 text-center inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6rem] font-bold bg-orange-50 text-orange-600 border border-orange-200';
                } else {
                    twBadge.classList.add('hidden');
                }
            }
            
            if (!data.is_active) {
                appendSystemMessage('<span class="text-red-500">⚠️ 此 Access Key 已被管理员禁用</span>');
            }
        } else if (r.status === 401) {
            document.getElementById('keyStatusArea')?.classList.add('hidden');
            if (modelSelect) {
                modelSelect.innerHTML = '<option value="">请先填写 Access Key 以加载模型...</option>';
            }
        }
    } catch (err) {
        console.warn('密钥信息查询失败:', err.message);
    }
}

/** 根据当前选中的模型 + 时间加权系数计算预估单次消耗 */
function updateEstimatedCost(data) {
    const modelSelect = document.getElementById('cfgModel');
    const costEl = document.getElementById('keyEstimatedCost');
    if (!costEl) return;
    
    const selectedOption = modelSelect?.selectedOptions?.[0];
    const baseRate = selectedOption ? parseFloat(selectedOption.dataset.baseRate) : 0;
    const timeWeight = (data && data.current_time_weight) ? data.current_time_weight : 1.0;
    
    if (baseRate > 0) {
        const effective = Math.ceil(baseRate * timeWeight * 100) / 100;
        costEl.textContent = effective + ' 积分';
        costEl.className = 'font-bold font-mono ' + (timeWeight !== 1.0 ? 'text-orange-500' : 'text-slate-600');
    } else {
        costEl.textContent = '—';
        costEl.className = 'font-bold font-mono text-slate-400';
    }
}

// 监听模型下拉切换，实时更新预估消耗
document.addEventListener('DOMContentLoaded', () => {
    const modelSelect = document.getElementById('cfgModel');
    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            if (cachedKeyInfo) {
                updateEstimatedCost(cachedKeyInfo);
            }
        });
    }
});
