// Одноразовий вхід у Telegram, щоб отримати TG_SESSION для Vercel.
// Запуск:  TG_API_ID=... TG_API_HASH=... node scripts/tg-login.mjs
import readline from 'node:readline/promises';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const apiId = Number(process.env.TG_API_ID || (await rl.question('TG_API_ID: ')));
const apiHash = process.env.TG_API_HASH || (await rl.question('TG_API_HASH: '));

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
await client.start({
  phoneNumber: () => rl.question('Ваш номер телефону (+380...): '),
  phoneCode: () => rl.question('Код з Telegram: '),
  password: () => rl.question('Пароль 2FA (якщо є): '),
  onError: async (e) => { console.error('Помилка:', e.errorMessage || e.message || e); if (e.seconds) console.error(`Telegram просить зачекати ${Math.ceil(e.seconds / 60)} хв. Скрипт зупинено.`); return true; },
});

console.log('\nTG_SESSION (тримайте в секреті, це доступ до акаунта):\n');
console.log(client.session.save());
await client.disconnect();
rl.close();
process.exit(0);
