import {
  loadPaper, streamSummarize, streamExtract, streamTranslate, streamChat,
} from './api.js';

import {
  showPaperInfo, renderOriginalSections, createStreamTarget,
  addChatMessage, updateLastAssistantMessage, showToast, setLoading,
} from './components.js';

const state = { paperId: null, paper: null, chatHistory: [] };

document.addEventListener('DOMContentLoaded', () => {
  initPaperLoading();
  initPaneTabs();
  initActions();
  initChat();
});

// ===== Paper Loading =====
function initPaperLoading() {
  const urlInput = document.getElementById('paper-url');
  const loadBtn = document.getElementById('load-btn');

  loadBtn.addEventListener('click', () => handleLoad(urlInput.value));
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleLoad(urlInput.value); });

  document.querySelectorAll('.example-link').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      urlInput.value = el.dataset.url;
      handleLoad(el.dataset.url);
    });
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

    showPaperInfo(paper);

    // Load full sections for the original pane
    renderOriginalSections(paper.sections);

    // Reset right pane
    resetRightPane();

    showToast(`Loaded: ${paper.numPages} pages`, 'success');
  } catch (err) {
    showToast(err.message);
  } finally {
    setLoading(false);
  }
}

function resetRightPane() {
  document.getElementById('pane-translation').innerHTML = '<div class="pane-placeholder">Click "Translate All" to translate the paper</div>';
  document.getElementById('pane-summary').innerHTML = '<div class="pane-placeholder">Click "Summary" to generate</div>';
  document.getElementById('pane-keypoints').innerHTML = '<div class="pane-placeholder">Click "Key Points" to extract</div>';
}

// ===== Pane Tabs =====
function initPaneTabs() {
  document.querySelectorAll('.pane-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pane-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.pane-content').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`pane-${tab.dataset.pane}`).classList.add('active');
    });
  });
}

// ===== Actions =====
function initActions() {
  document.getElementById('btn-translate').addEventListener('click', async () => {
    if (!state.paperId) return;
    // Switch to translation tab
    activatePane('translation');
    const lang = document.getElementById('translate-lang').value;
    const target = createStreamTarget('pane-translation');
    const btn = document.getElementById('btn-translate');
    btn.disabled = true;
    try {
      await streamTranslate(state.paperId, lang, {
        onChunk: (_, full) => target.update(full),
        onDone: full => { target.done(full); btn.disabled = false; },
      });
    } catch (err) {
      target.done(`Error: ${err.message}`);
      btn.disabled = false;
    }
  });

  document.getElementById('btn-summarize').addEventListener('click', async () => {
    if (!state.paperId) return;
    activatePane('summary');
    const target = createStreamTarget('pane-summary');
    const btn = document.getElementById('btn-summarize');
    btn.disabled = true;
    try {
      await streamSummarize(state.paperId, {
        onChunk: (_, full) => target.update(full),
        onDone: full => { target.done(full); btn.disabled = false; },
      });
    } catch (err) {
      target.done(`Error: ${err.message}`);
      btn.disabled = false;
    }
  });

  document.getElementById('btn-extract').addEventListener('click', async () => {
    if (!state.paperId) return;
    activatePane('keypoints');
    const target = createStreamTarget('pane-keypoints');
    const btn = document.getElementById('btn-extract');
    btn.disabled = true;
    try {
      await streamExtract(state.paperId, {
        onChunk: (_, full) => target.update(full),
        onDone: full => { target.done(full); btn.disabled = false; },
      });
    } catch (err) {
      target.done(`Error: ${err.message}`);
      btn.disabled = false;
    }
  });
}

function activatePane(name) {
  document.querySelectorAll('.pane-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pane-content').forEach(p => p.classList.remove('active'));
  document.querySelector(`.pane-tab[data-pane="${name}"]`).classList.add('active');
  document.getElementById(`pane-${name}`).classList.add('active');
}

// ===== Chat =====
function initChat() {
  const chatPanel = document.getElementById('chat-panel');
  const input = document.getElementById('chat-input');

  document.getElementById('btn-chat-toggle').addEventListener('click', () => {
    chatPanel.classList.toggle('hidden');
  });
  document.getElementById('close-chat').addEventListener('click', () => {
    chatPanel.classList.add('hidden');
  });

  document.getElementById('chat-send').addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  document.getElementById('clear-chat').addEventListener('click', () => {
    state.chatHistory = [];
    document.getElementById('chat-messages').innerHTML = '<div class="chat-empty"><p>Ask questions about the paper</p></div>';
  });

  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => { input.value = btn.dataset.q; sendMessage(); });
  });
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const q = input.value.trim();
  if (!q || !state.paperId) return;
  input.value = '';
  input.style.height = 'auto';

  addChatMessage('user', q);
  addChatMessage('assistant', '', { streaming: true });

  try {
    await streamChat(state.paperId, q, state.chatHistory, {
      onChunk: (_, full) => updateLastAssistantMessage(full),
      onDone: full => {
        updateLastAssistantMessage(full, { done: true });
        state.chatHistory.push({ role: 'user', content: q });
        state.chatHistory.push({ role: 'assistant', content: full });
      },
    });
  } catch (err) {
    updateLastAssistantMessage(`Error: ${err.message}`, { done: true });
  }
}
