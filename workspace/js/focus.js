
// ================= ✨ 纯净聚焦流引擎 (Focus Mode Logic - Zen Card Solo) =================

function toggleFocusMode() {
    isFocusMode = !isFocusMode;
    const icon = document.getElementById('focusIcon'), text = document.getElementById('focusText');
    
    if (isFocusMode) {
        document.body.classList.add('focus-mode-active');
        icon.className = "fa-solid fa-compress text-indigo-500";
        text.innerText = "EXIT FOCUS";
        switchFocus(currentFocus || 'center');
    } else {
        document.body.classList.remove('focus-mode-active');
        icon.className = "fa-solid fa-expand text-indigo-500";
        text.innerText = "FOCUS MODE";
        // 退出 Focus Mode，清理所有面板聚焦标记
        ['panelLeft', 'panelCenter', 'panelRight'].forEach(id => {
            document.getElementById(id)?.classList.remove('panel-focused');
        });
    }
    saveConfig();
}

function switchFocus(target) {
    currentFocus = target;
    
    const panels = {
        left: document.getElementById('panelLeft'),
        center: document.getElementById('panelCenter'),
        right: document.getElementById('panelRight')
    };
    
    // 更新物理面板激活状态
    Object.keys(panels).forEach(k => {
        if (panels[k]) {
            if (k === target) {
                panels[k].classList.add('panel-focused');
            } else {
                panels[k].classList.remove('panel-focused');
            }
        }
    });
    
    // 更新导航按钮状态
    const buttons = {
        left: document.getElementById('btnFocus-left'),
        center: document.getElementById('btnFocus-center'),
        right: document.getElementById('btnFocus-right')
    };
    
    Object.keys(buttons).forEach(k => {
        const btn = buttons[k];
        if (!btn) return;
        if (k === target) {
            btn.className = "px-3 py-1 text-[0.65rem] font-bold rounded-full transition-all text-indigo-600 bg-indigo-50 shadow-sm border border-indigo-100/30 pointer-events-auto";
        } else {
            btn.className = "px-3 py-1 text-[0.65rem] font-bold rounded-full transition-all text-slate-500 hover:text-indigo-600 pointer-events-auto";
        }
    });
    
    saveConfig();
}

function handleCardClick(target) {
    // 聚焦模式下，直接点击也可切换视窗
    if (isFocusMode && currentFocus !== target) {
        switchFocus(target);
    }
}
