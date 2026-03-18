let ipcRenderer = null;
try {
  if (typeof require === 'function') ipcRenderer = require('electron').ipcRenderer;
} catch (_) {}

const HANDLE_OFFSET_PX = 10;
const dirs = [[-1,-1], [1,-1], [1,1], [-1,1]];

let mockupImg = null, wallpaperImg = null;
let corners = null;
let cornerRadius = 0;
let fitMode = 'fill';
let frameTemplateName = '';
let frameTemplateImg = null;
let selectedTemplateId = '';
let wallpaperOffsetX = 0, wallpaperOffsetY = 0;
let wallpaperScale = 1;
let wallpaperDragStart = null;
let canvasEl, ctx, canvasWrap, anchorOverlay;
let displayW = 0, displayH = 0;
let dragIdx = -1;
let sliderThrottleId = null;
const SLIDER_THROTTLE_MS = 40;

function scheduleSliderUpdate(doUpdateAnchor) {
  if (sliderThrottleId != null) return;
  sliderThrottleId = setTimeout(() => {
    sliderThrottleId = null;
    requestAnimationFrame(() => {
      if (doUpdateAnchor) updateAnchorSvg();
      render();
    });
  }, SLIDER_THROTTLE_MS);
}

function init() {
  canvasEl = document.getElementById('canvas');
  ctx = canvasEl.getContext('2d');
  canvasWrap = document.getElementById('canvasWrap');
  anchorOverlay = document.getElementById('anchorOverlay');

  document.getElementById('btnMockup').onclick = () => document.getElementById('inputMockup').click();
  document.getElementById('btnWallpaper').onclick = () => document.getElementById('inputWallpaper').click();

  document.getElementById('inputMockup').onchange = e => handleFile(e.target, loadMockup);
  document.getElementById('inputWallpaper').onchange = e => handleFile(e.target, loadWallpaper);

  document.getElementById('dropZone').ondragover = e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); };
  document.getElementById('dropZone').ondragleave = e => { e.currentTarget.classList.remove('dragover'); };
  document.getElementById('dropZone').ondrop = e => {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (!f || !/\.(jpg|jpeg|png|webp|svg)$/i.test(f.name)) return;
    if (!mockupImg) loadMockup(f);
    else loadWallpaper(f);
  };

  document.getElementById('radiusSlider').oninput = function() {
    cornerRadius = +this.value;
    document.getElementById('radiusVal').textContent = cornerRadius;
    scheduleSliderUpdate(true);
  };

  document.getElementById('wallpaperScaleSlider').oninput = function() {
    wallpaperScale = +this.value / 100;
    document.getElementById('wallpaperScaleVal').textContent = wallpaperScale.toFixed(1) + 'x';
    scheduleSliderUpdate(false);
  };

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fitMode = btn.dataset.mode;
      wallpaperOffsetX = 0;
      wallpaperOffsetY = 0;
      render();
    };
  });

  loadFrameTemplates();
  document.getElementById('frameSelect').onchange = () => {
    frameTemplateName = document.getElementById('frameSelect').value;
    loadFrameTemplate(frameTemplateName);
  };

  refreshTemplateList();
  document.getElementById('btnSaveTemplate').onclick = () => openSaveTemplateModal();
  document.getElementById('btnCancelSave').onclick = () => closeSaveTemplateModal();
  document.getElementById('btnConfirmSave').onclick = () => confirmSaveTemplate();
  document.getElementById('saveTemplateModal').onclick = e => {
    if (e.target.id === 'saveTemplateModal') closeSaveTemplateModal();
  };
  document.getElementById('templateNameInput').onkeydown = e => {
    if (e.key === 'Enter') confirmSaveTemplate();
    if (e.key === 'Escape') closeSaveTemplateModal();
  };

  anchorOverlay.onmousedown = e => {
    const c = e.target.closest('.corner');
    if (c) {
      dragIdx = +c.dataset.i;
      return;
    }
    if (wallpaperImg && corners && isPointInAnchor(e.clientX, e.clientY)) {
      wallpaperDragStart = { x: e.clientX, y: e.clientY };
    }
  };
  document.onmousemove = e => {
    if (wallpaperDragStart) {
      const dx = e.clientX - wallpaperDragStart.x;
      const dy = e.clientY - wallpaperDragStart.y;
      const rect = canvasEl.getBoundingClientRect();
      const scale = Math.min(displayW / rect.width, displayH / rect.height);
      wallpaperOffsetX -= dx * scale;
      wallpaperOffsetY -= dy * scale;
      wallpaperDragStart = { x: e.clientX, y: e.clientY };
      render();
      return;
    }
    if (dragIdx < 0 || !corners) return;
    const rect = canvasEl.getBoundingClientRect();
    const hx = (e.clientX - rect.left) / rect.width;
    const hy = (e.clientY - rect.top) / rect.height;
    corners[dragIdx] = cornerFromHandle({ x: hx, y: hy }, dragIdx);
    corners[dragIdx].x = Math.max(0.05, Math.min(0.95, corners[dragIdx].x));
    corners[dragIdx].y = Math.max(0.05, Math.min(0.95, corners[dragIdx].y));
    updateHandles();
    updateAnchorSvg();
  };
  document.onmouseup = () => {
    if (dragIdx >= 0) render();
    dragIdx = -1;
    wallpaperDragStart = null;
  };

  document.getElementById('btnPreview').onclick = showPreview;
  document.getElementById('btnExport').onclick = exportImage;
  document.getElementById('btnClear').onclick = clearAll;
  document.getElementById('btnSaveTemplateFromPreview').onclick = () => openSaveTemplateModal();
  document.getElementById('btnClearTemplates').onclick = clearAllTemplates;
  document.getElementById('btnBack').onclick = () => document.getElementById('previewModal').classList.remove('show');
  document.getElementById('btnExportPreview').onclick = exportImage;
}

function clearAll() {
  mockupImg = null;
  wallpaperImg = null;
  corners = null;
  cornerRadius = 0;
  fitMode = 'fill';
  wallpaperOffsetX = 0;
  wallpaperOffsetY = 0;
  wallpaperScale = 1;
  selectedTemplateId = '';
  document.getElementById('placeholder').style.display = 'block';
  canvasWrap.style.display = 'none';
  document.getElementById('btnWallpaper').disabled = true;
  document.getElementById('btnPreview').disabled = true;
  document.getElementById('btnExport').disabled = true;
  document.getElementById('radiusSlider').value = 0;
  document.getElementById('radiusVal').textContent = '0';
  document.getElementById('wallpaperScaleSlider').value = 100;
  document.getElementById('wallpaperScaleVal').textContent = '1.0x';
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'fill');
  });
  refreshTemplateList();
}

function clearAllTemplates() {
  if (!confirm('确定要清空所有锚点模板吗？')) return;
  if (ipcRenderer) ipcRenderer.invoke('clear-all-template-mockups').catch(() => {});
  setStoredTemplates([]);
  selectedTemplateId = '';
  refreshTemplateList();
  showToast('已清空所有模板');
}

function handleFile(input, loader) {
  const f = input.files[0];
  if (!f) return;
  loader(f);
  input.value = '';
}

function loadMockup(f) {
  const img = new Image();
  img.onload = () => {
    mockupImg = img;
    selectedTemplateId = '';
    refreshTemplateList();
    wallpaperImg = null;
    document.getElementById('btnPreview').disabled = true;
    document.getElementById('btnExport').disabled = true;
    initCorners();
    document.getElementById('placeholder').style.display = 'none';
    canvasWrap.style.display = 'block';
    document.getElementById('btnWallpaper').disabled = false;
    render();
    setTimeout(updateHandles, 50);
    setTimeout(updateAnchorSvg, 50);
  };
  img.onerror = () => alert('图片加载失败');
  img.src = URL.createObjectURL(f);
}

function loadWallpaper(f) {
  const img = new Image();
  img.onload = () => {
    wallpaperImg = img;
    wallpaperOffsetX = 0;
    wallpaperOffsetY = 0;
    document.getElementById('btnPreview').disabled = false;
    document.getElementById('btnExport').disabled = false;
    render();
  };
  img.onerror = () => alert('图片加载失败');
  img.src = URL.createObjectURL(f);
}

async function loadFrameTemplates() {
  const sel = document.getElementById('frameSelect');
  sel.innerHTML = '<option value="">无</option>';
  let files = [];
  if (ipcRenderer) {
    try { files = await ipcRenderer.invoke('list-frame-templates'); } catch (_) {}
  }
  if (files.length === 0) {
    files = ['手机模板-毛玻璃.png', '手机模板-清透玻璃.png', '手机模板-黑.png'];
  }
  files.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/\.(png|jpg|jpeg|webp)$/i, '');
    sel.appendChild(opt);
  });
}

const TEMPLATE_STORAGE_KEY = 'wallpaper-mockup-templates';

function getStoredTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function setStoredTemplates(arr) {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(arr));
}

function captureThumbnail() {
  if (!canvasEl || !ctx || canvasEl.width === 0) return null;
  const tw = 90, th = 120;
  const tmp = document.createElement('canvas');
  tmp.width = tw;
  tmp.height = th;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(canvasEl, 0, 0, canvasEl.width, canvasEl.height, 0, 0, tw, th);
  return tmp.toDataURL('image/jpeg', 0.7);
}

function captureMockupData() {
  if (!mockupImg || mockupImg.width === 0) return null;
  const maxDim = 1920;
  let w = mockupImg.width, h = mockupImg.height;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d').drawImage(mockupImg, 0, 0, w, h);
  return tmp.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function refreshTemplateList() {
  const list = document.getElementById('templateList');
  const templates = getStoredTemplates();
  list.innerHTML = '';
  templates.forEach(t => {
    const card = document.createElement('div');
    card.className = 'template-card' + (t.id === selectedTemplateId ? ' selected' : '');
    card.dataset.id = t.id;
    const inner = document.createElement('div');
    inner.className = 'template-card-inner';
    inner.onclick = (e) => { if (!e.target.closest('.template-card-del')) selectTemplate(t.id); };
    const img = document.createElement('img');
    img.className = 'template-card-thumb';
    img.src = t.thumbnail || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="120"><rect fill="#242424" width="90" height="120"/><text x="45" y="60" fill="#888" font-size="12" text-anchor="middle" dominant-baseline="middle">无预览</text></svg>');
    img.alt = t.name;
    img.onerror = () => { img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="120"><rect fill="#242424" width="90" height="120"/><text x="45" y="60" fill="#888" font-size="12" text-anchor="middle" dominant-baseline="middle">无预览</text></svg>'); };
    const label = document.createElement('div');
    label.className = 'template-card-name';
    label.textContent = t.name;
    const delBtn = document.createElement('button');
    delBtn.className = 'template-card-del';
    delBtn.textContent = '×';
    delBtn.title = '删除';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteTemplate(t.id); };
    inner.appendChild(img);
    inner.appendChild(label);
    card.appendChild(inner);
    card.appendChild(delBtn);
    list.appendChild(card);
  });
}

function deleteTemplate(id) {
  if (!confirm('确定要删除此模板吗？')) return;
  if (ipcRenderer) ipcRenderer.invoke('delete-template-mockup', id).catch(() => {});
  const templates = getStoredTemplates().filter(x => x.id !== id);
  setStoredTemplates(templates);
  if (selectedTemplateId === id) selectedTemplateId = '';
  refreshTemplateList();
  showToast('已删除');
}

function selectTemplate(id) {
  selectedTemplateId = id;
  refreshTemplateList();
  if (id) loadTemplate(id);
}

function openSaveTemplateModal() {
  if (!corners || !mockupImg) {
    showToast('请先上传样机图并设置锚点');
    return;
  }
  document.getElementById('templateNameInput').value = '模板 ' + (getStoredTemplates().length + 1);
  document.getElementById('saveTemplateModal').classList.add('show');
  setTimeout(() => document.getElementById('templateNameInput').focus(), 50);
}

function closeSaveTemplateModal() {
  document.getElementById('saveTemplateModal').classList.remove('show');
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2000);
}

async function confirmSaveTemplate() {
  const name = document.getElementById('templateNameInput').value.trim();
  if (!name) {
    showToast('请输入模板名称');
    return;
  }
  closeSaveTemplateModal();
  render();
  const thumbnail = captureThumbnail();
  const mockupBase64 = captureMockupData();
  const t = {
    id: 't' + Date.now(),
    name,
    corners: corners.map(c => ({ x: c.x, y: c.y })),
    cornerRadius,
    fitMode,
    frameTemplateName,
    thumbnail,
    createdAt: Date.now()
  };
  if (ipcRenderer && mockupBase64) {
    try {
      await ipcRenderer.invoke('save-template-mockup', t.id, mockupBase64);
    } catch (_) {}
  } else if (mockupBase64) {
    t.mockupDataUrl = 'data:image/jpeg;base64,' + mockupBase64;
  }
  const templates = getStoredTemplates();
  templates.push(t);
  setStoredTemplates(templates);
  selectedTemplateId = t.id;
  refreshTemplateList();
  showToast('模板已保存');
}

function applyTemplateAnchor(t) {
  corners = t.corners.map(c => ({ x: c.x, y: c.y }));
  cornerRadius = t.cornerRadius;
  fitMode = t.fitMode;
  frameTemplateName = t.frameTemplateName || '';
  document.getElementById('radiusSlider').value = cornerRadius;
  document.getElementById('radiusVal').textContent = cornerRadius;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === fitMode);
  });
  document.getElementById('frameSelect').value = frameTemplateName;
  loadFrameTemplate(frameTemplateName);
  updateHandles();
  updateAnchorSvg();
  render();
}

function loadTemplate(id) {
  const templates = getStoredTemplates();
  const t = templates.find(x => x.id === id);
  if (!t) return;
  const applyAnchorSettings = () => {
    wallpaperImg = null;
    document.getElementById('btnPreview').disabled = true;
    document.getElementById('btnExport').disabled = true;
    if (mockupImg) {
      document.getElementById('placeholder').style.display = 'none';
      canvasWrap.style.display = 'block';
      document.getElementById('btnWallpaper').disabled = false;
    }
    applyTemplateAnchor(t);
  };
  if (ipcRenderer) {
    ipcRenderer.invoke('get-template-mockup-path', t.id).then(filePath => {
      if (filePath) {
        const img = new Image();
        img.onload = () => {
          mockupImg = img;
          applyAnchorSettings();
        };
        img.onerror = () => {
          if (t.mockupDataUrl) {
            const img2 = new Image();
            img2.onload = () => { mockupImg = img2; applyAnchorSettings(); };
            img2.onerror = () => { showToast('样机图加载失败'); applyAnchorSettings(); };
            img2.src = t.mockupDataUrl;
          } else {
            showToast('该模板无样机图数据');
            applyAnchorSettings();
          }
        };
        img.src = 'file://' + filePath.replace(/\\/g, '/').replace(/ /g, '%20');
      } else if (t.mockupDataUrl) {
        const img = new Image();
        img.onload = () => {
          mockupImg = img;
          applyAnchorSettings();
        };
        img.onerror = () => applyAnchorSettings();
        img.src = t.mockupDataUrl;
      } else {
        showToast('该模板无样机图，请先上传样机图');
        applyAnchorSettings();
      }
    }).catch(() => applyAnchorSettings());
  } else if (t.mockupDataUrl) {
    const img = new Image();
    img.onload = () => {
      mockupImg = img;
      applyAnchorSettings();
    };
    img.onerror = () => applyAnchorSettings();
    img.src = t.mockupDataUrl;
  } else {
    showToast('该模板无样机图，请先上传样机图');
    applyAnchorSettings();
  }
}

function loadFrameTemplate(filename) {
  if (!filename) {
    frameTemplateImg = null;
    render();
    return;
  }
  const img = new Image();
  img.onload = () => {
    frameTemplateImg = img;
    render();
  };
  img.onerror = () => { frameTemplateImg = null; render(); };
  if (ipcRenderer) {
    ipcRenderer.invoke('get-frame-template-path', filename).then(p => {
      img.src = 'file://' + p.replace(/\\/g, '/');
    }).catch(() => { frameTemplateImg = null; render(); });
  } else {
    img.src = 'frame-templates/' + filename;
  }
}

function initCorners() {
  corners = [
    { x: 0.25, y: 0.2 }, { x: 0.75, y: 0.2 },
    { x: 0.75, y: 0.8 }, { x: 0.25, y: 0.8 }
  ];
  updateHandles();
  updateAnchorSvg();
}

function getHandlePos(i) {
  const c = corners[i], d = dirs[i];
  const rect = canvasEl.getBoundingClientRect();
  const offX = HANDLE_OFFSET_PX / rect.width, offY = HANDLE_OFFSET_PX / rect.height;
  return { x: c.x + d[0] * offX, y: c.y + d[1] * offY };
}

function isPointInAnchor(clientX, clientY) {
  if (!corners || !canvasEl || !mockupImg) return false;
  const rect = canvasEl.getBoundingClientRect();
  const px = (clientX - rect.left) * (displayW / rect.width);
  const py = (clientY - rect.top) * (displayH / rect.height);
  const pts = corners.map(c => ({ x: c.x * displayW, y: c.y * displayH }));
  const r = Math.min(cornerRadius * displayW / 500, 0.15 * Math.min(displayW, displayH));
  const path = new Path2D(roundedPath(pts, r));
  return ctx.isPointInPath(path, px, py);
}

function cornerFromHandle(h, i) {
  const d = dirs[i];
  const rect = canvasEl.getBoundingClientRect();
  const offX = HANDLE_OFFSET_PX / rect.width, offY = HANDLE_OFFSET_PX / rect.height;
  return { x: h.x - d[0] * offX, y: h.y - d[1] * offY };
}

function updateHandles() {
  anchorOverlay.querySelectorAll('.corner').forEach((el, i) => {
    const h = getHandlePos(i);
    el.style.left = (h.x * 100) + '%';
    el.style.top = (h.y * 100) + '%';
  });
}

function updateAnchorSvg() {
  const svg = document.getElementById('anchorSvg');
  if (!corners || !mockupImg) return;
  const rect = canvasEl.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  const pts = corners.map(c => ({ x: c.x * w, y: c.y * h }));
  const r = Math.min(cornerRadius * w / 500, 0.2 * Math.min(w, h));
  const path = roundedPath(pts, r);
  svg.innerHTML = `<path d="${path}" fill="rgba(229,57,53,0.15)" stroke="#e53935" stroke-width="2" stroke-dasharray="6,4"/>`;
}

function roundedPath(pts, r) {
  if (r <= 0) return 'M ' + pts.map(p => p.x + ',' + p.y).join(' L ') + ' Z';
  const n = pts.length;
  const trim = (a, b, len) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-6) return { ...a };
    const t = Math.min(len / d, 0.5);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const p1 = pts.map((_, i) => trim(pts[i], pts[(i - 1 + n) % n], r));
  const p2 = pts.map((_, i) => trim(pts[i], pts[(i + 1) % n], r));
  let d = 'M ' + p1[0].x + ' ' + p1[0].y;
  for (let i = 0; i < n; i++) {
    d += ' A ' + r + ' ' + r + ' 0 0 1 ' + p2[i].x + ' ' + p2[i].y;
    d += ' L ' + p1[(i + 1) % n].x + ' ' + p1[(i + 1) % n].y;
  }
  return d + ' Z';
}

function buildClipPath(ctx, dst, r) {
  if (r <= 0) {
    ctx.moveTo(dst[0].x, dst[0].y);
    dst.forEach((p, i) => i && ctx.lineTo(p.x, p.y));
  } else {
    const n = dst.length;
    const trim = (a, b, len) => {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 1e-6) return a;
      const t = Math.min(len / d, 0.5);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    const p1 = dst.map((_, i) => trim(dst[i], dst[(i - 1 + n) % n], r));
    const p2 = dst.map((_, i) => trim(dst[i], dst[(i + 1) % n], r));
    ctx.moveTo(p1[0].x, p1[0].y);
    for (let i = 0; i < n; i++) {
      ctx.arcTo(dst[i].x, dst[i].y, p2[i].x, p2[i].y, r);
      ctx.lineTo(p1[(i + 1) % n].x, p1[(i + 1) % n].y);
    }
  }
  ctx.closePath();
}

function render() {
  if (!mockupImg) return;
  displayW = mockupImg.width;
  displayH = mockupImg.height;
  canvasEl.width = displayW;
  canvasEl.height = displayH;
  var maxW = canvasWrap.parentElement ? canvasWrap.parentElement.offsetWidth - 48 : 900;
  var maxH = (window.innerHeight || 600) - 200;
  var scale = Math.min(maxW / displayW, maxH / displayH, 1);
  canvasEl.style.width = (displayW * scale) + 'px';
  canvasEl.style.height = (displayH * scale) + 'px';
  ctx.drawImage(mockupImg, 0, 0);

  if (!corners) return;

  const dst = corners.map(c => ({ x: c.x * displayW, y: c.y * displayH }));
  const r = Math.min(cornerRadius * displayW / 500, 0.15 * Math.min(displayW, displayH));

  if (wallpaperImg) {
    const offscreen = document.createElement('canvas');
    offscreen.width = displayW;
    offscreen.height = displayH;
    const offCtx = offscreen.getContext('2d');
    offCtx.clearRect(0, 0, displayW, displayH);
    offCtx.beginPath();
    buildClipPath(offCtx, dst, r);
    const srcRect = getWallpaperSrcRect();
    const src = [
      { x: srcRect.sx, y: srcRect.sy },
      { x: srcRect.sx + srcRect.sw, y: srcRect.sy },
      { x: srcRect.sx + srcRect.sw, y: srcRect.sy + srcRect.sh },
      { x: srcRect.sx, y: srcRect.sy + srcRect.sh }
    ];
    const matrix = getPerspectiveMatrix(src, dst);
    if (matrix) {
      const inv = invert3x3(matrix);
      const wp = getWallpaperPixels();
      const b = dst.reduce((a, p) => ({ minX: Math.min(a.minX, p.x), minY: Math.min(a.minY, p.y), maxX: Math.max(a.maxX, p.x), maxY: Math.max(a.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const imgData = offCtx.getImageData(0, 0, displayW, displayH);
      for (let py = Math.max(0, ~~b.minY); py < Math.min(displayH, ~~b.maxY + 1); py++) {
        for (let px = Math.max(0, ~~b.minX); px < Math.min(displayW, ~~b.maxX + 1); px++) {
          if (!offCtx.isPointInPath(px, py)) continue;
          const s = transformPoint(inv, px, py);
          if (s.x >= 0 && s.x < wallpaperImg.width - 1 && s.y >= 0 && s.y < wallpaperImg.height - 1) {
            const u = s.x - (s.x | 0), v = s.y - (s.y | 0);
            const i = ((s.x | 0) + (s.y | 0) * wallpaperImg.width) * 4;
            const bil = (o) => Math.round((wp[i + o] * (1 - u) + wp[i + 4 + o] * u) * (1 - v) + (wp[i + wallpaperImg.width * 4 + o] * (1 - u) + wp[i + wallpaperImg.width * 4 + 4 + o] * u) * v);
            const di = (px + py * displayW) * 4;
            if (bil(3) > 10) {
              imgData.data[di] = bil(0);
              imgData.data[di + 1] = bil(1);
              imgData.data[di + 2] = bil(2);
              imgData.data[di + 3] = 255;
            }
          }
        }
      }
      offCtx.putImageData(imgData, 0, 0);
    }
    ctx.save();
    ctx.beginPath();
    buildClipPath(ctx, dst, r);
    ctx.clip();
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }

  if (frameTemplateImg) {
    const offscreen = document.createElement('canvas');
    offscreen.width = displayW;
    offscreen.height = displayH;
    const offCtx = offscreen.getContext('2d');
    offCtx.clearRect(0, 0, displayW, displayH);
    offCtx.beginPath();
    buildClipPath(offCtx, dst, r);
    const src = [
      { x: 0, y: 0 },
      { x: frameTemplateImg.width, y: 0 },
      { x: frameTemplateImg.width, y: frameTemplateImg.height },
      { x: 0, y: frameTemplateImg.height }
    ];
    const matrix = getPerspectiveMatrix(src, dst);
    if (matrix) {
      const inv = invert3x3(matrix);
      const fc = document.createElement('canvas');
      fc.width = frameTemplateImg.width;
      fc.height = frameTemplateImg.height;
      fc.getContext('2d').drawImage(frameTemplateImg, 0, 0);
      const fpData = fc.getContext('2d').getImageData(0, 0, frameTemplateImg.width, frameTemplateImg.height).data;
      const b = dst.reduce((a, p) => ({ minX: Math.min(a.minX, p.x), minY: Math.min(a.minY, p.y), maxX: Math.max(a.maxX, p.x), maxY: Math.max(a.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const imgData = offCtx.getImageData(0, 0, displayW, displayH);
      for (let py = Math.max(0, ~~b.minY); py < Math.min(displayH, ~~b.maxY + 1); py++) {
        for (let px = Math.max(0, ~~b.minX); px < Math.min(displayW, ~~b.maxX + 1); px++) {
          if (!offCtx.isPointInPath(px, py)) continue;
          const s = transformPoint(inv, px, py);
          if (s.x >= 0 && s.x < frameTemplateImg.width - 1 && s.y >= 0 && s.y < frameTemplateImg.height - 1) {
            const u = s.x - (s.x | 0), v = s.y - (s.y | 0);
            const i = ((s.x | 0) + (s.y | 0) * frameTemplateImg.width) * 4;
            const bil = (o) => Math.round((fpData[i + o] * (1 - u) + fpData[i + 4 + o] * u) * (1 - v) + (fpData[i + frameTemplateImg.width * 4 + o] * (1 - u) + fpData[i + frameTemplateImg.width * 4 + 4 + o] * u) * v);
            const di = (px + py * displayW) * 4;
            const fa = bil(3);
            if (fa > 2) {
              imgData.data[di] = bil(0);
              imgData.data[di + 1] = bil(1);
              imgData.data[di + 2] = bil(2);
              imgData.data[di + 3] = fa;
            }
          }
        }
      }
      offCtx.putImageData(imgData, 0, 0);
    }
    ctx.save();
    ctx.beginPath();
    buildClipPath(ctx, dst, r);
    ctx.clip();
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }
}

function getQuadDimensions() {
  const c = corners;
  const top = Math.hypot((c[1].x - c[0].x) * displayW, (c[1].y - c[0].y) * displayH);
  const bottom = Math.hypot((c[2].x - c[3].x) * displayW, (c[2].y - c[3].y) * displayH);
  const left = Math.hypot((c[3].x - c[0].x) * displayW, (c[3].y - c[0].y) * displayH);
  const right = Math.hypot((c[2].x - c[1].x) * displayW, (c[2].y - c[1].y) * displayH);
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  return { w, h };
}

function getWallpaperSrcRect() {
  const { w, h } = getQuadDimensions();
  let sx, sy, sw, sh;
  if (fitMode === 'fill' || fitMode === 'crop') {
    const scale = Math.max(wallpaperImg.width / w, wallpaperImg.height / h);
    sw = wallpaperImg.width / scale;
    sh = wallpaperImg.height / scale;
    sx = (wallpaperImg.width - sw) / 2;
    sy = (wallpaperImg.height - sh) / 2;
  } else if (fitMode === 'fit') {
    const scale = Math.min(wallpaperImg.width / w, wallpaperImg.height / h);
    sw = wallpaperImg.width / scale;
    sh = wallpaperImg.height / scale;
    sx = (wallpaperImg.width - sw) / 2;
    sy = (wallpaperImg.height - sh) / 2;
  }
  sw /= wallpaperScale;
  sh /= wallpaperScale;
  sw = Math.min(sw, wallpaperImg.width);
  sh = Math.min(sh, wallpaperImg.height);
  sx = (wallpaperImg.width - sw) / 2;
  sy = (wallpaperImg.height - sh) / 2;
  if (fitMode === 'fit' || fitMode === 'fill' || fitMode === 'crop') {
    const maxOx = Math.max(0, wallpaperImg.width - sw);
    const maxOy = Math.max(0, wallpaperImg.height - sh);
    sx = Math.max(0, Math.min(maxOx, sx + wallpaperOffsetX));
    sy = Math.max(0, Math.min(maxOy, sy + wallpaperOffsetY));
  }
  return { sx, sy, sw, sh };
}

function getWallpaperPixels() {
  const c = document.createElement('canvas');
  c.width = wallpaperImg.width;
  c.height = wallpaperImg.height;
  c.getContext('2d').drawImage(wallpaperImg, 0, 0);
  return c.getContext('2d').getImageData(0, 0, wallpaperImg.width, wallpaperImg.height).data;
}

function getPerspectiveMatrix(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i], d = dst[i];
    A.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y], [0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.x, d.y);
  }
  const h = solve8(A, b);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
}

function solve8(A, b) {
  const n = 8, aug = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let mr = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(aug[r][c]) > Math.abs(aug[mr][c])) mr = r;
    [aug[c], aug[mr]] = [aug[mr], aug[c]];
    const p = aug[c][c];
    if (Math.abs(p) < 1e-10) return null;
    for (let r = c + 1; r < n; r++) {
      const f = aug[r][c] / p;
      for (let k = c; k <= n; k++) aug[r][k] -= f * aug[c][k];
    }
  }
  const x = [];
  for (let i = n - 1; i >= 0; i--) {
    let s = aug[i][n];
    for (let j = i + 1; j < n; j++) s -= aug[i][j] * x[j];
    x[i] = s / aug[i][i];
  }
  return x;
}

function transformPoint(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

function invert3x3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  return [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

function showPreview() {
  render();
  document.getElementById('previewImg').src = canvasEl.toDataURL('image/png');
  document.getElementById('previewModal').classList.add('show');
}

async function exportImage() {
  render();
  const blob = await new Promise(r => canvasEl.toBlob(r, 'image/png'));
  if (ipcRenderer) {
    const buf = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const name = '样机_' + Date.now() + '.png';
    const path = await ipcRenderer.invoke('save-dialog', name, 'png');
    if (path) ipcRenderer.invoke('write-file', path, buf);
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '样机_' + Date.now() + '.png';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

init();
