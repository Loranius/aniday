// Одноразовий вхід у Telegram, щоб отримати TG_SESSION для Vercel.
// Показує, куди саме Telegram надіслав код, і дозволяє запросити повторну відправку.
// Запуск:  node scripts/tg-login.mjs
import readline from 'node:readline/promises';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => (await rl.question(q)).trim();

const where = (t) => {
  if (!t) return 'невідомо';
  const n = t.className;
  if (n === 'auth.SentCodeTypeApp') return 'у застосунок Telegram (чат «Telegram» з синьою галочкою, перевірте й Архів)';
  if (n === 'auth.SentCodeTypeSms') return 'SMS-повідомленням';
  if (n === 'auth.SentCodeTypeEmailCode') return `на пошту ${t.emailPattern || ''}`;
  if (n === 'auth.SentCodeTypeCall' || n === 'auth.SentCodeTypeFlashCall' || n === 'auth.SentCodeTypeMissedCall') return 'дзвінком (код — останні цифри номера, що дзвонить)';
  if (n === 'auth.SentCodeTypeFragmentSms') return 'через Fragment (fragment.com)';
  if (n === 'auth.SentCodeTypeFirebaseSms' || n === 'auth.SentCodeTypeSmsWord' || n === 'auth.SentCodeTypeSmsPhrase') return 'SMS-повідомленням';
  if (n === 'auth.SentCodeTypeSetUpEmailRequired') return 'НЕ надіслано: Telegram вимагає спершу прив’язати пошту до акаунта в офіційному застосунку';
  return n;
};

function fail(e) {
  const msg = e?.errorMessage || e?.message || String(e);
  console.error('\nПомилка:', msg);
  if (e?.seconds) console.error(`Telegram просить зачекати ${Math.ceil(e.seconds / 60)} хв. Нічого не запускайте до того часу.`);
  process.exit(1);
}

try {
  const apiId = Number(await ask('API ID: '));
  const apiHash = await ask('API HASH: ');
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
  client.setLogLevel('error');
  await client.connect();

  let phone = await ask('Ваш номер з кодом країни (+380...): ');
  if (!phone.startsWith('+')) phone = '+' + phone.replace(/\D/g, '');

  let sent = await client.invoke(new Api.auth.SendCode({
    phoneNumber: phone, apiId, apiHash, settings: new Api.CodeSettings({}),
  }));
  if (sent instanceof Api.auth.SentCodeSuccess) throw new Error('Неочікувана відповідь, спробуйте пізніше');

  let user;
  while (!user) {
    console.log(`\nКод надіслано: ${where(sent.type)}`);
    if (sent.nextType) console.log(`Якщо не прийде — введіть r, і Telegram надішле ще раз: ${where(sent.nextType)}`);
    const code = await ask('Код (або r): ');
    if (code.toLowerCase() === 'r') {
      sent = await client.invoke(new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash: sent.phoneCodeHash }));
      continue;
    }
    try {
      const r = await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: sent.phoneCodeHash, phoneCode: code }));
      if (r instanceof Api.auth.AuthorizationSignUpRequired) throw new Error('На цей номер немає акаунта Telegram');
      user = r.user;
    } catch (e) {
      if (e?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        const pw = await client.invoke(new Api.account.GetPassword());
        const password = await ask(`Пароль 2FA${pw.hint ? ` (підказка: ${pw.hint})` : ''}: `);
        const r = await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pw, password) }));
        user = r.user;
      } else if (e?.errorMessage === 'PHONE_CODE_INVALID') {
        console.log('Невірний код, спробуйте ще раз.');
      } else throw e;
    }
  }

  console.log('\nВхід виконано. TG_SESSION (тримайте в секреті, це доступ до акаунта):\n');
  console.log(client.session.save() + '\n');
  await client.disconnect();
  process.exit(0);
} catch (e) {
  fail(e);
}
