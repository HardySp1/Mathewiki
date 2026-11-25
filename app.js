let appData = { titleToId: {}, nodes: [] };
let scale = 0.34, panX = 0, panY = 0;
let activeDomainId = null;
let activeTopicId = null;
let showAllAdmin = false;

let isAdmin = false;
let ghConfig = null;

const DOMAIN_IDS = new Set(['arithmetik-algebra', 'geometrie', 'analysis', 'stochastik']);
const VAULT_STORAGE_KEY = 'mw_encrypted_vault_v1';
const world = document.getElementById('world');
const nodesLayer = document.getElementById('nodesLayer');
const edgesSvg = document.getElementById('edges');

async function init() {
  try {
    const res = await fetch('data/nodes.json?v=' + Date.now());
    appData = await res.json();
    // Sicherstellen, dass die 4 Hauptgebiete immer exakt Ebene 1 bleiben
    appData.nodes.forEach(n => {
      if (DOMAIN_IDS.has(n.id) || n.parentId === null) {
        n.level = 1;
        n.parentId = null;
      }
    });
  } catch (err) {
    showToast('Fehler beim Laden von data/nodes.json');
    console.error(err);
  }
  restoreAdminSession();
  buildDomainNav();
  renderAll();
  setupSearch();
  focusOverview();
}

function buildDomainNav() {
  const nav = document.getElementById('domainNav');
  nav.innerHTML = `<button class="crumb-btn" id="crumb-overview" onclick="focusOverview()">Übersicht</button>`;
  appData.nodes.filter(n => n.level === 1).forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'crumb-btn';
    btn.id = 'crumb-' + d.id;
    btn.textContent = d.title;
    btn.style.borderColor = d.color + '66';
    btn.style.color = d.color;
    btn.onclick = () => selectDomain(d.id);
    nav.appendChild(btn);
  });
}

function formatWikiText(rawText, truncate = false) {
  if (!rawText) return '';
  let text = rawText;
  if (truncate && text.length > 200) {
    text = text.slice(0, 200) + '…';
  }
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    const isRootDomain = DOMAIN_IDS.has(n.id) || n.level === 1;
    if (isRootDomain) n.level = 1;

    const el = document.createElement('div');
    el.className = `node level-${n.level}`;
    el.id = 'el-' + n.id;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.setProperty('--node-color', n.color || '#58C4DD');

    const editBtn = `<button class="node-edit-btn" onclick="event.stopPropagation(); openNodeEditor('${n.id}')">✎</button>`;

    if (n.level === 1) {
      el.innerHTML = `${editBtn}<span class="domain-pill">${n.tag || 'Hauptgebiet'}</span><h2>${n.title}</h2><p>${n.text || ''}</p>`;
      el.onclick = () => { if (!isAdmin) selectDomain(n.id); };
    } else if (n.level === 2) {
      const shortDesc = n.text
        ? n.text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$1').slice(0, 95) + (n.text.length > 95 ? '…' : '')
        : 'Themenbereich erkunden';
      el.innerHTML = `${editBtn}<span class="domain-badge">${n.domain || ''}</span><h3>${n.title}</h3><p>${shortDesc}</p>`;
      el.onclick = () => { if (!isAdmin) selectTopic(n.id); };
    } else {
      const isLong = (n.text || '').length > 200;
      const bodyHtml = formatWikiText(n.text, true);
      const chips = (n.media || []).map((m, idx) => {
        const icon = m.type === 'ggb' ? '⬡' : '▶';
        return `<button class="chip ${m.type}" onclick="event.stopPropagation(); openMediaModal('${n.id}', ${idx})">${icon} ${m.label}</button>`;
      });
      if (isLong) {
        chips.push(`<button class="chip expand" onclick="event.stopPropagation(); openFullTextModal('${n.id}')">Mehr lesen</button>`);
      }
      const emptyHint = (!bodyHtml && chips.length === 0) ? `<div class="node-empty-hint">Inhalt folgt</div>` : '';
      el.innerHTML = `${editBtn}<span class="domain-badge">${n.domain || ''}</span><h4>${n.title}</h4>${emptyHint}<div class="node-body-text">${bodyHtml}</div><div class="chips">${chips.join('')}</div>`;
    }

    el.addEventListener('mouseenter', () => toggleChildFlows(n.id, true));
    el.addEventListener('mouseleave', () => toggleChildFlows(n.id, false));
    attachAdminDrag(el, n);
    nodesLayer.appendChild(el);
  });

  drawEdges(nodeMap);
  renderMath(nodesLayer);
  applyVisibilityFilter();
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
    base.dataset.from = n.parentId;
    base.dataset.to = n.id;
    base.setAttribute('stroke', n.color || '#58C4DD');
    base.setAttribute('stroke-opacity', n.level === 2 ? '0.35' : '0.26');
    base.setAttribute('stroke-width', n.level === 2 ? '2.4' : '1.8');
    edgesSvg.appendChild(base);

    const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    flow.setAttribute('d', d);
    flow.setAttribute('class', 'edge-flow');
    flow.dataset.from = n.parentId;
    flow.dataset.to = n.id;
    flow.setAttribute('data-parent', n.parentId);
    flow.setAttribute('stroke', n.color || '#58C4DD');
    flow.setAttribute('stroke-width', n.level === 2 ? '3' : '2.2');
    edgesSvg.appendChild(flow);
  });
}

function toggleChildFlows(parentId, active) {
  document.querySelectorAll(`.edge-flow[data-parent="${parentId}"]`).forEach(p => {
    if (!p.classList.contains('edge-hidden')) {
      p.classList.toggle('active', active);
    }
  });
}

function getAncestors(nodeId) {
  const chain = new Set();
  const nodeMap = new Map(appData.nodes.map(n => [n.id, n]));
  let curr = nodeMap.get(nodeId);
  while (curr) {
    chain.add(curr.id);
    curr = curr.parentId ? nodeMap.get(curr.parentId) : null;
  }
  return chain;
}

function getLevel2Ancestor(nodeId) {
  const nodeMap = new Map(appData.nodes.map(n => [n.id, n]));
  let curr = nodeMap.get(nodeId);
  while (curr) {
    if (curr.level === 2) return curr;
    curr = curr.parentId ? nodeMap.get(curr.parentId) : null;
  }
  return null;
}

function getLevel1Ancestor(nodeId) {
  const nodeMap = new Map(appData.nodes.map(n => [n.id, n]));
  let curr = nodeMap.get(nodeId);
  while (curr) {
    if (curr.level === 1) return curr;
    curr = curr.parentId ? nodeMap.get(curr.parentId) : null;
  }
  return null;
}

function findNearestNodeAtLevel(level, worldX, worldY) {
  let best = null, bestDist = Infinity;
  appData.nodes.filter(n => n.level === level).forEach(n => {
    const d = Math.hypot(n.x - worldX, n.y - worldY);
    if (d < bestDist) { bestDist = d; best = n; }
  });
  return best;
}

function applyVisibilityFilter() {
  const mode = document.body.getAttribute('data-zoom') || 'macro';
  const visibleIds = new Set();

  if (showAllAdmin && isAdmin) {
    appData.nodes.forEach(n => visibleIds.add(n.id));
  } else if (mode === 'macro') {
    appData.nodes.filter(n => n.level === 1).forEach(n => visibleIds.add(n.id));
  } else if (mode === 'meso') {
    const centerWorldX = -panX / scale;
    const centerWorldY = -panY / scale;
    const domain = (activeDomainId && appData.nodes.find(n => n.id === activeDomainId))
      || findNearestNodeAtLevel(1, centerWorldX, centerWorldY);
    if (domain) {
      activeDomainId = domain.id;
      appData.nodes.filter(n => n.level === 2 && n.parentId === domain.id).forEach(n => visibleIds.add(n.id));
    }
  } else if (mode === 'micro') {
    const centerWorldX = -panX / scale;
    const centerWorldY = -panY / scale;
    const topic = (activeTopicId && appData.nodes.find(n => n.id === activeTopicId))
      || findNearestNodeAtLevel(2, centerWorldX, centerWorldY);
    if (topic) {
      activeTopicId = topic.id;
      activeDomainId = topic.parentId;
      visibleIds.add(topic.id);
      appData.nodes.forEach(n => {
        if (n.level === 3 && getAncestors(n.id).has(topic.id)) {
          visibleIds.add(n.id);
        }
      });
    }
  }

  appData.nodes.forEach(n => {
    const el = document.getElementById('el-' + n.id);
    if (!el) return;
    const isVis = visibleIds.has(n.id);
    el.classList.toggle('node-hidden', !isVis);
    el.classList.toggle('active-anchor', mode === 'micro' && n.id === activeTopicId);
  });

  document.querySelectorAll('.edge-path, .edge-flow').forEach(path => {
    const bothVisible = visibleIds.has(path.dataset.from) && visibleIds.has(path.dataset.to);
    path.classList.toggle('edge-hidden', !bothVisible);
  });

  updateHudContext();
}

function updateHudContext() {
  const mode = document.body.getAttribute('data-zoom') || 'macro';
  const indicator = document.getElementById('zoom-indicator');
  const brandDot = document.getElementById('brandDot');

  document.querySelectorAll('.crumb-btn').forEach(b => b.classList.remove('active'));

  if (mode === 'macro') {
    indicator.textContent = 'Ebene 1: Übersicht';
    indicator.style.color = '#58C4DD';
    indicator.style.borderColor = 'rgba(88,196,221,0.3)';
    brandDot.style.background = '#58C4DD';
    brandDot.style.boxShadow = '0 0 12px #58C4DD';
    const ov = document.getElementById('crumb-overview');
    if (ov) ov.classList.add('active');
  } else {
    const dom = appData.nodes.find(n => n.id === activeDomainId);
    const col = dom ? dom.color : '#58C4DD';
    brandDot.style.background = col;
    brandDot.style.boxShadow = `0 0 12px ${col}`;
    indicator.style.color = col;
    indicator.style.borderColor = col + '55';

    if (dom) {
      const cb = document.getElementById('crumb-' + dom.id);
      if (cb) cb.classList.add('active');
    }

    if (mode === 'meso') {
      indicator.textContent = dom ? `${dom.title} · Themengebiete` : 'Themengebiete';
    } else {
      const top = appData.nodes.find(n => n.id === activeTopicId);
      indicator.textContent = top ? `${dom ? dom.title + ' › ' : ''}${top.title}` : 'Lernbausteine';
    }
  }
}

function updateTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  let mode = 'macro';
  if (scale >= 0.60 && scale < 0.96) mode = 'meso';
  else if (scale >= 0.96) mode = 'micro';
  document.body.setAttribute('data-zoom', mode);
  applyVisibilityFilter();
}

function focusAt(worldX, worldY, targetScale) {
  scale = targetScale;
  panX = -worldX * scale;
  panY = -worldY * scale;
  updateTransform();
}

function focusOverview() {
  activeDomainId = null;
  activeTopicId = null;
  focusAt(0, 0, 0.34);
}

function selectDomain(domainId) {
  const d = appData.nodes.find(n => n.id === domainId);
  if (!d) return;
  activeDomainId = d.id;
  activeTopicId = null;
  focusAt(d.x, d.y, 0.76);
}

function selectTopic(topicId) {
  const t = appData.nodes.find(n => n.id === topicId);
  if (!t) return;
  activeTopicId = t.id;
  activeDomainId = t.parentId;
  // Etwas weiterer Zoomfaktor (0.98), damit alle umliegenden Bausteine sofort übersichtlich im Blick sind
  focusAt(t.x, t.y, 0.98);
}

function jumpToNode(nodeId) {
  const n = appData.nodes.find(item => item.id === nodeId);
  if (!n) return;
  if (n.level === 1) {
    selectDomain(n.id);
  } else if (n.level === 2) {
    selectTopic(n.id);
  } else {
    const top = getLevel2Ancestor(n.id);
    const dom = getLevel1Ancestor(n.id);
    if (top) activeTopicId = top.id;
    if (dom) activeDomainId = dom.id;
    focusAt(n.x, n.y, 1.05);
  }
  setTimeout(() => {
    const el = document.getElementById('el-' + n.id);
    if (el) {
      el.style.boxShadow = `0 0 38px ${n.color || '#58C4DD'}`;
      setTimeout(() => { el.style.boxShadow = ''; }, 1400);
    }
  }, 120);
}

function stepZoom(factor) {
  scale = Math.min(2.2, Math.max(0.24, scale * factor));
  updateTransform();
}

// Viewport Pan & Wheel Zoom
const viewport = document.getElementById('viewport');
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  const nextScale = Math.min(2.2, Math.max(0.24, scale * factor));
  const centerWorldX = -panX / scale;
  const centerWorldY = -panY / scale;
  if (scale < 0.60 && nextScale >= 0.60 && !activeDomainId) {
    const nearestDom = findNearestNodeAtLevel(1, centerWorldX, centerWorldY);
    if (nearestDom) activeDomainId = nearestDom.id;
  }
  if (scale < 0.96 && nextScale >= 0.96 && !activeTopicId) {
    const nearestTop = findNearestNodeAtLevel(2, centerWorldX, centerWorldY);
    if (nearestTop) activeTopicId = nearestTop.id;
  }
  scale = nextScale;
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
        <span>${h.title}</span><span class="search-domain" style="color:${h.color || '#94a3b8'}">${h.domain || ''}</span>
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

// =========================================================================
// PASSWORT-TRESOR
// =========================================================================
async function deriveAesKey(password, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVault(payloadObj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(payloadObj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return JSON.stringify({
    s: btoa(String.fromCharCode(...salt)),
    i: btoa(String.fromCharCode(...iv)),
    c: btoa(String.fromCharCode(...new Uint8Array(cipher)))
  });
}

async function decryptVault(vaultJsonStr, password) {
  const { s, i, c } = JSON.parse(vaultJsonStr);
  const salt = Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
  const iv = Uint8Array.from(atob(i), ch => ch.charCodeAt(0));
  const cipher = Uint8Array.from(atob(c), ch => ch.charCodeAt(0));
  const key = await deriveAesKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

function switchAuthView(view) {
  const hasVault = Boolean(localStorage.getItem(VAULT_STORAGE_KEY));
  const target = view || (hasVault ? 'unlock' : 'setup');
  document.getElementById('unlockForm').classList.toggle('hidden', target !== 'unlock');
  document.getElementById('setupForm').classList.toggle('hidden', target !== 'setup');
  document.getElementById('authModalTitle').textContent =
    target === 'unlock' ? 'Admin-Passwort eingeben' : 'Admin-Zugang einmalig einrichten';
}

function openAdminAuth() {
  switchAuthView();
  document.getElementById('authModal').classList.add('open');
  setTimeout(() => {
    const inp = document.getElementById('unlockForm').classList.contains('hidden')
      ? document.getElementById('ghToken')
      : document.getElementById('unlockPassword');
    if (inp) inp.focus();
  }, 50);
}

async function handleVaultSetup(e) {
  e.preventDefault();
  const cfg = {
    owner: document.getElementById('ghOwner').value.trim(),
    repo: document.getElementById('ghRepo').value.trim(),
    branch: document.getElementById('ghBranch').value.trim(),
    token: document.getElementById('ghToken').value.trim()
  };
  const pw = document.getElementById('newVaultPassword').value;
  const encrypted = await encryptVault(cfg, pw);
  localStorage.setItem(VAULT_STORAGE_KEY, encrypted);
  sessionStorage.setItem('mw_gh_cfg', JSON.stringify(cfg));
  ghConfig = cfg;
  activateAdminUI();
  closeModal('authModal');
  showToast('Tresor gespeichert & Admin-Modus aktiv!');
}

async function handleVaultUnlock(e) {
  e.preventDefault();
  const pw = document.getElementById('unlockPassword').value;
  const vaultStr = localStorage.getItem(VAULT_STORAGE_KEY);
  try {
    const cfg = await decryptVault(vaultStr, pw);
    ghConfig = cfg;
    sessionStorage.setItem('mw_gh_cfg', JSON.stringify(cfg));
    document.getElementById('unlockPassword').value = '';
    activateAdminUI();
    closeModal('authModal');
    showToast('Willkommen zurück! Admin-Modus aktiv.');
  } catch {
    alert('Falsches Admin-Passwort.');
  }
}

function exportVaultString() {
  const v = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => {
    showToast('Verschlüsselter Sync-Code in Zwischenablage kopiert!');
  });
}

function importVaultPrompt() {
  const code = prompt('Füge hier den verschlüsselten Sync-Code von deinem anderen Gerät ein:');
  if (!code) return;
  try {
    const parsed = JSON.parse(code.trim());
    if (parsed.s && parsed.i && parsed.c) {
      localStorage.setItem(VAULT_STORAGE_KEY, code.trim());
      switchAuthView('unlock');
      showToast('Sync-Code importiert! Jetzt mit deinem Passwort entsperren.');
    } else {
      alert('Ungültiger Sync-Code.');
    }
  } catch {
    alert('Ungültiges Format.');
  }
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
  showAllAdmin = false;
  const toggle = document.getElementById('showAllToggle');
  if (toggle) toggle.checked = false;
  sessionStorage.removeItem('mw_gh_cfg');
  document.body.classList.remove('is-admin');
  document.getElementById('adminBar').classList.add('hidden');
  document.getElementById('adminLoginBtn').classList.remove('hidden');
  applyVisibilityFilter();
  showToast('Abgemeldet');
}

function toggleShowAll(checked) {
  showAllAdmin = checked;
  applyVisibilityFilter();
}

// Admin-Helfer: Aktives Cluster auf Knopfdruck symmetrisch im Raster aufräumen
function autoArrangeActiveCluster() {
  if (!activeTopicId) {
    showToast('Bitte zuerst in ein Themengebiet (Ebene 3) hineinzoomen');
    return;
  }
  const topic = appData.nodes.find(n => n.id === activeTopicId);
  if (!topic) return;

  const clusterCards = appData.nodes.filter(n => n.level === 3 && getAncestors(n.id).has(topic.id));
  const leftWing = clusterCards.filter((_, i) => i % 2 === 0);
  const rightWing = clusterCards.filter((_, i) => i % 2 === 1);
  const colW = 365, rowH = 250, maxRows = 4;

  rightWing.forEach((card, i) => {
    const col = Math.floor(i / maxRows);
    const row = i % maxRows;
    const rowsInCol = Math.min(maxRows, rightWing.length - col * maxRows);
    card.x = Math.round(topic.x + 380 + col * colW);
    card.y = Math.round(topic.y + (row - (rowsInCol - 1) / 2) * rowH);
  });

  leftWing.forEach((card, i) => {
    const col = Math.floor(i / maxRows);
    const row = i % maxRows;
    const rowsInCol = Math.min(maxRows, leftWing.length - col * maxRows);
    card.x = Math.round(topic.x - 380 - col * colW);
    card.y = Math.round(topic.y + (row - (rowsInCol - 1) / 2) * rowH);
  });

  renderAll();
  showToast('Cluster sauber ausgerichtet');
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
    applyVisibilityFilter();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

function toggleParentSelectVisibility() {
  const lvl = document.getElementById('ed-level').value;
  document.getElementById('ed-parent-wrap').classList.toggle('hidden', lvl === '1');
}

function openNodeEditor(nodeId) {
  const parentSelect = document.getElementById('ed-parent');
  parentSelect.innerHTML = appData.nodes
    .filter(n => n.id !== nodeId)
    .map(n => `<option value="${n.id}">[Ebene ${n.level}] ${n.title}</option>`)
    .join('');

  const ggbList = document.getElementById('ed-ggb-list');
  const vidList = document.getElementById('ed-vid-list');
  ggbList.innerHTML = '';
  vidList.innerHTML = '';

  const levelWrap = document.getElementById('ed-level-wrap');
  const levelSelect = document.getElementById('ed-level');

  if (nodeId) {
    const n = appData.nodes.find(item => item.id === nodeId);
    const isRootDomain = DOMAIN_IDS.has(n.id) || n.level === 1;
    if (isRootDomain) n.level = 1;

    document.getElementById('ed-heading').textContent = isRootDomain ? 'Hauptgebiet (Kreis) bearbeiten' : 'Baustein bearbeiten';
    document.getElementById('ed-id').value = n.id;
    document.getElementById('ed-title').value = n.title;
    levelSelect.value = String(n.level);
    // Hauptgebiete (Ebene 1) behalten ihre Ebene fest verriegelt, damit sie niemals versehentlich zu Rechtecken werden
    levelWrap.classList.toggle('hidden', isRootDomain);
    parentSelect.value = n.parentId || '';
    document.getElementById('ed-text').value = n.text || '';
    document.getElementById('ed-delete-btn').classList.toggle('hidden', isRootDomain);

    (n.media || []).forEach(m => {
      if (m.type === 'ggb') addMediaRow('ggb', m.label, m.ggbId || m.url || '');
      else addMediaRow(m.type, m.label, m.url || '');
    });
  } else {
    document.getElementById('ed-heading').textContent = 'Neuen Baustein anlegen';
    document.getElementById('ed-id').value = '';
    document.getElementById('ed-title').value = '';
    levelWrap.classList.remove('hidden');
    levelSelect.value = activeTopicId ? '3' : '2';
    if (activeTopicId) parentSelect.value = activeTopicId;
    else if (activeDomainId) parentSelect.value = activeDomainId;
    document.getElementById('ed-text').value = '';
    document.getElementById('ed-delete-btn').classList.add('hidden');
  }
  toggleParentSelectVisibility();
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
  const isRootDomain = DOMAIN_IDS.has(id);
  const parsedLevel = parseInt(document.getElementById('ed-level').value, 10);
  const level = isRootDomain ? 1 : (Number.isNaN(parsedLevel) ? 3 : parsedLevel);
  const parentId = level === 1 ? null : document.getElementById('ed-parent').value;
  const text = document.getElementById('ed-text').value;

  const media = [];
  document.querySelectorAll('#ed-ggb-list .media-row').forEach(r => {
    media.push({ type: 'ggb', label: r.querySelector('.m-label').value.trim(), ggbId: extractGeoGebraId(r.querySelector('.m-val').value) });
  });
  document.querySelectorAll('#ed-vid-list .media-row').forEach(r => {
    media.push({ type: r.dataset.type, label: r.querySelector('.m-label').value.trim(), url: r.querySelector('.m-val').value.trim() });
  });

  const parentNode = parentId ? appData.nodes.find(n => n.id === parentId) : null;
  if (id) {
    const existing = appData.nodes.find(n => n.id === id);
    existing.title = title;
    existing.level = level;
    existing.parentId = parentId;
    existing.text = text;
    existing.media = media;
    if (level === 1) {
      existing.domain = title;
    } else if (parentNode) {
      existing.color = parentNode.color;
      existing.domain = parentNode.domain;
    }
  } else {
    const newId = 'node-' + Date.now();
    appData.titleToId[title] = newId;
    appData.nodes.push({
      id: newId,
      level,
      parentId,
      domain: level === 1 ? title : (parentNode ? parentNode.domain : 'Algebra'),
      title,
      text,
      x: parentNode ? parentNode.x + 380 : 0,
      y: parentNode ? parentNode.y : 0,
      color: parentNode ? parentNode.color : '#58C4DD',
      media
    });
  }

  buildDomainNav();
  renderAll();
  closeModal('editorModal');
  showToast('Änderung übernommen – mit „Auf GitHub speichern“ sichern');
}

function deleteCurrentNode() {
  const id = document.getElementById('ed-id').value;
  if (!id || DOMAIN_IDS.has(id)) return;
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

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

init();
