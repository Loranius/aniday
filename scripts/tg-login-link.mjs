// Вхід у Telegram без коду: через посилання tg://login (підтвердження в застосунку Telegram).
// Запуск:  node scripts/tg-login-link.mjs
import readline from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const apiId = Number(await ask('API ID: '));
const apiHash = (await ask('API HASH: ')).trim();
const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
await client.connect();
await client.signInUserWithQrCode({ apiId, apiHash }, {
  qrCode: async ({ token }) => {
    const url = 'tg://login?token=' + token.toString('base64url');
    console.log('\nВідкриваю Telegram — підтвердіть вхід. Якщо не відкрився, вставте посилання в «Збережене» і натисніть:');
    console.log(url + '\n(посилання оновлюється кожні ~30 с)\n');
    execFile('termux-open-url', [url], () => {}); // у Termux відкриває Telegram; деінде просто нічого не робить
  },
  password: async () => ask('Пароль 2FA: '),
  onError: async (e) => { console.error('Помилка:', e.errorMessage || e.message || e); if (e.seconds) console.error(`Telegram просить зачекати ${Math.ceil(e.seconds / 60)} хв. Скрипт зупинено.`); return true; },
});
console.log('\n=== TG_SESSION ===\n' + client.session.save() + '\n');
process.exit(0);
