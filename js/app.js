// ===== Main Application Logic =====

import {
  getApiKey, setApiKey, getModel, setModel,
  parseArxivId, fetchArxivMetadata, fetchPdfBuffer,
  classifyUrl, streamChat,
} from './api.js';

import { extractTextFromPdf, chunkText } from './pdf-parser.js';

import {
  showPaperInfo, renderSections, addChatMessage,
  updateLastAssistantMessage, createStreamTarget,
  showToast, setLoading,
} from './components.js';

// ===== State =====
const state = {
  paper: null,       // { title, authors, abstract, fullText, sections, pages }
  chatHistory: [],   // [{ role, content }]
  abortController: null,
};

// ===== Prompts =====
const PROMPTS = {
  summarize: (text) => [
    { role: 'system', content: 'You are an expert academic paper reader. Provide a clear, structured summary of the paper. Use markdown formatting. Include: 1) Main objective 2) Key methodology 3) Main findings 4) Significance. Be concise but thorough.' },
    { role: 'user', content: `Please summarize this academic paper:\n\n${text}` },
  ],

  extract: (text) => [
    { role: 'system', content: 'You are an expert at analyzing academic papers. Extract the key points in a structured format using markdown. Include: ## Main Contributions, ## Methodology, ## Key Results, ## Limitations, ## Future Directions. Use bullet points.' },
    { role: 'user', content: `Extract the key points from this paper:\n\n${text}` },
  ],

  translate: (text, targetLang) => {
    const langMap = { zh: 'Chinese (简体中文)', en: 'English' };
    return [
      { role: 'system', content: `You are a professional academic translator. Translate the following academic text to ${langMap[targetLang]}. Maintain academic tone and preserve technical terms. Use markdown formatting for readability.` },
      { role: 'user', content: `Translate to ${langMap[targetLang]}:\n\n${text}` },
    ];
  },

  chat: (paperContext, history, question) => [
    { role: 'system', content: `You are a helpful research assistant. Answer questions about the following paper. Be precise, cite specific parts when relevant, and use markdown formatting.\n\nPaper content:\n${paperContext}` },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ],
};

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
  initSettings();
  initPaperLoading();
  initTabs();
  initChat();
  initActions();

  // Check for API key on load
  if (!getApiKey()) {
    setTimeout(() => showToast('Set your Groq API key in Settings to get started', 'error'), 500);
  }
});

// ===== Settings =====
function initSettings() {
  const modal = document.getElementById('settings-modal');
  const btn = document.getElementById('settings-btn');
  const saveBtn = document.getElementById('settings-save');
  const cancelBtn = document.getElementById('settings-cancel');
  const keyInput = document.getElementById('api-key-input');
  const modelSelect = document.getElementById('model-select');
  const backdrop = modal.querySelector('.modal-backdrop');

  btn.addEventListener('click', () => {
    keyInput.value = getApiKey();
    modelSelect.value = getModel();
    modal.classList.remove('hidden');
  });

  const close = () => modal.classList.add('hidden');

  saveBtn.addEventListener('click', () => {
    setApiKey(keyInput.value.trim());
    setModel(modelSelect.value);
    close();
    showToast('Settings saved', 'success');
  });

  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
}

// ===== Paper Loading =====
function initPaperLoading() {
  const urlInput = document.getElementById('paper-url');
  const loadBtn = document.getElementById('load-btn');
  const fileUpload = document.getElementById('file-upload');

  loadBtn.addEventListener('click', () => loadPaperFromUrl(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadPaperFromUrl(urlInput.value);
  });

  fileUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await loadPaperFromFile(file);
    fileUpload.value = '';
  });

  // Example links
  document.querySelectorAll('.example-link').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      urlInput.value = el.dataset.url;
      loadPaperFromUrl(el.dataset.url);
    });
  });
}

async function loadPaperFromUrl(url) {
  url = url.trim();
  if (!url) return showToast('Please enter a URL');

  const classified = classifyUrl(url);
  if (classified.type === 'invalid') return showToast('Unrecognized URL format');

  setLoading(true, 'Analyzing URL...');
  resetPaperState();

  try {
    let metadata = {};

    // For arxiv, fetch metadata first
    if (classified.type === 'arxiv') {
      setLoading(true, 'Fetching arxiv metadata...');
      try {
        metadata = await fetchArxivMetadata(classified.id);
      } catch { /* continue without metadata */ }
    }

    // For DOI, construct a URL
    let pdfUrl = url;
    if (classified.type === 'doi') {
      pdfUrl = `https://doi.org/${classified.doi}`;
    }

    // Download and parse PDF
    setLoading(true, 'Downloading PDF...');
    const buffer = await fetchPdfBuffer(pdfUrl);

    setLoading(true, 'Extracting text...');
    const extracted = await extractTextFromPdf(buffer);

    // Merge metadata with extracted data
    state.paper = {
      title: metadata.title || extractTitle(extracted.fullText),
      authors: metadata.authors || [],
      abstract: metadata.abstract || extractAbstract(extracted.fullText),
      fullText: extracted.fullText,
      sections: extracted.sections,
      pages: extracted.pages,
      numPages: extracted.numPages,
    };

    onPaperLoaded();
  } catch (err) {
    showToast(err.message);
  } finally {
    setLoading(false);
  }
}

async function loadPaperFromFile(file) {
  setLoading(true, 'Reading PDF...');
  resetPaperState();

  try {
    const buffer = await file.arrayBuffer();

    setLoading(true, 'Extracting text...');
    const extracted = await extractTextFromPdf(buffer);

    state.paper = {
      title: extractTitle(extracted.fullText) || file.name.replace('.pdf', ''),
      authors: [],
      abstract: extractAbstract(extracted.fullText),
      fullText: extracted.fullText,
      sections: extracted.sections,
      pages: extracted.pages,
      numPages: extracted.numPages,
    };

    onPaperLoaded();
  } catch (err) {
    showToast('Failed to parse PDF: ' + err.message);
  } finally {
    setLoading(false);
  }
}

function onPaperLoaded() {
  showPaperInfo(state.paper);
  renderSections(state.paper.sections);

  // Enable chat
  document.getElementById('chat-input').disabled = false;
  document.getElementById('chat-send').disabled = false;
  document.getElementById('suggested-questions').classList.remove('hidden');

  // Show action buttons
  document.querySelectorAll('.btn-action').forEach(b => b.classList.remove('hidden'));

  showToast(`Loaded: ${state.paper.numPages} pages`, 'success');
}

function resetPaperState() {
  state.paper = null;
  state.chatHistory = [];

  // Clear UI
  document.getElementById('summary-content').innerHTML = '';
  document.getElementById('keypoints-content').innerHTML = '';
  document.getElementById('translation-content').innerHTML = '';
  document.getElementById('chat-messages').innerHTML = '<div class="chat-empty"><p>Load a paper to start asking questions</p></div>';
  document.querySelectorAll('.btn-action').forEach(b => b.classList.remove('hidden'));
}

// ===== Text extraction helpers =====
function extractTitle(text) {
  // First non-empty line that's reasonably short
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.length > 10 && line.length < 200 && !line.match(/^(arxiv|doi|http)/i)) {
      return line;
    }
  }
  return '';
}

function extractAbstract(text) {
  const match = text.match(/abstract[:\s]*(.{50,1500}?)(?=\n\s*\n|\bintroduction\b|\b1[\s.]+)/is);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
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
  document.getElementById('btn-summarize').addEventListener('click', handleSummarize);
  document.getElementById('btn-extract').addEventListener('click', handleExtract);
  document.getElementById('btn-translate').addEventListener('click', handleTranslate);
}

function getPaperContext(maxTokens = 24000) {
  if (!state.paper) return '';
  // Use abstract + sections for context, chunked to fit
  let text = '';
  if (state.paper.abstract) text += `Abstract: ${state.paper.abstract}\n\n`;
  for (const s of state.paper.sections) {
    text += `## ${s.heading}\n${s.content}\n\n`;
  }
  const chunks = chunkText(text, maxTokens);
  return chunks[0]; // Use first chunk that fits
}

async function handleSummarize() {
  if (!state.paper) return;
  const btn = document.getElementById('btn-summarize');
  btn.classList.add('hidden');

  const target = createStreamTarget('summary-content');
  try {
    const context = getPaperContext();
    await streamChat(PROMPTS.summarize(context), {
      onChunk: (_, full) => target.update(full),
      onDone: (full) => target.done(full),
    });
  } catch (err) {
    target.done(`Error: ${err.message}`);
    btn.classList.remove('hidden');
  }
}

async function handleExtract() {
  if (!state.paper) return;
  const btn = document.getElementById('btn-extract');
  btn.classList.add('hidden');

  const target = createStreamTarget('keypoints-content');
  try {
    const context = getPaperContext();
    await streamChat(PROMPTS.extract(context), {
      onChunk: (_, full) => target.update(full),
      onDone: (full) => target.done(full),
    });
  } catch (err) {
    target.done(`Error: ${err.message}`);
    btn.classList.remove('hidden');
  }
}

async function handleTranslate() {
  if (!state.paper) return;
  const btn = document.getElementById('btn-translate');
  btn.classList.add('hidden');

  const lang = document.getElementById('translate-lang').value;
  const target = createStreamTarget('translation-content');

  try {
    const context = getPaperContext(16000);
    await streamChat(PROMPTS.translate(context, lang), {
      onChunk: (_, full) => target.update(full),
      onDone: (full) => target.done(full),
    });
  } catch (err) {
    target.done(`Error: ${err.message}`);
    btn.classList.remove('hidden');
  }
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

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  clearBtn.addEventListener('click', () => {
    state.chatHistory = [];
    document.getElementById('chat-messages').innerHTML = '<div class="chat-empty"><p>Ask questions about the paper</p></div>';
  });

  // Suggested questions
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
  if (!question || !state.paper) return;

  input.value = '';
  input.style.height = 'auto';

  // Add user message
  addChatMessage('user', question);
  state.chatHistory.push({ role: 'user', content: question });

  // Add placeholder assistant message
  addChatMessage('assistant', '', { streaming: true });

  try {
    const context = getPaperContext(20000);
    const messages = PROMPTS.chat(context, state.chatHistory.slice(0, -1), question);

    const result = await streamChat(messages, {
      onChunk: (_, full) => updateLastAssistantMessage(full),
      onDone: (full) => {
        updateLastAssistantMessage(full, { done: true });
        state.chatHistory.push({ role: 'assistant', content: full });
      },
    });
  } catch (err) {
    updateLastAssistantMessage(`Error: ${err.message}`, { done: true });
  }
}
