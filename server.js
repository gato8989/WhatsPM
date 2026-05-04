const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// FORZAR Chrome del sistema ANTES de cualquier otra cosa
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/google-chrome-stable';
process.env.CHROME_PATH = '/usr/bin/google-chrome-stable';

const app = express();
app.use(express.json({ limit: '50mb' }));

const API_KEY = process.env.AUTHENTICATION_API_KEY || 'PM5-SuperSecret-Key-2026';
const PORT = process.env.PORT || process.env.SERVER_PORT || 8080;

let client = null;
let qrCodeData = null;
let isConnected = false;
let clientInfo = null;

console.log('🔧 Configuración de Chrome:', {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    skipDownload: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
});

function authMiddleware(req, res, next) {
    const apiKey = req.headers['apikey'] || req.headers['authorization']?.replace('Bearer ', '');
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

function formatPhone(number) {
    let formatted = number.replace(/[^0-9]/g, '');
    if (formatted.length === 10) {
        formatted = '52' + formatted;
    }
    return formatted;
}

async function getChatId(number) {
    const formatted = formatPhone(number);
    try {
        const registered = await client.getNumberId(formatted);
        if (registered) return registered._serialized;
    } catch (e) {}
    return formatted + '@c.us';
}

function initClient() {
    if (client) return;
    console.log('🚀 Inicializando cliente de WhatsApp...');

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: '/app/instances' }),
        puppeteer: {
            headless: true,
            executablePath: '/usr/bin/google-chrome-stable', // FORCE explícito
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('📱 Nuevo QR generado');
        qrCodeData = await qrcode.toDataURL(qr);
        isConnected = false;
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp conectado');
        isConnected = true;
        qrCodeData = null;
        clientInfo = client.info;
        console.log('📞 Número:', clientInfo.wid?.user);
    });

    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp desconectado:', reason);
        isConnected = false;
        clientInfo = null;
        client = null;
        setTimeout(() => initClient(), 10000);
    });

    client.initialize().catch(err => {
        console.error('❌ Error inicializando:', err.message);
        client = null;
        setTimeout(() => initClient(), 10000);
    });
}

initClient();

// Endpoints
app.get('/', authMiddleware, (req, res) => res.json({ status: 'running', connected: isConnected }));

app.get('/qr', authMiddleware, async (req, res) => {
    if (isConnected) return res.json({ connected: true, number: clientInfo?.wid?.user });
    return res.json({ connected: false, qrcode: qrCodeData });
});

app.get('/status', authMiddleware, (req, res) => res.json({ connected: isConnected, number: clientInfo?.wid?.user }));

app.post('/send-text', authMiddleware, async (req, res) => {
    try {
        const { number, text } = req.body;
        if (!number || !text) return res.status(400).json({ error: 'number y text son requeridos' });
        if (!isConnected) return res.status(503).json({ error: 'WhatsApp no conectado' });
        const chatId = await getChatId(number);
        await client.sendMessage(chatId, text);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/send-document', authMiddleware, async (req, res) => {
    try {
        const { number, document, fileName, caption } = req.body;
        if (!number || !document) return res.status(400).json({ error: 'number y document son requeridos' });
        if (!isConnected) return res.status(503).json({ error: 'WhatsApp no conectado' });
        
        let base64Data = document;
        if (base64Data.includes(',')) base64Data = base64Data.split(',')[1];
        
        const media = new MessageMedia('application/pdf', base64Data, fileName || 'documento.pdf');
        const chatId = await getChatId(number);
        await client.sendMessage(chatId, media, { caption: caption || '' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/logout', authMiddleware, async (req, res) => {
    if (client) {
        try { await client.logout(); } catch(e) {}
        try { await client.destroy(); } catch(e) {}
        client = null;
    }
    isConnected = false;
    qrCodeData = null;
    setTimeout(initClient, 3000);
    res.json({ success: true, message: 'Sesión cerrada' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log('  PM5 WhatsApp API');
    console.log(`  Puerto: ${PORT}`);
    console.log('=========================================');
});