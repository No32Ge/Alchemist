
// ================= 🧲 磁性变量拖拽 =================

function dragVarStart(e, val) { e.dataTransfer.setData('text/plain', `{{${val}}}`); e.target.style.opacity = '0.5'; }
function dragVarEnd(e) { e.target.style.opacity = '1'; }

const templateArea = document.getElementById('cfgTemplate');
templateArea.addEventListener('dragover', e => { e.preventDefault(); templateArea.classList.add('bg-indigo-50'); });
templateArea.addEventListener('dragleave', () => templateArea.classList.remove('bg-indigo-50'));
templateArea.addEventListener('drop', e => {
    e.preventDefault(); templateArea.classList.remove('bg-indigo-50');
    const text = e.dataTransfer.getData('text');
    if(!text) return;
    const start = templateArea.selectionStart, end = templateArea.selectionEnd;
    templateArea.value = templateArea.value.substring(0, start) + text + templateArea.value.substring(end);
    templateArea.focus(); templateArea.setSelectionRange(start + text.length, start + text.length);
    if (window.updateTemplateMirror) window.updateTemplateMirror();
    syncUIToData();
});
