(function() {
    'use strict';
    if (window.__GE32_LAZY_CLEANER) return;

    let initialized = false;
    let observer = null;

    // 检查一个 input 元素是否为 Excel 文件输入框
    function isExcelFileInput(input) {
        if (!input || input.type !== 'file') return false;
        const accept = (input.accept || '').toLowerCase();
        return accept.includes('xlsx') || accept.includes('xls') || accept.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    // 核心初始化：加载 JSZip 并劫持 API
    async function initCleaner() {
        if (initialized) return;
        initialized = true;

        // 停止观察（既然已经初始化，不需要再监听）
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        // 动态加载 JSZip
        function loadJSZip() {
            return new Promise((resolve, reject) => {
                if (typeof JSZip !== 'undefined') return resolve(JSZip);
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
                script.onload = () => resolve(window.JSZip);
                script.onerror = () => reject(new Error('JSZip 加载失败'));
                document.head.appendChild(script);
            });
        }

        // 图片清理核心逻辑
        async function stripImagesFromArrayBuffer(arrayBuffer, fileName) {
            if (!fileName || !/\.xlsx?$/i.test(fileName)) return arrayBuffer;
            try {
                const JSZip = await loadJSZip();
                const zip = await JSZip.loadAsync(arrayBuffer);
                // 删除图片及绘图相关目录
                const toDelete = Object.keys(zip.files).filter(p =>
                    p.startsWith('xl/media/') ||
                    p.startsWith('xl/drawings/') ||
                    (p.startsWith('xl/worksheets/_rels/') && p.endsWith('.rels'))
                );
                for (const p of toDelete) zip.file(p, null);
                // 清理工作表内的 drawing 标签
                for (const p of Object.keys(zip.files).filter(p => p.startsWith('xl/worksheets/sheet') && p.endsWith('.xml'))) {
                    let content = await zip.file(p).async('string');
                    if (content.includes('<drawing')) {
                        content = content.replace(/<drawing[^>]*(\/|>[^<]*<\/drawing>)/g, '');
                        zip.file(p, content);
                    }
                }
                // 清理 workbook 关系文件中的 drawing 引用
                const relsPath = 'xl/_rels/workbook.xml.rels';
                if (zip.files[relsPath]) {
                    let rels = await zip.file(relsPath).async('string');
                    rels = rels.replace(/<Relationship[^>]*Target="xl\/drawings\/[^"]*"[^>]*\/?>/g, '');
                    zip.file(relsPath, rels);
                }
                const newBuf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
                console.log(`[图片清理] ${fileName}: ${(arrayBuffer.byteLength / 1048576).toFixed(2)}MB → ${(newBuf.byteLength / 1048576).toFixed(2)}MB`);
                return newBuf;
            } catch (e) {
                console.warn(`清理失败: ${fileName}`, e);
                return arrayBuffer;
            }
        }

        // 劫持 FileReader.readAsArrayBuffer
        const originalReadAsArrayBuffer = FileReader.prototype.readAsArrayBuffer;
        FileReader.prototype.readAsArrayBuffer = function(file) {
            if (file && file.name && /\.xlsx?$/i.test(file.name)) {
                const self = this;
                (async () => {
                    try {
                        const originalBuf = await file.arrayBuffer();
                        const cleaned = await stripImagesFromArrayBuffer(originalBuf, file.name);
                        Object.defineProperty(self, 'result', { value: cleaned, configurable: true });
                        self.readyState = FileReader.DONE;
                        self.dispatchEvent(new ProgressEvent('load', { loaded: cleaned.byteLength, total: cleaned.byteLength }));
                    } catch (err) {
                        originalReadAsArrayBuffer.call(self, file);
                    }
                })();
            } else {
                originalReadAsArrayBuffer.call(this, file);
            }
        };

        // 劫持 Blob.prototype.arrayBuffer
        const originalBlobArrayBuffer = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = async function() {
            const isExcel = this.name && /\.xlsx?$/i.test(this.name);
            const buf = await originalBlobArrayBuffer.call(this);
            if (isExcel) return stripImagesFromArrayBuffer(buf, this.name);
            return buf;
        };

        console.log('✅ 图片清理器已激活（按需加载），所有后续 Excel 文件上传将被自动清理');
    }

    // 扫描当前已存在的文件输入框
    function scanExistingInputs() {
        const inputs = document.querySelectorAll('input[type="file"]');
        for (let input of inputs) {
            if (isExcelFileInput(input)) {
                initCleaner();
                return true;
            }
        }
        return false;
    }

    // 监听未来动态添加的 input
    function watchForNewInputs() {
        observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === 1) { // 元素节点
                        if (node.matches && node.matches('input[type="file"]') && isExcelFileInput(node)) {
                            initCleaner();
                            return;
                        }
                        // 检查子元素
                        if (node.querySelectorAll) {
                            const inputs = node.querySelectorAll('input[type="file"]');
                            for (let input of inputs) {
                                if (isExcelFileInput(input)) {
                                    initCleaner();
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // 启动检测
    if (!scanExistingInputs()) {
        // 当前没有 Excel 文件输入框，开始监听未来添加的
        watchForNewInputs();
        console.log('🔍 未检测到 Excel 文件输入框，已开启动态监听，待出现后自动激活图片清理器');
    }
})();