// Вхід у Telegram через QR-код (без коду з SMS/застосунку).
// Запускайте на комп'ютері; QR відкриється в браузері, скануйте його телефоном:
// Telegram → Налаштування → Пристрої → «Підключити пристрій».
// Запуск:  npm install telegram qrcode  &&  node tg-login-qr.mjs
import readline from 'node:readline/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import QRCode from 'qrcode';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => (await rl.question(q)).trim();
const page = resolve('telegram-qr.html');

function writePage(body) {
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3">
<title>Telegram QR</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;font:18px system-ui;text-align:center">
<div>${body}</div></body>`);
}

function openInBrowser(file) {
  const cmd = process.platform === 'win32' ? `start "" "${file}"` : process.platform === 'darwin' ? `open "${file}"` : `xdg-open "${file}"`;
  exec(cmd, () => {});
}

let opened = false;
try {
  const apiId = Number(await ask('API ID: '));
  const apiHash = await ask('API HASH: ');
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
  client.setLogLevel('error');
  await client.connect();

  await client.signInUserWithQrCode({ apiId, apiHash }, {
    qrCode: async ({ token }) => {
      const url = 'tg://login?token=' + token.toString('base64url');
      const svg = await QRCode.toString(url, { type: 'svg', margin: 2, width: 360 });
      writePage(`<h2>Скануйте телефоном</h2><p>Telegram → Налаштування → Пристрої → «Підключити пристрій»</p>${svg}<p style="color:#888">QR оновлюється автоматично</p>`);
      if (!opened) { opened = true; openInBrowser(page); console.log(`\nQR відкрито в браузері. Якщо не відкрився — відкрийте файл вручну:\n${page}\n`); }
      else console.log('QR оновлено (сторінка в браузері оновиться сама)');
    },
    password: async (hint) => ask(`\nПароль 2FA${hint ? ` (підказка: ${hint})` : ''}: `),
    onError: async (e) => {
      console.error('\nПомилка:', e?.errorMessage || e?.message || e);
      if (e?.seconds) console.error(`Telegram просить зачекати ${Math.ceil(e.seconds / 60)} хв.`);
      return true;
    },
  });

  writePage('<h2>Вхід виконано ✓</h2><p>Можна закрити цю сторінку.</p>');
  console.log('\nВхід виконано. TG_SESSION (тримайте в секреті, це доступ до акаунта):\n');
  console.log(client.session.save() + '\n');
  await client.disconnect();
  process.exit(0);
} catch (e) {
  console.error('\nПомилка:', e?.errorMessage || e?.message || e);
  process.exit(1);
}
