let appData = { titleToId: {}, nodes: [] };
let scale = 0.38, panX = 0, panY = 0;
let isAdmin = false;
let ghConfig = null;

const world = document.getElementById('world');
const nodesLayer = document.getElementById('nodesLayer');
const edgesSvg = document.getElementById('edges');

async function init() {
  try {
    const res = await fetch('data/nodes.json?v=' + Date.now());
    appData = await res.json();
  } catch (err) {
    showToast('Fehler beim Laden von data/nodes.json');
    console.error(err);
  }
  restoreAdminSession();
  buildDomainNav();
  renderAll();
  setupSearch();
  updateTransform();
}

function buildDomainNav() {
  const nav = document.getElementById('domainNav');
  nav.innerHTML = `<button class="crumb-btn" onclick="focusAt(0, 0, 0.38)">Übersicht</button>`;
  appData.nodes.filter(n => n.level === 1).forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'crumb-btn';
    btn.textContent = d.title;
    btn.style.borderColor = d.color + '55';
    btn.onclick = () => focusAt(d.x, d.y, 0.78);
    nav.appendChild(btn);
  });
}

// Konvertiert TiddlyWiki-Links [[Label|Ziel]] oder [[Ziel]] in interaktive Sprung-Buttons
function formatWikiText(rawText, truncate = false) {
  if (!rawText) return '';
  let text = rawText;
  if (truncate && text.length > 220) {
    text = text.slice(0, 220) + '…';
  }
  // Escape HTML tags except safe line breaks
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Replace [[Label|Target]] and [[Target]]
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, label, target) => {
    const destTitle = (target || label).trim();
    const targetId = appData.titleToId[destTitle];
    if (targetId) {
      return `<button class="wiki-jump" onclick="event.stopPropagation(); jumpToNode('${targetId}')">${label.trim()}</button>`;
    }
    return `<strong>${label.trim()}</strong>`;
  });
  return text.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function renderMath(el) {
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }
}

function buildBezierPath(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx1 = x1 + dx * 0.45;
  const cy1 = y1 + dy * 0.1;
  const cx2 = x2 - dx * 0.45;
  const cy2 = y2 - dy * 0.1;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

function renderAll() {
  nodesLayer.innerHTML = '';
  const nodeMap = new Map(appData.nodes.map(n => [n.id, n]));

  appData.nodes.forEach(n => {
    const el = document.createElement('div');
    el.className = `node level-${n.level}`;
    el.id = 'el-' + n.id;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.setProperty('--node-color', n.color || '#58C4DD');

    const editBtn = `<button class="node-edit-btn" onclick="event.stopPropagation(); openNodeEditor('${n.id}')">✎</button>`;

    if (n.level === 1) {
      el.innerHTML = `${editBtn}<span class="domain-pill">${n.tag || 'Gebiet'}</span><h2>${n.title}</h2><p>${n.text || ''}</p>`;
      el.onclick = () => { if (!isAdmin) focusAt(n.x, n.y, 0.78); };
    } else if (n.level === 2) {
      const shortDesc = n.text ? n.text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$1').slice(0, 95) + (n.text.length > 95 ? '…' : '') : 'Themencluster erkunden';
      el.innerHTML = `${editBtn}<h3>${n.title}</h3><p>${shortDesc}</p>`;
      el.onclick = () => { if (!isAdmin) focusAt(n.x, n.y, 1.2); };
    } else {
      const isLong = (n.text || '').length > 220;
      const bodyHtml = formatWikiText(n.text, true);
      const chips = (n.media || []).map((m, idx) => {
        const icon = m.type === 'ggb' ? '⬡' : '▶';
        return `<button class="chip ${m.type}" onclick="event.stopPropagation(); openMediaModal('${n.id}', ${idx})">${icon} ${m.label}</button>`;
      });
      if (isLong) {
        chips.push(`<button class="chip expand" onclick="event.stopPropagation(); openFullTextModal('${n.id}')">Mehr lesen</button>`);
      }
      el.innerHTML = `${editBtn}<h4>${n.title}</h4><div class="node-body-text">${bodyHtml}</div><div class="chips">${chips.join('')}</div>`;
    }

    el.addEventListener('mouseenter', () => toggleChildFlows(n.id, true));
    el.addEventListener('mouseleave', () => toggleChildFlows(n.id, false));
    attachAdminDrag(el, n);
    nodesLayer.appendChild(el);
  });

  drawEdges(nodeMap);
  renderMath(nodesLayer);
}

function drawEdges(nodeMap) {
  edgesSvg.innerHTML = '';
  appData.nodes.forEach(n => {
    if (!n.parentId || !nodeMap.has(n.parentId)) return;
    const p = nodeMap.get(n.parentId);
    const d = buildBezierPath(p.x + 6000, p.y + 6000, n.x + 6000, n.y + 6000);

    const base = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    base.setAttribute('d', d);
    base.setAttribute('class', 'edge-path');
    base.setAttribute('stroke', n.color || '#58C4DD');
    base.setAttribute('stroke-opacity', n.level === 2 ? '0.32' : '0.22');
    base.setAttribute('stroke-width', n.level === 2 ? '2.5' : '1.6');
    edgesSvg.appendChild(base);

    const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    flow.setAttribute('d', d);
    flow.setAttribute('class', 'edge-flow');
    flow.setAttribute('data-parent', n.parentId);
    flow.setAttribute('stroke', n.color || '#58C4DD');
    flow.setAttribute('stroke-width', n.level === 2 ? '3' : '2.2');
    edgesSvg.appendChild(flow);
  });
}

function toggleChildFlows(parentId, active) {
  document.querySelectorAll(`.edge-flow[data-parent="${parentId}"]`).forEach(p => p.classList.toggle('active', active));
}

function updateTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  let mode = 'macro', label = 'Übersicht';
  if (scale >= 0.62 && scale < 1.05) { mode = 'meso'; label = 'Themengebiete'; }
  else if (scale >= 1.05) { mode = 'micro'; label = 'Lernbausteine'; }
  document.body.setAttribute('data-zoom', mode);
  document.getElementById('zoom-indicator').textContent = `${label} (${Math.round(scale * 100)}%)`;
}

function focusAt(worldX, worldY, targetScale) {
  scale = targetScale;
  panX = -worldX * scale;
  panY = -worldY * scale;
  updateTransform();
}

function jumpToNode(nodeId) {
  const n = appData.nodes.find(item => item.id === nodeId);
  if (!n) return;
  const targetScale = n.level === 1 ? 0.78 : (n.level === 2 ? 1.15 : 1.25);
  focusAt(n.x, n.y, targetScale);
  const el = document.getElementById('el-' + n.id);
  if (el) {
    el.style.boxShadow = '0 0 36px #58C4DD';
    setTimeout(() => { el.style.boxShadow = ''; }, 1400);
  }
}

function stepZoom(factor) {
  scale = Math.min(2.2, Math.max(0.25, scale * factor));
  updateTransform();
}

// Viewport Pan & Wheel Zoom
const viewport = document.getElementById('viewport');
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  scale = Math.min(2.2, Math.max(0.25, scale * factor));
  updateTransform();
}, { passive: false });

let isPanning = false, startX = 0, startY = 0;
viewport.addEventListener('mousedown', e => {
  if (e.target.closest('.node')) return;
  isPanning = true;
  world.classList.add('dragging');
  startX = e.clientX - panX;
  startY = e.clientY - panY;
});
window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  panX = e.clientX - startX;
  panY = e.clientY - startY;
  updateTransform();
});
window.addEventListener('mouseup', () => {
  isPanning = false;
  world.classList.remove('dragging');
});

// Search
function setupSearch() {
  const input = document.getElementById('searchInput');
  const box = document.getElementById('searchResults');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.remove('open'); return; }
    const hits = appData.nodes.filter(n =>
      n.title.toLowerCase().includes(q) || (n.text && n.text.toLowerCase().includes(q))
    ).slice(0, 12);
    box.innerHTML = hits.map(h =>
      `<div class="search-item" onclick="jumpToNode('${h.id}'); document.getElementById('searchResults').classList.remove('open');">
        <span>${h.title}</span><span class="search-domain">${h.domain || ''}</span>
      </div>`
    ).join('');
    box.classList.toggle('open', hits.length > 0);
  });
}

// Media & Fulltext Modal
function openMediaModal(nodeId, mediaIdx) {
  const n = appData.nodes.find(item => item.id === nodeId);
  if (!n || !n.media || !n.media[mediaIdx]) return;
  const m = n.media[mediaIdx];
  document.getElementById('m-title').textContent = `${n.title} – ${m.label}`;
  const body = document.getElementById('m-body');

  if (m.type === 'ggb') {
    document.getElementById('m-badge').textContent = 'GeoGebra Interaktiv';
    const ggbId = extractGeoGebraId(m.ggbId || m.url || '');
    body.innerHTML = `<iframe src="https://www.geogebra.org/material/iframe/id/${ggbId}/width/860/height/520/border/333333/sfsb/true/smb/false/stb/false/stbh/false/ai/false/asb/false/sri/true/rc/false/ld/false/sdz/true/ctl/false" allowfullscreen></iframe>`;
  } else {
    document.getElementById('m-badge').textContent = m.type === 'vid-base' ? 'Grundlagen-Video' : 'Beispielrechnung';
    const ytId = extractYouTubeId(m.url || '');
    if (ytId) {
      body.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}" allowfullscreen></iframe>`;
    } else if (m.url) {
      body.innerHTML = `<video src="${m.url}" controls autoplay></video>`;
    } else {
      body.innerHTML = `<p style="padding:24px;">Keine Video-URL hinterlegt.</p>`;
    }
  }
  document.getElementById('mediaModal').classList.add('open');
}

function openFullTextModal(nodeId) {
  const n = appData.nodes.find(item => item.id === nodeId);
  if (!n) return;
  document.getElementById('m-badge').textContent = n.domain || 'Lernbaustein';
  document.getElementById('m-title').textContent = n.title;
  const body = document.getElementById('m-body');
  body.innerHTML = `<div class="node-body-text" style="padding:24px; width:100%; font-size:0.95rem;">${formatWikiText(n.text, false)}</div>`;
  renderMath(body);
  document.getElementById('mediaModal').classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'mediaModal') document.getElementById('m-body').innerHTML = '';
}

function extractGeoGebraId(input) {
  const m = input.match(/(?:geogebra\.org\/(?:m|calculator|classic)\/)([a-zA-Z0-9]+)/);
  return m ? m[1] : input.trim();
}

function extractYouTubeId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// --- ADMIN MODE & GITHUB API SYNC ---
function openAdminAuth() {
  document.getElementById('authModal').classList.add('open');
}

function handleAdminLogin(e) {
  e.preventDefault();
  ghConfig = {
    owner: document.getElementById('ghOwner').value.trim(),
    repo: document.getElementById('ghRepo').value.trim(),
    branch: document.getElementById('ghBranch').value.trim(),
    token: document.getElementById('ghToken').value.trim()
  };
  sessionStorage.setItem('mw_gh_cfg', JSON.stringify(ghConfig));
  activateAdminUI();
  closeModal('authModal');
  showToast('Admin-Modus aktiviert');
}

function restoreAdminSession() {
  const saved = sessionStorage.getItem('mw_gh_cfg');
  if (saved) {
    ghConfig = JSON.parse(saved);
    activateAdminUI();
  }
}

function activateAdminUI() {
  isAdmin = true;
  document.body.classList.add('is-admin');
  document.getElementById('adminBar').classList.remove('hidden');
  document.getElementById('adminLoginBtn').classList.add('hidden');
}

function logoutAdmin() {
  isAdmin = false;
  ghConfig = null;
  sessionStorage.removeItem('mw_gh_cfg');
  document.body.classList.remove('is-admin');
  document.getElementById('adminBar').classList.add('hidden');
  document.getElementById('adminLoginBtn').classList.remove('hidden');
  showToast('Abgemeldet');
}

function attachAdminDrag(el, nodeObj) {
  let dragging = false, startMouseX = 0, startMouseY = 0, origX = 0, origY = 0;
  el.addEventListener('mousedown', e => {
    if (!isAdmin || e.target.closest('button')) return;
    e.stopPropagation();
    dragging = true;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    origX = nodeObj.x;
    origY = nodeObj.y;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    nodeObj.x = Math.round(origX + (e.clientX - startMouseX) / scale);
    nodeObj.y = Math.round(origY + (e.clientY - startMouseY) / scale);
    el.style.left = nodeObj.x + 'px';
    el.style.top = nodeObj.y + 'px';
    drawEdges(new Map(appData.nodes.map(n => [n.id, n])));
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

function openNodeEditor(nodeId) {
  const parentSelect = document.getElementById('ed-parent');
  parentSelect.innerHTML = appData.nodes
    .filter(n => n.level <= 2 || n.id !== nodeId)
    .map(n => `<option value="${n.id}">[Ebene ${n.level}] ${n.title}</option>`)
    .join('');

  const ggbList = document.getElementById('ed-ggb-list');
  const vidList = document.getElementById('ed-vid-list');
  ggbList.innerHTML = '';
  vidList.innerHTML = '';

  if (nodeId) {
    const n = appData.nodes.find(item => item.id === nodeId);
    document.getElementById('ed-heading').textContent = 'Baustein bearbeiten';
    document.getElementById('ed-id').value = n.id;
    document.getElementById('ed-title').value = n.title;
    document.getElementById('ed-level').value = String(n.level === 1 ? 2 : n.level);
    parentSelect.value = n.parentId || '';
    document.getElementById('ed-text').value = n.text || '';
    document.getElementById('ed-delete-btn').classList.remove('hidden');

    (n.media || []).forEach(m => {
      if (m.type === 'ggb') addMediaRow('ggb', m.label, m.ggbId || m.url || '');
      else addMediaRow(m.type, m.label, m.url || '');
    });
  } else {
    document.getElementById('ed-heading').textContent = 'Neuen Baustein anlegen';
    document.getElementById('ed-id').value = '';
    document.getElementById('ed-title').value = '';
    document.getElementById('ed-level').value = '3';
    document.getElementById('ed-text').value = '';
    document.getElementById('ed-delete-btn').classList.add('hidden');
  }
  document.getElementById('editorModal').classList.add('open');
}

function addMediaRow(type, label = '', value = '') {
  const container = type === 'ggb' ? document.getElementById('ed-ggb-list') : document.getElementById('ed-vid-list');
  const row = document.createElement('div');
  row.className = 'media-row';
  row.dataset.type = type;
  const placeholder = type === 'ggb' ? 'GeoGebra-ID oder Link' : 'YouTube-Link oder MP4-URL';
  row.innerHTML = `
    <input type="text" class="m-label" placeholder="Button-Titel" value="${label}" required />
    <input type="text" class="m-val" placeholder="${placeholder}" value="${value}" required />
    <button type="button" class="btn-danger" onclick="this.parentElement.remove()">&times;</button>
  `;
  container.appendChild(row);
}

function saveNodeFromEditor(e) {
  e.preventDefault();
  const id = document.getElementById('ed-id').value;
  const title = document.getElementById('ed-title').value.trim();
  const level = parseInt(document.getElementById('ed-level').value, 10);
  const parentId = document.getElementById('ed-parent').value;
  const text = document.getElementById('ed-text').value;

  const media = [];
  document.querySelectorAll('#ed-ggb-list .media-row').forEach(r => {
    media.push({ type: 'ggb', label: r.querySelector('.m-label').value.trim(), ggbId: extractGeoGebraId(r.querySelector('.m-val').value) });
  });
  document.querySelectorAll('#ed-vid-list .media-row').forEach(r => {
    media.push({ type: r.dataset.type, label: r.querySelector('.m-label').value.trim(), url: r.querySelector('.m-val').value.trim() });
  });

  const parentNode = appData.nodes.find(n => n.id === parentId);
  if (id) {
    const existing = appData.nodes.find(n => n.id === id);
    existing.title = title;
    existing.level = level;
    existing.parentId = parentId;
    existing.text = text;
    existing.media = media;
    if (parentNode) { existing.color = parentNode.color; existing.domain = parentNode.domain; }
  } else {
    const newId = 'node-' + Date.now();
    appData.titleToId[title] = newId;
    appData.nodes.push({
      id: newId,
      level,
      parentId,
      domain: parentNode ? parentNode.domain : 'Algebra',
      title,
      text,
      x: parentNode ? parentNode.x + 260 : 0,
      y: parentNode ? parentNode.y + 180 : 0,
      color: parentNode ? parentNode.color : '#58C4DD',
      media
    });
  }

  renderAll();
  closeModal('editorModal');
  showToast('Änderung lokal übernommen – jetzt „Auf GitHub speichern“ klicken');
}

function deleteCurrentNode() {
  const id = document.getElementById('ed-id').value;
  if (!id) return;
  appData.nodes = appData.nodes.filter(n => n.id !== id);
  renderAll();
  closeModal('editorModal');
  showToast('Baustein entfernt');
}

async function saveToGitHub() {
  if (!ghConfig) return;
  const btn = document.getElementById('saveGithubBtn');
  btn.textContent = 'Speichere…';
  btn.disabled = true;

  const apiUrl = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/data/nodes.json`;
  const headers = {
    'Authorization': `Bearer ${ghConfig.token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };

  try {
    let sha = undefined;
    const getRes = await fetch(`${apiUrl}?ref=${ghConfig.branch}`, { headers });
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    const jsonString = JSON.stringify(appData, null, 2);
    const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: 'Update Mathe-Wissensraum via Admin-UI',
        content: base64Content,
        branch: ghConfig.branch,
        ...(sha ? { sha } : {})
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || 'GitHub API Fehler');
    }
    showToast('Erfolgreich auf GitHub gespeichert! Live in ca. 30 Sek.');
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
  } finally {
    btn.textContent = 'Auf GitHub speichern';
    btn.disabled = false;
  }
}

function downloadJsonBackup() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nodes.json';
  a.click();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

init();
