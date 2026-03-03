import { loadPaper, streamSummarize, streamExtract, streamTranslate, streamChat } from './api.js';
import { createStreamTarget, addChatMessage, updateLastAssistantMessage, showToast, setLoading, renderMarkdown } from './components.js';

const state = { paperId: null, paper: null, chatHistory: [], pdfDoc: null, zoom: 1.0, summaryDone: false, keypointsDone: false, outlineOpen: true };

document.addEventListener('DOMContentLoaded', () => {
  initPaperLoading();
  initPaneTabs();
  initActions();
  initChat();
  initZoom();
  initOutline();
});

// ===== Error mapping =====
function friendlyError(err) {
  const msg = err.message || String(err);
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'Network error — please check your connection and try again.';
  if (msg.includes('404')) return 'Paper not found. Please check the URL and try again.';
  if (msg.includes('403')) return 'Access denied. This paper may not be publicly available.';
  if (msg.includes('timeout') || msg.includes('Timeout')) return 'Request timed out. Please try again.';
  if (msg.includes('CORS')) return 'Cannot access this resource due to cross-origin restrictions.';
  if (msg.includes('Invalid URL') || msg.includes('invalid url')) return 'Invalid URL format. Please enter a valid paper link.';
  if (msg.includes('PDF')) return 'Could not load the PDF. The file may be corrupted or unavailable.';
  return msg;
}

// ===== Paper Loading =====
function initPaperLoading() {
  const urlInput = document.getElementById('paper-url');
  const loadBtn = document.getElementById('load-btn');
  loadBtn.addEventListener('click', () => handleLoad(urlInput.value));
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleLoad(urlInput.value); });
  document.querySelectorAll('.example-link').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); urlInput.value = el.dataset.url; handleLoad(el.dataset.url); });
  });
}

async function handleLoad(url) {
  url = url.trim();
  if (!url) return showToast('Please enter a URL');

  const loadBtn = document.getElementById('load-btn');
  loadBtn.disabled = true;
  loadBtn.textContent = 'Loading...';
  setLoading(true, 'Loading paper...');

  try {
    const paper = await loadPaper(url);
    state.paperId = paper.id;
    state.paper = paper;
    state.chatHistory = [];
    state.summaryDone = false;
    state.keypointsDone = false;

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    document.getElementById('pdf-title').textContent = paper.title || 'PDF';
    document.getElementById('btn-translate').disabled = false;
    document.getElementById('btn-chat-toggle').disabled = false;

    document.getElementById('pane-translation').innerHTML = '<div class="pane-placeholder">Click <strong>Translate</strong> to start</div>';
    document.getElementById('pane-summary').innerHTML = '<div class="pane-placeholder">Click the <strong>Summary</strong> tab to generate an AI summary</div>';
    document.getElementById('pane-keypoints').innerHTML = '<div class="pane-placeholder">Click the <strong>Key Points</strong> tab to extract key findings</div>';

    showMetadata(paper);
    populateOutline(paper.sections || []);
    await renderPdf(paper.id);
    showToast(`Loaded: ${paper.numPages} pages`, 'success');
  } catch (err) {
    showToast(friendlyError(err));
  } finally {
    setLoading(false);
    loadBtn.disabled = false;
    loadBtn.textContent = 'Load';
  }
}

// ===== Paper Metadata =====
function showMetadata(paper) {
  const el = document.getElementById('paper-metadata');
  if (!paper.title && !paper.authors) { el.classList.add('hidden'); return; }
  let html = '';
  if (paper.title) html += `<div class="meta-title">${escapeHtml(paper.title)}</div>`;
  if (paper.authors && paper.authors.length) html += `<div class="meta-authors">${escapeHtml(paper.authors.join(', '))}</div>`;
  if (paper.date) html += `<div class="meta-date">${escapeHtml(paper.date)}</div>`;
  el.innerHTML = html;
  el.classList.remove('hidden');
}

// ===== PDF Rendering (Retina-sharp, progressive) =====
async function renderPdf(paperId) {
  const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

  const doc = await pdfjsLib.getDocument(`/api/paper/${paperId}/pdf`).promise;
  state.pdfDoc = doc;
  state.zoom = 1.0;
  document.getElementById('zoom-level').textContent = '100%';
  updatePageIndicator(0, doc.numPages);
  await renderAllPages();
}

async function renderAllPages() {
  const viewer = document.getElementById('pdf-viewer');
  viewer.innerHTML = '';
  if (!state.pdfDoc) return;

  const dpr = window.devicePixelRatio || 1;
  const totalPages = state.pdfDoc.numPages;

  for (let i = 1; i <= totalPages; i++) {
    const page = await state.pdfDoc.getPage(i);
    const cssScale = state.zoom * 1.2;
    const viewport = page.getViewport({ scale: cssScale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    canvas.dataset.page = i;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    viewer.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
    updatePageIndicator(i, totalPages);
  }

  // Track scroll position for page indicator
  viewer.addEventListener('scroll', () => {
    const canvases = viewer.querySelectorAll('canvas');
    let currentPage = 1;
    for (const c of canvases) {
      if (c.offsetTop + c.offsetHeight / 2 > viewer.scrollTop) {
        currentPage = parseInt(c.dataset.page) || 1;
        break;
      }
    }
    updatePageIndicator(currentPage, totalPages);
  });
}

function updatePageIndicator(current, total) {
  const el = document.getElementById('page-indicator');
  if (!el) return;
  el.textContent = current > 0 ? `${current} / ${total}` : `${total} pages`;
}

function initZoom() {
  document.getElementById('zoom-in').addEventListener('click', () => {
    state.zoom = Math.min(state.zoom + 0.2, 3.0);
    document.getElementById('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
    renderAllPages();
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    state.zoom = Math.max(state.zoom - 0.2, 0.4);
    document.getElementById('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
    renderAllPages();
  });
}

// ===== Outline Panel =====
function initOutline() {
  document.getElementById('toggle-outline').addEventListener('click', () => {
    const panel = document.getElementById('outline-panel');
    state.outlineOpen = !state.outlineOpen;
    panel.classList.toggle('collapsed', !state.outlineOpen);
  });
}

function populateOutline(sections) {
  const list = document.getElementById('outline-list');
  const count = document.getElementById('outline-count');
  list.innerHTML = '';
  if (!sections || sections.length === 0) {
    list.innerHTML = '<li style="padding:12px;color:var(--text-muted);font-size:0.76rem">No sections detected</li>';
    count.textContent = '';
    return;
  }
  count.textContent = sections.length;
  sections.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'outline-item';
    li.title = s.heading;
    li.innerHTML = `<span class="section-num">${i + 1}</span>${escapeHtml(s.heading)}`;
    li.addEventListener('click', () => {
      list.querySelectorAll('.outline-item').forEach(el => el.classList.remove('active'));
      li.classList.add('active');
      scrollToSection(i, sections.length);
    });
    list.appendChild(li);
  });
}

function scrollToSection(sectionIndex, totalSections) {
  const viewer = document.getElementById('pdf-viewer');
  if (!state.pdfDoc) return;
  const totalPages = state.pdfDoc.numPages;
  const estimatedPage = Math.floor((sectionIndex / totalSections) * totalPages);
  const canvases = viewer.querySelectorAll('canvas');
  if (canvases[estimatedPage]) {
    canvases[estimatedPage].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== Pane Tabs =====
function initPaneTabs() {
  document.querySelectorAll('.pane-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pane-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.pane-content').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = tab.dataset.pane;
      document.getElementById(`pane-${pane}`).classList.add('active');
      if (pane === 'summary' && !state.summaryDone && state.paperId) autoSummarize();
      if (pane === 'keypoints' && !state.keypointsDone && state.paperId) autoExtract();
    });
  });
}

async function autoSummarize() {
  state.summaryDone = true;
  const target = createStreamTarget('pane-summary');
  try {
    await streamSummarize(state.paperId, {
      onChunk: (_, full) => target.update(full),
      onDone: full => target.done(full),
    });
  } catch (err) { target.done(`Error: ${friendlyError(err)}`); state.summaryDone = false; }
}

async function autoExtract() {
  state.keypointsDone = true;
  const target = createStreamTarget('pane-keypoints');
  try {
    await streamExtract(state.paperId, {
      onChunk: (_, full) => target.update(full),
      onDone: full => target.done(full),
    });
  } catch (err) { target.done(`Error: ${friendlyError(err)}`); state.keypointsDone = false; }
}

// ===== Actions =====
function initActions() {
  document.getElementById('btn-translate').addEventListener('click', async () => {
    if (!state.paperId) return;
    activatePane('translation');
    const lang = document.getElementById('translate-lang').value;
    const target = createStreamTarget('pane-translation');
    const btn = document.getElementById('btn-translate');
    btn.disabled = true;
    btn.textContent = 'Translating...';
    try {
      await streamTranslate(state.paperId, lang, {
        onChunk: (_, full) => target.update(full),
        onDone: full => { target.done(full); btn.disabled = false; btn.textContent = 'Translate'; },
      });
    } catch (err) {
      target.done(`Error: ${friendlyError(err)}`);
      btn.disabled = false;
      btn.textContent = 'Translate';
    }
  });
}

function activatePane(name) {
  document.querySelectorAll('.pane-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pane-content').forEach(p => p.classList.remove('active'));
  document.querySelector(`.pane-tab[data-pane="${name}"]`)?.classList.add('active');
  document.getElementById(`pane-${name}`)?.classList.add('active');
}

// ===== Chat =====
function initChat() {
  const panel = document.getElementById('chat-panel');
  document.getElementById('btn-chat-toggle').addEventListener('click', () => panel.classList.toggle('hidden'));
  document.getElementById('close-chat').addEventListener('click', () => panel.classList.add('hidden'));
  document.getElementById('chat-send').addEventListener('click', sendMessage);
  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 80) + 'px'; });
  document.getElementById('clear-chat').addEventListener('click', () => {
    if (state.chatHistory.length === 0) return;
    if (!confirm('Clear all chat messages?')) return;
    state.chatHistory = [];
    document.getElementById('chat-messages').innerHTML = '<div class="chat-empty"><p>Ask about the paper</p></div>';
  });
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => { input.value = btn.dataset.q; sendMessage(); });
  });
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const q = input.value.trim();
  if (!q || !state.paperId) return;
  input.value = ''; input.style.height = 'auto';
  sendBtn.disabled = true;
  addChatMessage('user', q);
  addChatMessage('assistant', '', { streaming: true });
  try {
    await streamChat(state.paperId, q, state.chatHistory, {
      onChunk: (_, full) => updateLastAssistantMessage(full),
      onDone: full => {
        updateLastAssistantMessage(full, { done: true });
        state.chatHistory.push({ role: 'user', content: q }, { role: 'assistant', content: full });
        sendBtn.disabled = false;
      },
    });
  } catch (err) {
    updateLastAssistantMessage(`Error: ${friendlyError(err)}`, { done: true });
    sendBtn.disabled = false;
  }
}
