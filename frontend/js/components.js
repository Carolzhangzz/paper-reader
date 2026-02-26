// ===== UI Rendering Components =====

/**
 * Render markdown text to HTML using marked.js
 */
export function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Show paper info in the left panel
 */
export function showPaperInfo(paper) {
  document.getElementById('paper-title').textContent = paper.title || 'Untitled';
  document.getElementById('paper-authors').textContent = paper.authors?.length
    ? paper.authors.join(', ')
    : '';
  document.getElementById('paper-abstract').textContent = paper.abstract || '';

  document.getElementById('paper-info').classList.remove('hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('tabs-container').classList.remove('hidden');
}

/**
 * Render sections in the Sections tab
 */
export function renderSections(sections) {
  const container = document.getElementById('sections-content');
  if (!sections?.length) {
    container.innerHTML = '<p style="color:var(--text-muted)">No sections detected</p>';
    return;
  }

  container.innerHTML = sections.map((s, i) => `
    <div class="section-item" data-index="${i}">
      <div class="section-heading">${escapeHtml(s.heading)}</div>
      <div class="section-preview">${escapeHtml(s.preview || '')}</div>
    </div>
  `).join('');
}

/**
 * Add a chat message
 */
export function addChatMessage(role, content, { streaming = false } = {}) {
  const container = document.getElementById('chat-messages');
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  if (role === 'assistant') {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content-area';
    if (streaming) contentDiv.classList.add('streaming-cursor');
    contentDiv.innerHTML = renderMarkdown(content);
    msg.appendChild(contentDiv);
  } else {
    msg.textContent = content;
  }

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

/**
 * Update the last assistant message (streaming)
 */
export function updateLastAssistantMessage(content, { done = false } = {}) {
  const container = document.getElementById('chat-messages');
  const msgs = container.querySelectorAll('.chat-msg.assistant');
  const last = msgs[msgs.length - 1];
  if (!last) return;

  const contentDiv = last.querySelector('.content-area');
  if (contentDiv) {
    contentDiv.innerHTML = renderMarkdown(content);
    if (done) contentDiv.classList.remove('streaming-cursor');
  }
  container.scrollTop = container.scrollHeight;
}

/**
 * Create a stream target for a content area
 */
export function createStreamTarget(elementId) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';
  el.classList.add('streaming-cursor');

  return {
    update(text) {
      el.innerHTML = renderMarkdown(text);
    },
    done(text) {
      el.innerHTML = renderMarkdown(text);
      el.classList.remove('streaming-cursor');
    },
  };
}

/**
 * Show toast notification
 */
export function showToast(message, type = 'error') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/**
 * Show/hide loading state
 */
export function setLoading(show, text = 'Loading paper...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-state').classList.toggle('hidden', !show);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
