# Crypto Signals Bot

Особистий Telegram-бот сигналів лонг/шорт для USDT-M ф’ючерсів Bitget на Next.js API Routes + Prisma + Supabase, деплой на Vercel.

## Бот крипто-сигналів (Bitget USDT-futures → Telegram)

Код у `lib/signals/*`, ендпоінти `pages/api/signals/*`. Сканує **публічні** дані Bitget (`productType=USDT-FUTURES`), шукає сетапи в режимах `scalp` / `intraday` / `pump`, просить Claude підтвердити сигнал і надсилає його вам у Telegram з розрахунком позиції, плеча й ризику. Жодних API-ключів Bitget, жодних ордерів — бот лише надсилає повідомлення.

> Застереження: це **не фінансова порада**. Пороги стратегій у `lib/signals/config.ts` — лише стартові значення. Оцінюйте стратегію за статистикою (`/stats`) після кількох тижнів роботи, а не за окремими угодами. Запити до Bitget під час розробки наживо ніколи не виконувалися — перший живий запуск зробіть вручну (крок 8).

### 1. Telegram-бот і ваш ID
1. У [@BotFather](https://t.me/BotFather): `/newbot` → отримайте токен → це `TELEGRAM_BOT_TOKEN`.
2. Напишіть [@userinfobot](https://t.me/userinfobot) — він покаже ваш числовий ID → це `TELEGRAM_OWNER_ID`. Бот відповідає лише власнику.
3. Згенеруйте два секрети: `openssl rand -hex 32` → `TELEGRAM_WEBHOOK_SECRET`, ще раз → `CRON_SECRET`.
4. Напишіть своєму боту `/start`, щоб він міг вам писати.

### 2. Claude API
Створіть ключ на https://console.anthropic.com → `ANTHROPIC_API_KEY`. Одразу виставте там **місячний ліміт витрат** — це друга лінія захисту. Власний бюджет бота: ≤ $20 на календарний місяць і ≈ $0.67 на добу (≤ $20 на місяць) (за Києвом); після ліміту сигнали надходять без Claude з позначкою «⚠️ без перевірки Claude».

### 3. База Supabase
Створіть **новий** проєкт Supabase лише для бота. Project → **Connect** → ORM/Prisma:
- pooled-URL (порт `6543`) з додатком `?pgbouncer=true&connection_limit=1` → `SIGNALS_DATABASE_URL`;
- direct/session-URL (порт `5432`) → `SIGNALS_DIRECT_URL`.

Створіть таблиці (один раз, локально, після `npm install`):
```bash
SIGNALS_DATABASE_URL='...' SIGNALS_DIRECT_URL='...' npm run signals:db-push
```
Альтернатива без CLI: вставте вміст `prisma/signals-migrations/0001_init/migration.sql` у Supabase → SQL Editor і виконайте.

### 4. Проєкт Vercel
Vercel → Add New Project → цей репозиторій. Build Command за замовчуванням (`npm run build`). У Settings → Environment Variables додайте:

| Змінна | Звідки |
|---|---|
| `SIGNALS_DATABASE_URL`, `SIGNALS_DIRECT_URL` | крок 3 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `TELEGRAM_WEBHOOK_SECRET` | крок 1 |
| `CRON_SECRET` | крок 1 |
| `ANTHROPIC_API_KEY` | крок 2 |

Задеплойте (Redeploy, якщо змінні додали після першого збирання).

### 5. Webhook Telegram
```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/signals-set-webhook.mjs https://<project>.vercel.app/api/signals/telegram
```
У відповіді має бути `"ok":true`.

### 6. Завдання на cron-job.org
Vercel Hobby не запускає cron щохвилини, тому розклад — на [cron-job.org](https://cron-job.org). Створіть два завдання з методом GET і заголовком `Authorization: Bearer <CRON_SECRET>`; таймаут — 60 с (наскільки дозволяє безкоштовний план, інакше залиште типовий):

| Завдання | URL | Розклад |
|---|---|---|
| scalp | `https://<project>.vercel.app/api/signals/scan?job=scalp` | щохвилини |
| swing | `https://<project>.vercel.app/api/signals/scan?job=swing` | кожні 5 хв |

`scalp` не звертається до БД, якщо кандидатів немає; `swing` сканує intraday/pump, веде трекінг відкритих сигналів і знімає снапшоти.

### 7. Команди бота
- `/stats [7d|30d|all]` — статистика (за замовч. 30d)
- `/open` — відкриті сигнали
- `/risk <scalp|intraday|pump|all> <%>` — ризик на угоду
- `/deposit <usd>` — депозит (за замовч. $500)
- `/pause [режим|all]`, `/resume [режим|all]` — призупинити / відновити
- `/limit <n>` — денний ліміт скальпу

### 8. Перша жива перевірка
Після деплою викличте вручну й перегляньте JSON-звіт:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<project>.vercel.app/api/signals/scan?job=swing"
```
`401` — невірний `CRON_SECRET`; `500` — дивіться логи Vercel (зазвичай відсутня змінна або недоступна БД). Далі перевірте `/stats` у Telegram і дочекайтеся першого сигналу.
