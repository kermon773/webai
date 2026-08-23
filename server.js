const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
// 1. Import child_process untuk menjalankan terminal
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { isHumanText } = require('./public/zerogpt');

const app = express();
const port = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR });

// 2. Tentukan folder Sandbox/Workspace agar AI tidak mengotak-atik sistem OS Anda
const WORKSPACE_DIR = path.join(__dirname, 'workspace');
const DATA_DIR = path.join(__dirname, 'data');
const AUTO_CS_GUIDE_PATH = path.join(DATA_DIR, 'auto-cs-guide.json');

async function readAutoCsGuide() {
    try {
        const raw = await fs.readFile(AUTO_CS_GUIDE_PATH, 'utf8');
        const saved = JSON.parse(raw);
        return {
            enabled: saved.enabled === true,
            text: typeof saved.text === 'string' ? saved.text : '',
            updatedAt: saved.updatedAt || null
        };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return { enabled: false, text: '', updatedAt: null };
    }
}

async function saveAutoCsGuide(guide) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const saved = {
        enabled: guide.enabled === true,
        text: String(guide.text || '').trim(),
        updatedAt: new Date().toISOString()
    };
    await fs.writeFile(AUTO_CS_GUIDE_PATH, JSON.stringify(saved, null, 2), 'utf8');
    return saved;
}

// 3. Update System Prompt
const SYSTEM_PROMPT = `You are a task-completion agent embedded in a development environment. 
Leverage your tools to accomplish the work end-to-end. Output absolute paths.

TOOL USE CAPABILITY:
To manipulate files or run commands, output a JSON block exactly in this format on a new line:
{"tool": "edit_file", "path": "absolute_path", "content": "new_content"}
{"tool": "rename_file", "oldPath": "old_path", "newPath": "new_path"}
{"tool": "delete_file", "path": "absolute_path"}
{"tool": "read_dir", "path": "absolute_path"}
{"tool": "run_command", "command": "your_shell_command"}`;

let chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
let remoteConversationId = null;

function textFromResponseObject(value) {
    if (!value || typeof value !== 'object') return '';

    if (typeof value.answer === 'string') return value.answer;
    if (typeof value.reply === 'string') return value.reply;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.message === 'string') return value.message;
    if (Array.isArray(value.choices)) {
        return value.choices
            .map(choice => choice?.message?.content || choice?.text || '')
            .filter(Boolean)
            .join('');
    }

    return '';
}

function parseRemoteResponse(body) {
    if (body && typeof body === 'object') {
        return {
            text: textFromResponseObject(body),
            error: body.error || body.message || '',
            conversationId: body.conversationId || null
        };
    }

    if (typeof body !== 'string') {
        return { text: '', error: '', conversationId: null };
    }

    const lines = body.split(/\r?\n/);
    const chunks = [];
    let conversationId = null;
    let sawEvent = false;

    for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        sawEvent = true;

        const payload = line.slice(5).trim();
        const normalizedPayload = payload.replace(/^['"]|['"]$/g, '');
        if (!payload || normalizedPayload === '[DONE]') continue;

        try {
            const event = JSON.parse(payload);
            const text = textFromResponseObject(event);
            if (text) chunks.push(text);
            conversationId = event.conversationId || conversationId;
        } catch {
            chunks.push(payload);
        }
    }

    if (sawEvent) {
        return { text: chunks.join(''), error: '', conversationId };
    }

    try {
        const parsed = JSON.parse(body);
        return {
            text: textFromResponseObject(parsed),
            error: parsed.error || parsed.message || '',
            conversationId: parsed.conversationId || null
        };
    } catch {
        return { text: body.trim(), error: '', conversationId: null };
    }
}

app.post('/api/reset', (req, res) => {
    chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
    remoteConversationId = null;
    res.json({ message: "History cleared." });
});

app.get('/api/auto-cs/guide', async (req, res) => {
    try {
        res.json(await readAutoCsGuide());
    } catch (error) {
        console.error('[Auto CS Guide] Read failed:', error.message);
        res.status(500).json({ error: 'Guide Auto CS tidak dapat dibaca.' });
    }
});

app.put('/api/auto-cs/guide', async (req, res) => {
    try {
        const text = typeof req.body?.text === 'string' ? req.body.text : '';
        if (text.length > 12000) {
            return res.status(400).json({ error: 'Guide maksimal 12.000 karakter.' });
        }
        const saved = await saveAutoCsGuide({
            enabled: req.body?.enabled === true,
            text
        });
        res.json(saved);
    } catch (error) {
        console.error('[Auto CS Guide] Save failed:', error.message);
        res.status(500).json({ error: 'Guide Auto CS gagal disimpan.' });
    }
});

app.post('/api/zerogpt/check', async (req, res) => {
    try {
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (text.length < 20) {
            return res.status(400).json({ error: 'Story terlalu pendek untuk diperiksa.' });
        }
        const result = await isHumanText(text);
        res.json(result);
    } catch (error) {
        console.error('[ZeroGPT] Check failed:', error.message);
        res.status(502).json({ error: 'Pemeriksaan ZeroGPT gagal dilakukan.' });
    }
});

app.post('/api/chat', upload.single('file'), async (req, res) => {
    try {
        const { message, model } = req.body;
        const file = req.file;
        let userMessage = message;

        if (file) {
            const fileContent = await fs.readFile(file.path, 'utf8');
            userMessage += `\n\n[Attached File Content: ${file.originalname}]\n${fileContent}`;
            await fs.unlink(file.path);
        }

        chatHistory.push({ role: 'user', content: userMessage });

        // Pastikan folder workspace ada sebelum AI mencoba melakukan apapun
        await fs.mkdir(WORKSPACE_DIR, { recursive: true });

        const remotePayload = {
            model: model || 'default-model',
            question: userMessage
        };

        if (remoteConversationId) {
            remotePayload.conversationId = remoteConversationId;
        }

        const response = await axios.post('https://arnaru-ai.vercel.app/api/chat', remotePayload, {
            responseType: 'text',
            timeout: 60000,
            validateStatus: () => true
        });

        const parsedResponse = parseRemoteResponse(response.data);
        if (response.status >= 400 || parsedResponse.error) {
            throw new Error(parsedResponse.error || `AI service returned HTTP ${response.status}`);
        }

        let aiText = parsedResponse.text;
        if (!aiText) {
            throw new Error('AI service returned an empty response');
        }

        remoteConversationId = parsedResponse.conversationId || remoteConversationId;
        const toolMatches = aiText.match(/\{"tool":.*?\}/g);
        let workflowLogs = [];

        if (toolMatches) {
            for (let match of toolMatches) {
                try {
                    const tool = JSON.parse(match);
                    
                    if (tool.tool === 'edit_file') {
                        await fs.writeFile(tool.path, tool.content, 'utf8');
                        workflowLogs.push(`[Agent] Berhasil mengedit file: ${tool.path}`);
                    } 
                    else if (tool.tool === 'read_dir') {
                        const files = await fs.readdir(tool.path);
                        workflowLogs.push(`[Agent] Isi direktori ${tool.path}: ${files.join(', ')}`);
                        aiText += `\n\n[System Log: Direktori ${tool.path} berisi: ${files.join(', ')}]`;
                    }
                    // 4. Tambahkan logika eksekusi perintah terminal
                    else if (tool.tool === 'run_command') {
                        workflowLogs.push(`[Terminal] Menjalankan: ${tool.command}`);
                        
                        try {
                            const { stdout, stderr } = await execPromise(tool.command, {
                                cwd: WORKSPACE_DIR, // Batasi eksekusi HANYA di folder workspace
                                timeout: 30000 // Batas waktu 30 detik agar tidak hang
                            });
                            
                            const output = stdout || stderr || 'Command executed successfully with no output.';
                            workflowLogs.push(`[Terminal Output]: Sukses`);
                            
                            // Berikan hasil terminal kembali ke AI agar ia tahu apakah berhasil/gagal
                            aiText += `\n\n[System Log: Hasil perintah '${tool.command}':\n${output.substring(0, 1000)}]`; 
                            // Limit 1000 karakter agar token tidak jebol jika output npm install terlalu panjang
                        } catch (execError) {
                            workflowLogs.push(`[Terminal Error]: Command gagal.`);
                            aiText += `\n\n[System Log: Gagal menjalankan '${tool.command}': ${execError.message}\n${execError.stdout || ''}]`;
                        }
                    }
                    aiText = aiText.replace(match, '');
                } catch (e) {
                    workflowLogs.push(`[Agent] Gagal mengeksekusi tool: ${e.message}`);
                }
            }
        }

        chatHistory.push({ role: 'assistant', content: aiText.trim() });
        res.json({ reply: aiText.trim(), logs: workflowLogs });
    } catch (error) {
        const message = error.response
            ? parseRemoteResponse(error.response.data).error
            : error.message;
        console.error('[Chat API]', message || error);
        res.status(502).json({
            error: message || "AI service is unavailable. Please try again.",
            code: 'AI_SERVICE_ERROR'
        });
    }
});

// Image Generation Endpoint
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt, model } = req.body;
        
        // Adjust endpoint based on actual arnaru-ai docs
        const response = await axios.post('https://arnaru-ai.vercel.app/api/generate', {
            prompt: prompt,
            model: model || 'image-model'
        });

        res.json({ imageUrl: response.data.url || response.data.image_url });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to generate image." });
    }
});

app.listen(port, () => console.log(`AI Agent Web running at http://localhost:${port}`));
