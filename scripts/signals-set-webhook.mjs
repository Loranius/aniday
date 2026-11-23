// Використання: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/signals-set-webhook.mjs https://<домен>/api/signals/telegram
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = process.argv[2];
if (!token || !secret || !url) {
  console.error('Потрібні TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET і URL першим аргументом');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'] }),
});
console.log(await res.text());
