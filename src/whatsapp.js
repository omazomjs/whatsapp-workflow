import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';
import { config } from '../config.js';

const { Client, LocalAuth } = wweb;

const QR_DIR = path.join(process.cwd(), 'qr');

function saveQrImage(qr) {
  try {
    fs.mkdirSync(QR_DIR, { recursive: true });
    const file = path.join(QR_DIR, 'linked-qr.png');
    const base64 = qr.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    console.log(`[WhatsApp] QR guardado en: ${file}`);
  } catch (err) {
    console.error('[WhatsApp] No se pudo guardar el QR:', err.message);
  }
}

function startQrServer(port) {
  const file = () => path.join(QR_DIR, 'linked-qr.png');
  const server = http.createServer((req, res) => {
    if (req.url === '/qr.png' && fs.existsSync(file())) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(fs.readFileSync(file()));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('QR no disponible aun. Levante la sesion como servicio y vuelva a entrar.');
    }
  });
  server.listen(port, () => {
    console.log(`[WhatsApp] QR en http://localhost:${port}/qr.png  (o http://IP-DEL-SERVIDOR:${port}/qr.png)`);
  });
  return server;
}

export function createClient({ onReady }) {
  if (config.whatsapp.qrPort > 0) {
    startQrServer(config.whatsapp.qrPort);
  }

  const puppeteer = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (config.whatsapp.chromePath) {
    puppeteer.executablePath = config.whatsapp.chromePath;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'workflow' }),
    puppeteer,
  });

  client.on('qr', (qr) => {
    if (qr.startsWith('data:image')) {
      saveQrImage(qr);
    } else {
      qrcode.generate(qr, { small: true });
    }
    console.log('\n[WhatsApp] Escanea el QR con el movil: WhatsApp > Dispositivos vinculados');
  });

  client.on('authenticated', () => console.log('[WhatsApp] Autenticado, sesion guardada.'));
  client.on('ready', () => {
    console.log('[WhatsApp] Sesion lista.');
    onReady(client);
  });

  client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Fallo de autenticacion:', msg);
    process.exit(1);
  });

  client.on('disconnected', (reason) => {
    console.warn('[WhatsApp] Desconectado:', reason, '-> reintentando en 10s...');
    setTimeout(() => {
      client.initialize().catch((err) => console.error('[WhatsApp] Error al reconectar:', err.message));
    }, 10000);
  });

  client.initialize().catch((err) => {
    console.error('[WhatsApp] Error al iniciar:', err.message);
    process.exit(1);
  });

  return client;
}