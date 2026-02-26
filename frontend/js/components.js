// ===== UI Rendering Components =====

export function renderMarkdown(text) {
  if (typeof marked !== 'undefined') return marked.parse(text);
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

export function showPaperInfo(paper) {
  document.getElementById('paper-title').textContent = paper.title || 'Untitled';
  document.getElementById('paper-authors').textContent = paper.authors?.length
    ? paper.authors.join(', ') : '';
  document.getElementById('page-info').textContent = `${paper.numPages} pages`;
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
}

export function renderOriginalSections(sections) {
  const container = document.getElementById('original-content');
  container.innerHTML = sections.map(s => `
    <div class="section-block">
      <h3>${escapeHtml(s.heading)}</h3>
      <p>${escapeHtml(s.content || s.preview || '')}</p>
    </div>
  `).join('');
}

export function createStreamTarget(elementId) {
  const el = document.getElementById(elementId);
  const placeholder = el.querySelector('.pane-placeholder');
  if (placeholder) placeholder.remove();
  el.classList.add('streaming');

  return {
    update(text) { el.innerHTML = '<div class="content-area">' + renderMarkdown(text) + '</div>'; },
    done(text) { el.innerHTML = '<div class="content-area">' + renderMarkdown(text) + '</div>'; el.classList.remove('streaming'); },
  };
}

export function addChatMessage(role, content, { streaming = false } = {}) {
  const container = document.getElementById('chat-messages');
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  if (role === 'assistant') {
    const div = document.createElement('div');
    div.className = 'content-area';
    if (streaming) div.classList.add('streaming');
    div.innerHTML = renderMarkdown(content);
    msg.appendChild(div);
  } else {
    msg.textContent = content;
  }
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

export function updateLastAssistantMessage(content, { done = false } = {}) {
  const msgs = document.querySelectorAll('#chat-messages .chat-msg.assistant');
  const last = msgs[msgs.length - 1];
  if (!last) return;
  const div = last.querySelector('.content-area');
  if (div) {
    div.innerHTML = renderMarkdown(content);
    if (done) div.classList.remove('streaming');
  }
  document.getElementById('chat-messages').scrollTop = 999999;
}

export function showToast(message, type = 'error') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function setLoading(show, text = 'Loading paper...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-state').classList.toggle('hidden', !show);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
