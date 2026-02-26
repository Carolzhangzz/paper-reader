import { loadPaper, streamSummarize, streamExtract, streamTranslate, streamChat } from './api.js';
import { createStreamTarget, addChatMessage, updateLastAssistantMessage, showToast, setLoading, renderMarkdown } from './components.js';

const state = { paperId: null, paper: null, chatHistory: [], pdfDoc: null, zoom: 1.0, summaryDone: false, keypointsDone: false };

document.addEventListener('DOMContentLoaded', () => {
  initPaperLoading();
  initPaneTabs();
  initActions();
  initChat();
  initZoom();
});

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
    document.getElementById('pane-summary').innerHTML = '<div class="pane-placeholder">Switch to this tab to auto-generate</div>';
    document.getElementById('pane-keypoints').innerHTML = '<div class="pane-placeholder">Switch to this tab to auto-generate</div>';

    await renderPdf(paper.id);
    showToast(`Loaded: ${paper.numPages} pages`, 'success');
  } catch (err) {
    showToast(err.message);
  } finally {
    setLoading(false);
  }
}

// ===== PDF Rendering (Retina-sharp) =====
async function renderPdf(paperId) {
  const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

  const doc = await pdfjsLib.getDocument(`/api/paper/${paperId}/pdf`).promise;
  state.pdfDoc = doc;
  state.zoom = 1.0;
  document.getElementById('zoom-level').textContent = '100%';
  await renderAllPages();
}

async function renderAllPages() {
  const viewer = document.getElementById('pdf-viewer');
  viewer.innerHTML = '';
  if (!state.pdfDoc) return;

  const dpr = window.devicePixelRatio || 1;

  for (let i = 1; i <= state.pdfDoc.numPages; i++) {
    const page = await state.pdfDoc.getPage(i);
    // CSS size = zoom * 1.2 base scale
    const cssScale = state.zoom * 1.2;
    const viewport = page.getViewport({ scale: cssScale });

    const canvas = document.createElement('canvas');
    // Render at higher resolution for sharpness
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    // Display at CSS size
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    viewer.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
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
  } catch (err) { target.done(`Error: ${err.message}`); state.summaryDone = false; }
}

async function autoExtract() {
  state.keypointsDone = true;
  const target = createStreamTarget('pane-keypoints');
  try {
    await streamExtract(state.paperId, {
      onChunk: (_, full) => target.update(full),
      onDone: full => target.done(full),
    });
  } catch (err) { target.done(`Error: ${err.message}`); state.keypointsDone = false; }
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
      target.done(`Error: ${err.message}`);
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
    state.chatHistory = [];
    document.getElementById('chat-messages').innerHTML = '<div class="chat-empty"><p>Ask about the paper</p></div>';
  });
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => { input.value = btn.dataset.q; sendMessage(); });
  });
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const q = input.value.trim();
  if (!q || !state.paperId) return;
  input.value = ''; input.style.height = 'auto';
  addChatMessage('user', q);
  addChatMessage('assistant', '', { streaming: true });
  try {
    await streamChat(state.paperId, q, state.chatHistory, {
      onChunk: (_, full) => updateLastAssistantMessage(full),
      onDone: full => {
        updateLastAssistantMessage(full, { done: true });
        state.chatHistory.push({ role: 'user', content: q }, { role: 'assistant', content: full });
      },
    });
  } catch (err) { updateLastAssistantMessage(`Error: ${err.message}`, { done: true }); }
}
