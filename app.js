let appData = { titleToId: {}, nodes: [] };
let scale = 0.34, panX = 0, panY = 0;

// Expliziter Ebenen-Zustand: Bleibt beim freien Zoomen fixiert, bis eine andere Ebene gewählt
// oder die aktive Ebene erneut angeklickt (abgewählt) wird.
let viewLevel = 'macro'; // 'macro' | 'meso' | 'micro'
let activeDomainId = null;
let activeTopicId = null;
let activeReaderNodeId = null;
let maxGradeFilter = null; // null = Alle (5-Q2), sonst 5..13
let showAllAdmin = false;

let isAdmin = false;
let ghConfig = null;

const DOMAIN_IDS = new Set(['arithmetik-algebra', 'geometrie', 'analysis', 'stochastik']);
const APPLE_DOMAIN_PALETTES = {
  'arithmetik-algebra': ['#64B5F6', '#799CF2', '#9586E8', '#B07CE0'],
  'geometrie':          ['#5AC8B0', '#6CC490', '#88BE74', '#A8BA63'],
  'analysis':           ['#F2C95C', '#F0A65A', '#EB8663', '#E36D6D'],
  'stochastik':         ['#A982C4', '#C27FB3', '#D6809F', '#E28A8E']
};

const VAULT_STORAGE_KEY = 'mw_encrypted_vault_v1';
const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const nodesLayer = document.getElementById('nodesLayer');
const edgesSvg = document.getElementById('edges');

function formatGradeBadge(g) {
  if (!g) return 'ab Kl. 5';
  if (g === 11) return 'ab EF';
  if (g === 12) return 'ab Q1';
  if (g === 13) return 'ab Q2';
  return `ab Kl. ${g}`;
}

function getDomainRootId(node, nodeMap) {
  let curr = node;
  const seen = new Set();
  while (curr && curr.parentId && nodeMap.has(curr.parentId) && !seen.has(curr.id)) {
    seen.add(curr.id);
    curr = nodeMap.get(curr.parentId);
  }
  return curr ? curr.id : 'arithmetik-algebra';
}

function computeDepth(node, nodeMap) {
  let d = 1;
  let curr = node;
  const seen = new Set();
  while (curr && curr.parentId && nodeMap.has(curr.parentId) && !seen.has(curr.id)) {
    seen.add(curr.id);
    d += 1;
    curr = nodeMap.get(curr.parentId);
  }
  return d;
}

function enrichNodeHierarchyAndColors() {
  const nodeMap = new Map(appData.nodes.map(n => [n.id, n]));
  appData.nodes.forEach(n => {
    if (DOMAIN_IDS.has(n.id) || n.parentId === null) {
      n.level = 1;
      n.parentId = null;
    }
    if (typeof n.minGrade !== 'number') {
      n.minGrade = n.level === 1 ? 5 : 7;
    }
  });

  appData.nodes.forEach(n => {
    const depth = computeDepth(n, nodeMap);
    n.depth = depth;
    const rootId = getDomainRootId(n, nodeMap);
    const palette = APPLE_DOMAIN_PALETTES[rootId] || APPLE_DOMAIN_PALETTES['arithmetik-algebra'];
    const dIdx = Math.min(palette.length - 1, Math.max(0, depth - 1));
    const pIdx = Math.max(0, dIdx - 1);
    n.color = palette[dIdx];
    n.parentColor = palette[pIdx];
  });
}

function isNodeAllowedByGrade(node) {
  if (maxGradeFilter === null) return true;
  return (node.minGrade || 5) <= maxGradeFilter;
}

async function init() {
  try {
    const res = await fetch('data/nodes.json?v=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const parsed = await res.json();
    if (parsed && Array.isArray(parsed.nodes)) {
      appData = parsed;
      appData.titleToId = appData.titleToId || {};
      enrichNodeHierarchyAndColors();
    }
  } catch (err) {
    showToast('Hinweis: data/nodes.json konnte nicht geladen werden (' + err.message + ')');
    console.error(err);
  }
  restoreAdminSession();
  buildDomainNav();
  renderAll();
  setupSearch();
  focusOverview();
}

function setGradeFilter(val) {
  maxGradeFilter = val === 'all' ? null : parseInt(val, 10);
  const wrap = document.getElementById('gradeFilterWrap');
  if (wrap) wrap.classList.toggle('active-filter', maxGradeFilter !== null);

  if (activeTopicId) {
    const top = appData.nodes.find(n => n.id === activeTopicId);
    if (top && !isNodeAllowedByGrade(top)) {
      activeTopicId = null;
      const dom = appData.nodes.find(n => n.id === activeDomainId);
      if (dom && isNodeAllowedByGrade(dom)) {
        selectDomain(dom.id, true);
      } else {
        focusOverview();
      }
      buildDomainNav();
      return;
    }
  }
  if (activeDomainId) {
    const dom = appData.nodes.find(n => n.id === activeDomainId);
    if (dom && !isNodeAllowedByGrade(dom)) {
      focusOverview();
      buildDomainNav();
      return;
    }
  }

  buildDomainNav();
  applyVisibilityFilter();
  if (maxGradeFilter !== null) {
    showToast(`Stufenfilter: Bis ${val === '11' ? 'EF' : val === '12' ? 'Q1' : val === '13' ? 'Q2' : 'Klasse ' + val}`);
  }
}

function buildDomainNav() {
  const nav = document.getElementById('domainNav');
  nav.innerHTML = `<button class="crumb-btn" id="crumb-overview" onclick="focusOverview()">Übersicht</button>`;
  appData.nodes.filter(n => n.level === 1 && isNodeAllowedByGrade(n)).forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'crumb-btn';
    btn.id = 'crumb-' + d.id;
    btn.textContent = d.title;
    btn.style.color = d.color;
    btn.onclick = () => selectDomain(d.id);
    nav.appendChild(btn);
  });

  if (viewLevel === 'micro' && activeTopicId) {
    const top = appData.nodes.find(n => n.id === activeTopicId);
    if (top) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      nav.appendChild(sep);

      const topBtn = document.createElement('button');
      topBtn.className = 'crumb-btn crumb-topic active';
      topBtn.textContent = `${top.title} ✕`;
      topBtn.title = 'Erneut klicken, um das Thema abzuwählen';
      topBtn.style.color = top.color;
      topBtn.onclick = () => selectTopic(top.id);
      nav.appendChild(topBtn);
    }
  }
}

// Kürzt Vorschautexte sauber, ohne mitten in LaTeX-Formeln ($$...$$) oder [[Links]] abzuschneiden
function createSafePreview(rawText, maxChars) {
  if (!rawText) return { text: '', wasTruncated: false };
  const clean = rawText.trim();
  if (clean.length <= maxChars) return { text: clean, wasTruncated: false };

  // Finde geschützte Blöcke ($$...$$, $...$, [[...]])
  const protectedRanges = [];
  const tokenRegex = /(\$\$[\s\S]*?\$\$|\$[^$
]+?\$|\[\[[^\]]+?\]\])/g;
  let m;
  while ((m = tokenRegex.exec(clean)) !== null) {
    protectedRanges.push([m.index, m.index + m[0].length]);
  }

  let cut = maxChars;
  for (const [start, end] of protectedRanges) {
    if (cut > start && cut < end) {
      // Wenn ein geschützter Block noch sinnvoll passt, bis nach dem Block schneiden, sonst davor
      cut = (end <= maxChars + 85) ? end : start;
      break;
    }
  }

  if (cut < 40) cut = maxChars;
  const sub = clean.slice(0, cut);
  const lastSpace = sub.lastIndexOf(' ');
  const finalSlice = (lastSpace > 45 && cut < clean.length) ? sub.slice(0, lastSpace) : sub;
  return {
    text: finalSlice.trim() + (finalSlice.trim().length < clean.length ? ' …' : ''),
    wasTruncated: finalSlice.trim().length < clean.length
  };
}

function formatWikiText(rawText, previewLimit = null) {
  if (!rawText) return '';
  let text = rawText.trim();
  if (previewLimit !== null) {
    text = createSafePreview(text, previewLimit).text;
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
  const cy1 = y1 + dy * 0.08;
  const cx2 = x2 - dx * 0.45;
  const cy2 = y2 - dy * 0.08;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

function hasReadableContent(node) {
  const hasText = Boolean(node.text && node.text.trim().length > 0);
  const hasMedia = Boolean(node.media && node.media.length > 0);
  return hasText || hasMedia;
}

function renderAll() {
  enrichNodeHierarchyAndColors();
  nodesLayer.innerHTML = '';
  const nodeMap = new Map(appData.nodes.map(n => [n.id, n]));

  appData.nodes.forEach(n => {
    const el = document.createElement('div');
    el.className = `node level-${n.level} depth-${n.depth || n.level}`;
    el.id = 'el-' + n.id;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.setProperty('--node-color', n.color || '#64B5F6');
    el.style.setProperty('--parent-color', n.parentColor || n.color || '#64B5F6');

    const editBtn = `<button class="node-edit-btn" onclick="event.stopPropagation(); openNodeEditor('${n.id}')">✎</button>`;
    const gradeBadge = `<span class="grade-tag">${formatGradeBadge(n.minGrade)}</span>`;

    if (n.level === 1) {
      el.innerHTML = `${editBtn}<span class="domain-pill">${n.tag || 'Hauptgebiet'}</span><h2>${n.title}</h2><p>${n.text || ''}</p>`;
      el.onclick = () => { if (!isAdmin) selectDomain(n.id); };
    } else if (n.level === 2) {
      // Ebene 2: Vorschau mit gerenderten Formeln + direkte Buttons zum Lesen des Inhalts & für Medien!
      const hasContent = hasReadableContent(n);
      const previewHtml = n.text
        ? formatWikiText(n.text, 130)
        : `<p>Themenbereich öffnen</p>`;

      const footerButtons = [];
      if (n.text && n.text.trim()) {
        footerButtons.push(`<button class="chip read-more" onclick="event.stopPropagation(); openNodeReader('${n.id}')">Inhalt lesen</button>`);
      }
      (n.media || []).forEach((m, idx) => {
        const icon = m.type === 'ggb' ? '⬡' : '▶';
        footerButtons.push(`<button class="chip ${m.type}" onclick="event.stopPropagation(); openNodeReader('${n.id}', ${idx})">${icon} ${m.label}</button>`);
      });

      el.innerHTML = `
        ${editBtn}
        <div class="card-meta-row"><span class="domain-badge">${n.domain || ''}</span>${gradeBadge}</div>
        <h3>${n.title}</h3>
        <div class="card-preview-text">${previewHtml}</div>
        <div class="card-footer">${footerButtons.join('')}</div>
      `;
      el.onclick = () => { if (!isAdmin) selectTopic(n.id); };
    } else {
      // Ebene 3+: Jede Karte mit Inhalt ist direkt anklickbar & öffnet die vollständige Reader-Ansicht
      const hasContent = hasReadableContent(n);
      const bodyHtml = formatWikiText(n.text, 230);
      const footerButtons = [];

      if (n.text && n.text.trim()) {
        footerButtons.push(`<button class="chip read-more" onclick="event.stopPropagation(); openNodeReader('${n.id}')">Vollständig lesen</button>`);
      }
      (n.media || []).forEach((m, idx) => {
        const icon = m.type === 'ggb' ? '⬡' : '▶';
        footerButtons.push(`<button class="chip ${m.type}" onclick="event.stopPropagation(); openNodeReader('${n.id}', ${idx})">${icon} ${m.label}</button>`);
      });

      const emptyHint = !hasContent ? `<div class="node-empty-hint">Inhalt folgt</div>` : '';
      el.innerHTML = `
        ${editBtn}
        <div class="card-meta-row"><span class="domain-badge">${n.domain || ''}</span>${gradeBadge}</div>
        <h4>${n.title}</h4>
        ${emptyHint}
        <div class="node-body-text">${bodyHtml}</div>
        <div class="card-footer">${footerButtons.join('')}</div>
      `;
      el.onclick = () => {
        if (isAdmin) return;
        if (hasContent) {
          openNodeReader(n.id);
        }
      };
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
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  edgesSvg.appendChild(defs);

  appData.nodes.forEach(n => {
    if (!n.parentId || !nodeMap.has(n.parentId)) return;
    const p = nodeMap.get(n.parentId);
    const x1 = p.x + 6000, y1 = p.y + 6000;
    const x2 = n.x + 6000, y2 = n.y + 6000;
    const d = buildBezierPath(x1, y1, x2, y2);

    const gradId = `grad-${p.id}-${n.id}`;
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', x1);
    grad.setAttribute('y1', y1);
    grad.setAttribute('x2', x2);
    grad.setAttribute('y2', y2);

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', p.color || '#64B5F6');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', n.color || '#64B5F6');
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);

    const base = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    base.setAttribute('d', d);
    base.setAttribute('class', 'edge-path');
    base.dataset.from = n.parentId;
    base.dataset.to = n.id;
    base.setAttribute('stroke', `url(#${gradId})`);
    base.setAttribute('stroke-opacity', '0.32');
    base.setAttribute('stroke-width', n.level === 2 ? '2.2' : '1.8');
    edgesSvg.appendChild(base);

    const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    flow.setAttribute('d', d);
    flow.setAttribute('class', 'edge-flow');
    flow.dataset.from = n.parentId;
    flow.dataset.to = n.id;
    flow.setAttribute('data-parent', n.parentId);
    flow.setAttribute('stroke', n.color || '#64B5F6');
    flow.setAttribute('stroke-width', n.level === 2 ? '2.8' : '2.2');
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

function applyVisibilityFilter() {
  document.body.setAttribute('data-zoom', viewLevel);
  const visibleIds = new Set();

  if (showAllAdmin && isAdmin) {
    appData.nodes.forEach(n => {
      if (isNodeAllowedByGrade(n)) visibleIds.add(n.id);
    });
  } else if (viewLevel === 'macro') {
    appData.nodes.filter(n => n.level === 1 && isNodeAllowedByGrade(n)).forEach(n => visibleIds.add(n.id));
  } else if (viewLevel === 'meso' && activeDomainId) {
    appData.nodes
      .filter(n => n.level === 2 && n.parentId === activeDomainId && isNodeAllowedByGrade(n))
      .forEach(n => visibleIds.add(n.id));
  } else if (viewLevel === 'micro' && activeTopicId) {
    const topic = appData.nodes.find(n => n.id === activeTopicId && isNodeAllowedByGrade(n));
    if (topic) {
      activeDomainId = topic.parentId;
      visibleIds.add(topic.id);
      appData.nodes.forEach(n => {
        if (n.level === 3 && getAncestors(n.id).has(topic.id) && isNodeAllowedByGrade(n)) {
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
    el.classList.toggle('active-anchor', viewLevel === 'micro' && n.id === activeTopicId);
  });

  document.querySelectorAll('.edge-path, .edge-flow').forEach(path => {
    const bothVisible = visibleIds.has(path.dataset.from) && visibleIds.has(path.dataset.to);
    path.classList.toggle('edge-hidden', !bothVisible);
  });

  buildDomainNav();
  updateHudContext();
}

function updateHudContext() {
  const indicator = document.getElementById('zoom-indicator');
  const brandDot = document.getElementById('brandDot');

  document.querySelectorAll('.crumb-btn').forEach(b => b.classList.remove('active'));

  if (viewLevel === 'macro') {
    indicator.textContent = 'Übersicht';
    indicator.style.color = 'var(--text-secondary)';
    brandDot.style.background = '#64B5F6';
    brandDot.style.boxShadow = '0 0 10px rgba(100,181,246,0.6)';
    const ov = document.getElementById('crumb-overview');
    if (ov) ov.classList.add('active');
  } else {
    const dom = appData.nodes.find(n => n.id === activeDomainId);
    const top = appData.nodes.find(n => n.id === activeTopicId);
    const activeNode = (viewLevel === 'micro' && top) ? top : dom;
    const col = activeNode ? activeNode.color : '#64B5F6';

    brandDot.style.background = col;
    brandDot.style.boxShadow = `0 0 10px ${col}`;
    indicator.style.color = col;

    if (dom) {
      const cb = document.getElementById('crumb-' + dom.id);
      if (cb) cb.classList.add('active');
    }

    if (viewLevel === 'meso') {
      indicator.textContent = dom ? dom.title : 'Themengebiete';
    } else {
      indicator.textContent = top ? `${dom ? dom.title + ' › ' : ''}${top.title}` : 'Lernbausteine';
    }
  }
}

function syncInfiniteGrid() {
  const major = Math.max(28, 140 * scale);
  const minor = major / 5;
  const cx = viewport.clientWidth / 2 + panX;
  const cy = viewport.clientHeight / 2 + panY;
  viewport.style.backgroundSize = `${major}px ${major}px, ${minor}px ${minor}px`;
  viewport.style.backgroundPosition = `${cx}px ${cy}px, ${cx}px ${cy}px`;
}

function updateTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  syncInfiniteGrid();
}

function getInitialOverviewScale() {
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  return minDim < 850 ? 0.25 : 0.34;
}

function focusAt(worldX, worldY, targetScale) {
  scale = targetScale;
  panX = -worldX * scale;
  panY = -worldY * scale;
  updateTransform();
  applyVisibilityFilter();
}

function focusOverview() {
  viewLevel = 'macro';
  activeDomainId = null;
  activeTopicId = null;
  focusAt(0, 0, getInitialOverviewScale());
}

function selectDomain(domainId, forceSelect = false) {
  if (!forceSelect && viewLevel === 'meso' && activeDomainId === domainId) {
    focusOverview();
    return;
  }
  const d = appData.nodes.find(n => n.id === domainId);
  if (!d) return;
  viewLevel = 'meso';
  activeDomainId = d.id;
  activeTopicId = null;
  focusAt(d.x, d.y, 0.72);
}

function selectTopic(topicId, forceSelect = false) {
  if (!forceSelect && viewLevel === 'micro' && activeTopicId === topicId) {
    const parentDomId = activeDomainId;
    if (parentDomId) {
      selectDomain(parentDomId, true);
    } else {
      focusOverview();
    }
    return;
  }
  const t = appData.nodes.find(n => n.id === topicId);
  if (!t) return;
  viewLevel = 'micro';
  activeTopicId = t.id;
  activeDomainId = t.parentId;
  focusAt(t.x + 280, t.y, 0.95);
}

function jumpToNode(nodeId) {
  closeModal('mediaModal');
  const n = appData.nodes.find(item => item.id === nodeId);
  if (!n) return;
  if (!isNodeAllowedByGrade(n)) {
    maxGradeFilter = null;
    const sel = document.getElementById('gradeSelect');
    if (sel) sel.value = 'all';
    const wrap = document.getElementById('gradeFilterWrap');
    if (wrap) wrap.classList.remove('active-filter');
  }
  if (n.level === 1) {
    selectDomain(n.id, true);
  } else if (n.level === 2) {
    selectTopic(n.id, true);
  } else {
    const top = getLevel2Ancestor(n.id);
    const dom = getLevel1Ancestor(n.id);
    viewLevel = 'micro';
    if (top) activeTopicId = top.id;
    if (dom) activeDomainId = dom.id;
    focusAt(n.x, n.y, 1.05);
  }
  setTimeout(() => {
    const el = document.getElementById('el-' + n.id);
    if (el) {
      el.style.boxShadow = `0 0 0 2px ${n.color || '#64B5F6'}, 0 20px 44px rgba(0,0,0,0.4)`;
      setTimeout(() => { el.style.boxShadow = ''; }, 1400);
    }
  }, 120);
}

function zoomAroundScreenPoint(factor, screenX, screenY) {
  const nextScale = Math.min(2.6, Math.max(0.16, scale * factor));
  if (nextScale === scale) return;

  const halfW = viewport.clientWidth / 2;
  const halfH = viewport.clientHeight / 2;
  const offsetX = screenX - halfW;
  const offsetY = screenY - halfH;

  const worldX = (offsetX - panX) / scale;
  const worldY = (offsetY - panY) / scale;

  scale = nextScale;
  panX = offsetX - worldX * scale;
  panY = offsetY - worldY * scale;
  updateTransform();
}

function stepZoom(factor) {
  zoomAroundScreenPoint(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
}

// =========================================================================
// MAUS- UND TOUCH-NAVIGATION
// =========================================================================
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  zoomAroundScreenPoint(factor, e.clientX, e.clientY);
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

let touchMode = null;
let lastTouchX = 0, lastTouchY = 0;
let lastPinchDist = 0;

function getTouchDistance(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchMidpoint(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

viewport.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    touchMode = 'pinch';
    world.classList.add('dragging');
    lastPinchDist = getTouchDistance(e.touches[0], e.touches[1]);
    const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
    lastTouchX = mid.x;
    lastTouchY = mid.y;
  } else if (e.touches.length === 1 && !e.target.closest('.node')) {
    touchMode = 'pan';
    world.classList.add('dragging');
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  }
}, { passive: false });

viewport.addEventListener('touchmove', e => {
  if (touchMode === 'pinch' && e.touches.length === 2) {
    e.preventDefault();
    const dist = getTouchDistance(e.touches[0], e.touches[1]);
    const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
    if (lastPinchDist > 0) {
      const factor = dist / lastPinchDist;
      panX += (mid.x - lastTouchX);
      panY += (mid.y - lastTouchY);
      zoomAroundScreenPoint(factor, mid.x, mid.y);
    }
    lastPinchDist = dist;
    lastTouchX = mid.x;
    lastTouchY = mid.y;
  } else if (touchMode === 'pan' && e.touches.length === 1) {
    e.preventDefault();
    const tx = e.touches[0].clientX;
    const ty = e.touches[0].clientY;
    panX += (tx - lastTouchX);
    panY += (ty - lastTouchY);
    lastTouchX = tx;
    lastTouchY = ty;
    updateTransform();
  }
}, { passive: false });

viewport.addEventListener('touchend', e => {
  if (e.touches.length === 0) {
    touchMode = null;
    world.classList.remove('dragging');
  } else if (e.touches.length === 1) {
    touchMode = 'pan';
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  }
});

window.addEventListener('resize', syncInfiniteGrid);

// Search
function setupSearch() {
  const input = document.getElementById('searchInput');
  const box = document.getElementById('searchResults');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.remove('open'); return; }
    const hits = appData.nodes.filter(n =>
      isNodeAllowedByGrade(n) &&
      (n.title.toLowerCase().includes(q) || (n.text && n.text.toLowerCase().includes(q)))
    ).slice(0, 12);
    box.innerHTML = hits.map(h =>
      `<div class="search-item" onclick="jumpToNode('${h.id}'); document.getElementById('searchResults').classList.remove('open');">
        <span>${h.title}</span><span class="search-domain" style="color:${h.color || '#A1A1A6'}">${h.domain || ''} · ${formatGradeBadge(h.minGrade)}</span>
      </div>`
    ).join('');
    box.classList.toggle('open', hits.length > 0);
  });
}

// =========================================================================
// UNIFIED APPLE READER SHEET (Volltext, Formeln, Medien & Unterthemen)
// =========================================================================
function renderMediaEmbedHtml(m) {
  if (m.type === 'ggb') {
    const ggbId = extractGeoGebraId(m.ggbId || m.url || '');
    return `<iframe src="https://www.geogebra.org/material/iframe/id/${ggbId}/width/860/height/500/border/222226/sfsb/true/smb/false/stb/false/stbh/false/ai/false/asb/false/sri/true/rc/false/ld/false/sdz/true/ctl/false" allowfullscreen></iframe>`;
  }
  const ytId = extractYouTubeId(m.url || '');
  if (ytId) {
    return `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}" allowfullscreen></iframe>`;
  }
  if (m.url) {
    return `<video src="${m.url}" controls autoplay></video>`;
  }
  return `<p style="padding:24px; color:var(--text-secondary);">Keine Medien-URL hinterlegt.</p>`;
}

function switchReaderMedia(nodeId, mediaIdx) {
  const n = appData.nodes.find(item => item.id === nodeId);
  if (!n || !n.media || !n.media[mediaIdx]) return;
  const box = document.getElementById('readerEmbedBox');
  if (box) {
    box.innerHTML = renderMediaEmbedHtml(n.media[mediaIdx]);
  }
  document.querySelectorAll('#readerMediaTabs .chip').forEach((btn, idx) => {
    btn.style.outline = idx === mediaIdx ? '1.5px solid rgba(255,255,255,0.45)' : 'none';
  });
}

function openNodeReader(nodeId, initialMediaIdx = null) {
  const n = appData.nodes.find(item => item.id === nodeId);
  if (!n) return;
  activeReaderNodeId = n.id;

  const badgeEl = document.getElementById('m-badge');
  const gradeEl = document.getElementById('m-grade');
  const titleEl = document.getElementById('m-title');
  const editShortcut = document.getElementById('m-edit-shortcut');
  const body = document.getElementById('m-body');

  const levelLabel = n.level === 2 ? 'Themengebiet' : 'Lernbaustein';
  badgeEl.textContent = `${n.domain || levelLabel} · ${levelLabel}`;
  badgeEl.style.color = n.color || '#64B5F6';
  gradeEl.textContent = formatGradeBadge(n.minGrade);
  titleEl.textContent = n.title;
  editShortcut.classList.toggle('hidden', !isAdmin);

  const sections = [];

  // 1) Vollständiger, ungekürzter Inhalt
  if (n.text && n.text.trim()) {
    sections.push(`<div class="reader-prose">${formatWikiText(n.text, null)}</div>`);
  }

  // 2) Interaktive Medien (GeoGebra & Videos) direkt im Sheet
  const mediaList = n.media || [];
  if (mediaList.length > 0) {
    const activeIdx = initialMediaIdx !== null ? initialMediaIdx : 0;
    const tabsHtml = mediaList.map((m, idx) => {
      const icon = m.type === 'ggb' ? '⬡' : '▶';
      const outline = idx === activeIdx ? 'style="outline: 1.5px solid rgba(255,255,255,0.45);"' : '';
      return `<button class="chip ${m.type}" ${outline} onclick="switchReaderMedia('${n.id}', ${idx})">${icon} ${m.label}</button>`;
    }).join('');
    sections.push(`
      <div class="reader-media-tabs" id="readerMediaTabs">${tabsHtml}</div>
      <div class="reader-embed-box" id="readerEmbedBox">${renderMediaEmbedHtml(mediaList[activeIdx])}</div>
    `);
  }

  // 3) Falls vorhanden: Direkte Unterbausteine zum Weiterlesen
  const directChildren = appData.nodes.filter(ch => ch.parentId === n.id && isNodeAllowedByGrade(ch));
  if (directChildren.length > 0) {
    const pills = directChildren.map(ch => `
      <button class="reader-child-pill" onclick="openChildFromReader('${ch.id}')">
        <span>${ch.title}</span>
        <span style="color:${ch.color || '#A1A1A6'}; font-size:0.75rem;">${hasReadableContent(ch) ? 'Öffnen ›' : '›'}</span>
      </button>
    `).join('');
    sections.push(`
      <div class="reader-children-section">
        <div class="reader-children-title">Zugehörige Bausteine (${directChildren.length})</div>
        <div class="reader-children-grid">${pills}</div>
      </div>
    `);
  }

  if (sections.length === 0) {
    sections.push(`<p style="color:var(--text-secondary);">Für diesen Baustein wurde noch kein Text hinterlegt.</p>`);
  }

  body.innerHTML = sections.join('');
  renderMath(body);
  document.getElementById('mediaModal').classList.add('open');
}

function openChildFromReader(childId) {
  const ch = appData.nodes.find(n => n.id === childId);
  if (!ch) return;
  if (hasReadableContent(ch)) {
    openNodeReader(ch.id);
  } else {
    jumpToNode(ch.id);
  }
}

function editFromReader() {
  const id = activeReaderNodeId;
  closeModal('mediaModal');
  if (id) openNodeEditor(id);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'mediaModal') {
    document.getElementById('m-body').innerHTML = '';
    activeReaderNodeId = null;
  }
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
  showToast('Tresor gespeichert & Bearbeitungsmodus aktiv');
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
    showToast('Bearbeitungsmodus aktiv');
  } catch {
    alert('Falsches Admin-Passwort.');
  }
}

function exportVaultString() {
  const v = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => {
    showToast('Verschlüsselter Sync-Code kopiert');
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
      showToast('Sync-Code importiert! Jetzt Passwort eingeben.');
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
  showToast('Bearbeitungsmodus beendet');
}

function toggleShowAll(checked) {
  showAllAdmin = checked;
  applyVisibilityFilter();
}

function autoArrangeActiveCluster() {
  if (!activeTopicId) {
    showToast('Bitte zuerst ein Themengebiet auswählen');
    return;
  }
  const topic = appData.nodes.find(n => n.id === activeTopicId);
  if (!topic) return;

  const kidsMap = new Map(appData.nodes.map(n => [n.id, []]));
  appData.nodes.forEach(n => {
    if (n.parentId && kidsMap.has(n.parentId) && isNodeAllowedByGrade(n)) {
      kidsMap.get(n.parentId).push(n);
    }
  });
  kidsMap.forEach(arr => arr.sort((a, b) => (a.minGrade || 5) - (b.minGrade || 5) || a.title.localeCompare(b.title)));

  function countLeaves(nid) {
    const k = kidsMap.get(nid) || [];
    return k.length === 0 ? 1 : k.reduce((sum, ch) => sum + countLeaves(ch.id), 0);
  }

  const directKids = kidsMap.get(topic.id) || [];
  if (directKids.length === 0) return;

  const rowUnit = 245;
  const colStep = 395;
  const totalUnits = directKids.reduce((s, dk) => s + countLeaves(dk.id), 0);
  let curY = topic.y - ((totalUnits - 1) * rowUnit) / 2;

  function layoutSubtree(curr, depthCol, yCursor) {
    const kids = kidsMap.get(curr.id) || [];
    const span = countLeaves(curr.id);
    curr.x = Math.round(topic.x + depthCol * colStep);
    curr.y = Math.round(yCursor + ((span - 1) * rowUnit) / 2);
    let childY = yCursor;
    kids.forEach(k => {
      const kSpan = countLeaves(k.id);
      layoutSubtree(k, depthCol + 1, childY);
      childY += kSpan * rowUnit;
    });
  }

  directKids.forEach(dk => {
    const span = countLeaves(dk.id);
    layoutSubtree(dk, 1, curY);
    curY += span * rowUnit;
  });

  renderAll();
  showToast('Cluster geordnet');
}

function attachAdminDrag(el, nodeObj) {
  let dragging = false, startMouseX = 0, startMouseY = 0, origX = 0, origY = 0;

  function beginDrag(clientX, clientY) {
    dragging = true;
    el.classList.add('node-dragging');
    startMouseX = clientX;
    startMouseY = clientY;
    origX = nodeObj.x;
    origY = nodeObj.y;
  }

  function moveDrag(clientX, clientY) {
    if (!dragging) return;
    nodeObj.x = Math.round(origX + (clientX - startMouseX) / scale);
    nodeObj.y = Math.round(origY + (clientY - startMouseY) / scale);
    el.style.left = nodeObj.x + 'px';
    el.style.top = nodeObj.y + 'px';
    drawEdges(new Map(appData.nodes.map(n => [n.id, n])));
    applyVisibilityFilter();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('node-dragging');
  }

  el.addEventListener('mousedown', e => {
    if (!isAdmin || e.target.closest('button')) return;
    e.stopPropagation();
    beginDrag(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
  window.addEventListener('mouseup', endDrag);

  el.addEventListener('touchstart', e => {
    if (!isAdmin || e.target.closest('button') || e.touches.length !== 1) return;
    e.stopPropagation();
    beginDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  el.addEventListener('touchmove', e => {
    if (!dragging || e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  el.addEventListener('touchend', endDrag);
  el.addEventListener('touchcancel', endDrag);
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
  const gradeSelect = document.getElementById('ed-grade');

  if (nodeId) {
    const n = appData.nodes.find(item => item.id === nodeId);
    const isRootDomain = DOMAIN_IDS.has(n.id) || n.level === 1;
    if (isRootDomain) n.level = 1;

    document.getElementById('ed-heading').textContent = isRootDomain ? 'Hauptgebiet bearbeiten' : 'Baustein bearbeiten';
    document.getElementById('ed-id').value = n.id;
    document.getElementById('ed-title').value = n.title;
    levelSelect.value = String(n.level);
    levelWrap.classList.toggle('hidden', isRootDomain);
    gradeSelect.value = String(n.minGrade || 5);
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
    gradeSelect.value = String(maxGradeFilter || 7);
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
  const minGrade = parseInt(document.getElementById('ed-grade').value, 10) || 5;
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
    existing.minGrade = minGrade;
    existing.parentId = parentId;
    existing.text = text;
    existing.media = media;
    if (level === 1) {
      existing.domain = title;
    } else if (parentNode) {
      existing.domain = parentNode.domain;
    }
  } else {
    const newId = 'node-' + Date.now();
    appData.titleToId[title] = newId;
    appData.nodes.push({
      id: newId,
      level,
      minGrade,
      parentId,
      domain: level === 1 ? title : (parentNode ? parentNode.domain : 'Algebra'),
      title,
      text,
      x: parentNode ? parentNode.x + 395 : 0,
      y: parentNode ? parentNode.y : 0,
      color: parentNode ? parentNode.color : '#64B5F6',
      media
    });
  }

  renderAll();
  closeModal('editorModal');
  showToast('Änderung übernommen – über „Veröffentlichen“ speichern');
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
    showToast('Veröffentlicht! In ca. 30 Sek. auf GitHub Pages live.');
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
  } finally {
    btn.textContent = 'Veröffentlichen';
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
