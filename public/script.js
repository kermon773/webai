const chatBox = document.getElementById('chat-box');
const chatScroll = document.getElementById('chat-scroll');
const composer = document.getElementById('composer');
const inputField = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const modelSelect = document.getElementById('model-select');
const fileUpload = document.getElementById('file-upload');
const filePreview = document.getElementById('file-preview');
const fileName = document.getElementById('file-name');
const connectionStatus = document.getElementById('connection-status');
const toast = document.getElementById('toast');
const autoTab = document.getElementById('auto-cs-tab');
const autoPanel = document.getElementById('auto-cs-panel');
const autoStoryForm = document.getElementById('auto-story-form');
const autoGenerateButton = document.getElementById('auto-generate');
const autoSendStoryButton = document.getElementById('auto-send-story');
const autoStoryPreview = document.getElementById('auto-story-preview');
const autoStoryState = document.getElementById('auto-story-state');
const autoChatBox = document.getElementById('auto-chat-box');
const autoChatForm = document.getElementById('auto-chat-form');
const autoChatInput = document.getElementById('auto-chat-input');
const detectorStatus = document.getElementById('detector-status');
const detectorLabel = document.getElementById('detector-label');
const copyStoryButton = document.getElementById('copy-story');

let isSending = false;
let isAutoBusy = false;
let toastTimer;

const welcomeMessage = [
    'Halo, saya Void. Saya bisa membantu menyusun ide, membaca kode, dan mengerjakan langkah teknis bersama kamu.',
    'Kirim pertanyaan atau lampirkan file project untuk memulai.'
].join('\n\n');

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderInline(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderAssistantContent(text) {
    const parts = [];
    const codePattern = /```([a-zA-Z0-9_+#.-]*)\s*\n?([\s\S]*?)```/g;
    let cursor = 0;
    let match;

    while ((match = codePattern.exec(text)) !== null) {
        const prose = text.slice(cursor, match.index).trim();
        if (prose) {
            parts.push(...prose.split(/\n{2,}/).map(paragraph =>
                `<p>${renderInline(paragraph).replace(/\n/g, '<br>')}</p>`
            ));
        }

        const language = match[1] || 'code';
        const code = match[2].replace(/^\n+|\n+$/g, '');
        const encodedCode = encodeURIComponent(code);
        parts.push(`
            <div class="code-card">
                <div class="code-head">
                    <span class="code-language">${escapeHtml(language)}</span>
                    <div class="code-actions">
                        <button class="code-action" type="button" data-code="${encodedCode}" data-action="copy">Salin</button>
                        <button class="code-action run" type="button" data-action="run">Run</button>
                    </div>
                </div>
                <pre><code>${escapeHtml(code)}</code></pre>
            </div>
        `);
        cursor = match.index + match[0].length;
    }

    const remainder = text.slice(cursor).trim();
    if (remainder) {
        parts.push(...remainder.split(/\n{2,}/).map(paragraph =>
            `<p>${renderInline(paragraph).replace(/\n/g, '<br>')}</p>`
        ));
    }

    return parts.join('') || '<p>Void tidak menerima isi jawaban.</p>';
}

function renderUserContent(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function appendMessage(sender, text, type = 'assistant', options = {}) {
    const row = document.createElement('article');
    row.className = `message-row ${type}`;

    if (type === 'assistant') {
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = 'V';
        row.appendChild(avatar);
    }

    const body = document.createElement('div');
    body.className = `message-body${options.system ? ' system-body' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = `message-bubble${options.error ? ' system-message error-message' : ''}${options.system ? ' system-message' : ''}`;
    bubble.innerHTML = type === 'assistant' && !options.system
        ? renderAssistantContent(text)
        : renderUserContent(text);

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = options.meta || (type === 'user' ? 'Kamu' : 'Void AI');

    body.appendChild(bubble);
    body.appendChild(meta);
    row.appendChild(body);
    chatBox.appendChild(row);
    chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' });
    return row;
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setSending(value) {
    isSending = value;
    sendButton.disabled = value;
    inputField.disabled = value;
    connectionStatus.textContent = value ? 'Sedang memproses...' : 'API siap digunakan';
}

function resetComposerHeight() {
    inputField.style.height = 'auto';
    inputField.style.height = `${Math.min(inputField.scrollHeight, 130)}px`;
}

async function parseJsonResponse(response) {
    const raw = await response.text();
    let data;
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        throw new Error(`Server mengirim respons yang tidak valid (HTTP ${response.status})`);
    }

    if (!response.ok || data.error) {
        throw new Error(data.error || `Server gagal memproses permintaan (HTTP ${response.status})`);
    }
    return data;
}

async function requestChat(message, selectedFile = null) {
    const formData = new FormData();
    formData.append('message', message);
    formData.append('model', modelSelect.value);
    if (selectedFile) formData.append('file', selectedFile);

    const response = await fetch('/api/chat', { method: 'POST', body: formData });
    return parseJsonResponse(response);
}

async function sendMessage(messageOverride = '') {
    if (isSending) return;

    const message = messageOverride || inputField.value.trim();
    const selectedFile = fileUpload.files[0];
    if (!message && !selectedFile) return;

    appendMessage('Kamu', message || `File: ${selectedFile.name}`, 'user', { meta: 'Kamu · baru saja' });
    inputField.value = '';
    resetComposerHeight();
    setSending(true);

    try {
        const data = await requestChat(message, selectedFile);

        (data.logs || []).forEach(log => {
            appendMessage('System', log, 'assistant', { system: true, meta: 'Agent log' });
        });
        appendMessage('Void AI', data.reply, 'assistant');
    } catch (error) {
        appendMessage('System', error.message || 'Server tidak dapat dihubungi.', 'assistant', {
            error: true,
            system: true,
            meta: 'Koneksi gagal'
        });
        connectionStatus.textContent = 'Periksa koneksi API';
    } finally {
        fileUpload.value = '';
        filePreview.classList.remove('visible');
        setSending(false);
    }
}

function appendAutoChatMessage(text, type = 'assistant') {
    const message = document.createElement('div');
    message.className = `auto-chat-message ${type}`;
    message.textContent = text;
    autoChatBox.appendChild(message);
    autoChatBox.scrollTop = autoChatBox.scrollHeight;
}

function setAutoBusy(value) {
    isAutoBusy = value;
    autoGenerateButton.disabled = value;
    autoChatInput.disabled = value;
    autoChatForm.querySelector('button').disabled = value;
    autoGenerateButton.textContent = value ? 'Membuat story...' : 'Generate story';
}

function setDetectorState(state, label) {
    detectorStatus.dataset.state = state;
    detectorLabel.textContent = label;
}

function setDraft(text, stateMessage = 'Draft siap. Review atau edit teks sebelum dikirim ke chat utama.') {
    const draft = String(text || '').trim();
    autoStoryPreview.value = draft;
    autoSendStoryButton.disabled = !draft;
    copyStoryButton.disabled = !draft;
    autoStoryState.textContent = draft ? stateMessage : 'Draft story akan muncul di sini.';
    autoStoryState.className = draft ? 'story-state success' : 'story-state';
    setDetectorState(draft ? 'edited' : 'idle', draft ? 'Belum diperiksa untuk draf ini' : 'Belum diperiksa');
}

function getAutoStoryData() {
    return {
        name: document.getElementById('auto-name').value.trim(),
        birth: document.getElementById('auto-birth').value.trim(),
        city: document.getElementById('auto-city').value.trim(),
        paragraphs: Number(document.getElementById('auto-paragraphs').value),
        sentences: Number(document.getElementById('auto-sentences').value),
        job: document.getElementById('auto-job').value.trim()
    };
}

async function generateAutoStory(event) {
    event.preventDefault();
    if (isAutoBusy) return;

    const data = getAutoStoryData();
    if (!data.name || !data.birth || !data.city || !data.job) {
        autoStoryState.textContent = 'Lengkapi semua data karakter terlebih dahulu.';
        autoStoryState.className = 'story-state error';
        return;
    }

    const paragraphs = Math.min(Math.max(data.paragraphs || 1, 1), 5);
    const sentences = Math.min(Math.max(data.sentences || 1, 1), 5);
    const prompt = [
        'Buat draft story karakter roleplay berbahasa Indonesia berdasarkan data berikut.',
        `Nama sesuai IC: ${data.name}`,
        `Tanggal lahir: ${data.birth}`,
        `Asal kota: ${data.city}`,
        `Pekerjaan: ${data.job}`,
        `Format wajib: ${paragraphs} paragraf, setiap paragraf sekitar ${sentences} kalimat.`,
        'Tulis cerita yang koheren, spesifik, dan mudah diedit. Jangan menambahkan judul, disclaimer, atau komentar di luar story.'
    ].join('\n');

    setAutoBusy(true);
    autoStoryState.textContent = 'AI sedang membuat draft story...';
    autoStoryState.className = 'story-state';
    appendAutoChatMessage('Buat story berdasarkan data karakter yang saya isi.', 'user');

    try {
        const result = await requestChat(prompt);
        setDraft(result.reply);
        appendAutoChatMessage('Draft story sudah dibuat. Silakan review di kolom preview.', 'assistant');
    } catch (error) {
        autoStoryState.textContent = error.message || 'Gagal membuat story dari AI.';
        autoStoryState.className = 'story-state error';
        appendAutoChatMessage(error.message || 'AI tidak dapat membuat story.', 'assistant');
    } finally {
        setAutoBusy(false);
    }
}

async function sendAutoChatMessage(event) {
    event.preventDefault();
    const message = autoChatInput.value.trim();
    if (!message || isAutoBusy) return;

    autoChatInput.value = '';
    appendAutoChatMessage(message, 'user');
    setAutoBusy(true);

    try {
        const result = await requestChat(`Konteks Auto CS: ${message}`);
        setDraft(result.reply, 'Respons AI dipindahkan ke Draf. Review atau edit sebelum dikirim ke chat utama.');
        appendAutoChatMessage(result.reply, 'assistant');
    } catch (error) {
        appendAutoChatMessage(error.message || 'AI tidak dapat membalas pesan ini.', 'assistant');
    } finally {
        setAutoBusy(false);
    }
}

async function sendAutoStoryToMainChat() {
    const story = autoStoryPreview.value.trim();
    if (!story) {
        showToast('Buat atau isi story terlebih dahulu');
        return;
    }

    autoPanel.classList.remove('open');
    autoTab.classList.remove('active');
    setDetectorState('ready', 'Draf dikirim setelah review');
    showToast('Story dikirim ke chat utama');
    await sendMessage(story);
}

async function copyStoryDraft() {
    const story = autoStoryPreview.value.trim();
    if (!story) return;

    try {
        await navigator.clipboard.writeText(story);
        showToast('Draf berhasil disalin');
    } catch {
        showToast('Browser tidak mengizinkan penyalinan otomatis');
    }
}

async function clearHistory() {
    try {
        const response = await fetch('/api/reset', { method: 'POST' });
        await parseJsonResponse(response);
        chatBox.innerHTML = '';
        appendMessage('Void AI', welcomeMessage, 'assistant', { meta: 'Konteks baru' });
        showToast('Konteks chat sudah dihapus');
    } catch (error) {
        appendMessage('System', error.message || 'Gagal menghapus konteks chat.', 'assistant', {
            error: true,
            system: true,
            meta: 'Reset gagal'
        });
    }
}

async function copyCode(button) {
    const code = decodeURIComponent(button.dataset.code || '');
    try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Tersalin';
        showToast('Kode berhasil disalin');
        setTimeout(() => { button.textContent = 'Salin'; }, 1600);
    } catch {
        showToast('Browser tidak mengizinkan penyalinan otomatis');
    }
}

composer.addEventListener('submit', event => {
    event.preventDefault();
    sendMessage();
});

inputField.addEventListener('input', resetComposerHeight);
inputField.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});

fileUpload.addEventListener('change', () => {
    const selectedFile = fileUpload.files[0];
    if (!selectedFile) {
        filePreview.classList.remove('visible');
        return;
    }
    fileName.textContent = `${selectedFile.name} · siap dikirim`;
    filePreview.classList.add('visible');
});

document.getElementById('remove-file').addEventListener('click', () => {
    fileUpload.value = '';
    filePreview.classList.remove('visible');
});

document.getElementById('clear-button').addEventListener('click', clearHistory);

document.querySelectorAll('.suggestion').forEach(button => {
    button.addEventListener('click', () => {
        if (button.dataset.autoTab !== undefined) {
            const isOpen = autoPanel.classList.toggle('open');
            autoTab.classList.toggle('active', isOpen);
            if (isOpen) autoPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        inputField.value = button.dataset.prompt || '';
        resetComposerHeight();
        inputField.focus();
    });
});

document.getElementById('auto-close').addEventListener('click', () => {
    autoPanel.classList.remove('open');
    autoTab.classList.remove('active');
});
autoStoryForm.addEventListener('submit', generateAutoStory);
autoChatForm.addEventListener('submit', sendAutoChatMessage);
autoSendStoryButton.addEventListener('click', sendAutoStoryToMainChat);
autoStoryPreview.addEventListener('input', () => {
    const hasDraft = Boolean(autoStoryPreview.value.trim());
    autoSendStoryButton.disabled = !hasDraft;
    copyStoryButton.disabled = !hasDraft;
    setDetectorState(hasDraft ? 'edited' : 'idle', hasDraft ? 'Belum diperiksa untuk draf ini' : 'Belum diperiksa');
    if (hasDraft) {
        autoStoryState.textContent = 'Draf diedit. Periksa kembali sebelum dikirim ke chat utama.';
        autoStoryState.className = 'story-state';
    }
});
copyStoryButton.addEventListener('click', copyStoryDraft);

document.querySelectorAll('[data-toast]').forEach(button => {
    button.addEventListener('click', () => showToast(button.dataset.toast));
});

chatBox.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    if (actionButton.dataset.action === 'copy') {
        copyCode(actionButton);
    } else if (actionButton.dataset.action === 'run') {
        showToast('Kirim kode ke Void untuk menjalankannya dengan aman');
    }
});

appendMessage('Void AI', welcomeMessage, 'assistant', { meta: 'Sekarang · online' });