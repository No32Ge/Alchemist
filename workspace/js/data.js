
// ================= 数据源解析 =================

const excelInput = document.getElementById('excelFileInput');
excelInput.addEventListener('change', (e) => { if(e.target.files[0]) document.getElementById('fileNameDisplay').innerText = e.target.files[0].name; });

document.getElementById('loadFieldsBtn').addEventListener('click', () => {
    const file = excelInput.files[0]; 
    if (!file) return alert("请先选择 Excel/CSV 文件！");
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result); 
            const workbook = XLSX.read(data, { type: 'array', cellText: false, cellDates: true });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            let hRowIdx = parseInt(document.getElementById('headerRowNum').value, 10) - 1; 
            if (isNaN(hRowIdx) || hRowIdx < 0) hRowIdx = 0;
            headers = rows[hRowIdx].map(c => String(c).trim()); 
            rawExcelData = [];
            rows.slice(hRowIdx + 1).forEach((row, i) => { 
                if (row.some(cell => String(cell).trim() !== '')) rawExcelData.push({ index: i, row: row }); 
            });
            
            document.getElementById('fieldPreview').innerHTML = headers.map(h => h ? `<span draggable="true" ondragstart="dragVarStart(event, '${h}')" ondragend="dragVarEnd(event)" class="var-tag bg-white px-2 py-1 rounded shadow-sm mr-1.5 mb-1.5 inline-block text-[0.65rem] cursor-grab border border-indigo-100 font-semibold"><i class="fa-solid fa-grip-vertical text-slate-300 mr-1"></i>${h}</span>` : '').join('');
            
            document.getElementById('dataStatusIndicator').innerHTML = `<i class="fa-solid fa-circle text-emerald-500 text-[0.5rem] align-middle mr-1"></i> 就绪 ${rawExcelData.length} 行`;
            appendSystemMessage(`已成功读取 <b>${file.name}</b>，装载数据 <b>${rawExcelData.length}</b> 行。左侧生成的变量可直接拖入 Template 中。`);
            completedResults = {}; failedTasks = [];
        } catch (err) { 
            appendSystemMessage(`<span class="text-red-500">❌ 解析失败: ${err.message}</span>`); 
        }
    }; 
    reader.readAsArrayBuffer(file);
});
