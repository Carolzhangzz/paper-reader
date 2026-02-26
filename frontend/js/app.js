// ===== Main Application Logic =====

import {
  loadPaper, streamSummarize, streamExtract, streamTranslate, streamChat,
} from './api.js';

import {
  showPaperInfo, renderSections, addChatMessage,
  updateLastAssistantMessage, createStreamTarget,
  showToast, setLoading,
} from './components.js';

// ===== State =====
const state = {
  paperId: null,
  paper: null,
  chatHistory: [],
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initPaperLoading();
  initTabs();
  initActions();
  initChat();
});

// ===== Paper Loading =====
function initPaperLoading() {
  const urlInput = document.getElementById('paper-url');
  const loadBtn = document.getElementById('load-btn');

  loadBtn.addEventListener('click', () => handleLoad(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLoad(urlInput.value);
  });

  // Example links
  document.querySelectorAll('.example-link').forEach(el => {
    el.addEventListener('click', (e) => {
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
  resetState();

  try {
    const paper = await loadPaper(url);
    state.paperId = paper.id;
    state.paper = paper;

    showPaperInfo(paper);
    renderSections(paper.sections);

    // Enable chat
    document.getElementById('chat-input').disabled = false;
    document.getElementById('chat-send').disabled = false;
    document.getElementById('suggested-questions').classList.remove('hidden');

    // Show action buttons
    document.querySelectorAll('.btn-action').forEach(b => b.classList.remove('hidden'));

    showToast(`Loaded: ${paper.numPages} pages`, 'success');
  } catch (err) {
    showToast(err.message);
  } finally {
    setLoading(false);
  }
}

function resetState() {
  state.paperId = null;
  state.paper = null;
  state.chatHistory = [];

  document.getElementById('summary-content').innerHTML = '';
  document.getElementById('keypoints-content').innerHTML = '';
  document.getElementById('translation-content').innerHTML = '';
  document.getElementById('chat-messages').innerHTML =
    '<div class="chat-empty"><p>Load a paper to start asking questions</p></div>';
  document.querySelectorAll('.btn-action').forEach(b => b.classList.remove('hidden'));
}

// ===== Tabs =====
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ===== LLM Actions =====
function initActions() {
  document.getElementById('btn-summarize').addEventListener('click', async () => {
    if (!state.paperId) return;
    const btn = document.getElementById('btn-summarize');
    btn.classList.add('hidden');
    const target = createStreamTarget('summary-content');
    try {
      await streamSummarize(state.paperId, {
        onChunk: (_, full) => target.update(full),
        onDone: (full) => target.done(full),
      });
    } catch (err) {
      target.done(`Error: ${err.message}`);
      btn.classList.remove('hidden');
    }
  });

  document.getElementById('btn-extract').addEventListener('click', async () => {
    if (!state.paperId) return;
    const btn = document.getElementById('btn-extract');
    btn.classList.add('hidden');
    const target = createStreamTarget('keypoints-content');
    try {
      await streamExtract(state.paperId, {
        onChunk: (_, full) => target.update(full),
        onDone: (full) => target.done(full),
      });
    } catch (err) {
      target.done(`Error: ${err.message}`);
      btn.classList.remove('hidden');
    }
  });

  document.getElementById('btn-translate').addEventListener('click', async () => {
    if (!state.paperId) return;
    const btn = document.getElementById('btn-translate');
    btn.classList.add('hidden');
    const lang = document.getElementById('translate-lang').value;
    const target = createStreamTarget('translation-content');
    try {
      await streamTranslate(state.paperId, lang, {
        onChunk: (_, full) => target.update(full),
        onDone: (full) => target.done(full),
      });
    } catch (err) {
      target.done(`Error: ${err.message}`);
      btn.classList.remove('hidden');
    }
  });
}

// ===== Chat =====
function initChat() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const clearBtn = document.getElementById('clear-chat');

  sendBtn.addEventListener('click', () => sendMessage());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  clearBtn.addEventListener('click', () => {
    state.chatHistory = [];
    document.getElementById('chat-messages').innerHTML =
      '<div class="chat-empty"><p>Ask questions about the paper</p></div>';
  });

  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.q;
      sendMessage();
    });
  });
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question || !state.paperId) return;

  input.value = '';
  input.style.height = 'auto';

  addChatMessage('user', question);
  addChatMessage('assistant', '', { streaming: true });

  try {
    await streamChat(state.paperId, question, state.chatHistory, {
      onChunk: (_, full) => updateLastAssistantMessage(full),
      onDone: (full) => {
        updateLastAssistantMessage(full, { done: true });
        state.chatHistory.push({ role: 'user', content: question });
        state.chatHistory.push({ role: 'assistant', content: full });
      },
    });
  } catch (err) {
    updateLastAssistantMessage(`Error: ${err.message}`, { done: true });
  }
}
