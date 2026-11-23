# AniDay Backend

API на **Next.js API Routes + Prisma + PostgreSQL**, деплой на **Vercel** (безкоштовний тір).

## Ендпоінти

| Метод | Шлях | Опис | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Реєстрація `{ username, password }` → `{ token, user }` | ні |
| POST | `/api/auth/login` | Логін `{ username, password }` → `{ token, user }` | ні |
| GET | `/api/watchlist?status=watching` | Список тайтлів (фільтр опціональний) | так |
| POST | `/api/watchlist` | Додати/оновити тайтл у списку | так |
| PATCH | `/api/watchlist/:animeId` | Оновити прогрес/статус/оцінку | так |
| DELETE | `/api/watchlist/:animeId` | Видалити тайтл зі списку | так |
| POST | `/api/episodes` | Додати/оновити відео для серії `{ animeId, episodeNumber, videoUrl, duration? }` | так |
| GET | `/api/episodes?animeId=123` | Список серій з посиланнями на відео | ні |

## Як додати власне відео

Це особистий застосунок, тож немає окремої адмін-панелі — додавайте епізоди прямим запитом (з токеном, отриманим після логіну):

```bash
curl -X POST https://<your-project>.vercel.app/api/episodes \
  -H "Authorization: Bearer <ваш JWT>" \
  -H "Content-Type: application/json" \
  -d '{"animeId": 1, "episodeNumber": 1, "videoUrl": "https://your-storage.com/anime1/ep1.m3u8"}'
```

`videoUrl` — посилання на **ваш власний** легально отриманий файл/стрім (не сторонній сайт). `audioLanguage` завжди `"ukr"` за замовчуванням — застосунок примусово відтворює лише українську доріжку, навіть якщо у файлі їх кілька.


Захищені ендпоінти очікують заголовок:
```
Authorization: Bearer <token>
```

## Локальний запуск

### 1. Створіть безкоштовну базу на Neon

1. Зареєструйтесь на https://neon.tech
2. Створіть проєкт → скопіюйте **Pooled connection string** (для `DATABASE_URL`) і **Direct connection string** (для `DIRECT_URL`)

### 2. Налаштуйте змінні середовища

```bash
cp .env.example .env
# впишіть DATABASE_URL, DIRECT_URL та згенеруйте JWT_SECRET:
openssl rand -base64 48
```

### 3. Встановіть залежності та накатіть міграцію

```bash
npm install
npx prisma migrate dev --name init
```

### 4. Запустіть локально

```bash
npm run dev
```

API буде доступне на `http://localhost:3000/api/...`

## Деплой на Vercel (безкоштовно)

1. Залийте цей код у GitHub-репозиторій
2. Зайдіть на https://vercel.com → **New Project** → оберіть репозиторій
3. У Settings → Environment Variables додайте `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET` (ті самі, що й локально)
4. Deploy — Vercel сам розпізнає Next.js і збудує проєкт

Після деплою ваш API буде на `https://<project>.vercel.app/api/...` — саме цей URL підставляєте у мобільному застосунку.

## Налаштування Google Sign-In

1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
2. Створіть **3 client ID**: `Web application` (для бекенду, `GOOGLE_CLIENT_ID`), `iOS`, `Android` (для застосунку)
3. Для iOS/Android вкажіть Bundle ID / Package name, які збігаються з `app.json` мобільного застосунку
4. У бекенді в `.env` пропишіть `GOOGLE_CLIENT_ID` = **саме Web client ID** (він перевіряє токени, видані для будь-якого з трьох клієнтів вашого проєкту)




У `aniday-app` створіть `src/api/client.ts`:

```ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const api = axios.create({ baseURL: 'https://<your-project>.vercel.app/api' });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
```

Далі: `api.post('/auth/login', { username, password })`, `api.get('/watchlist')` і так далі.

## Телеграм за номером телефону (`/tg`)

Сторінка `https://<project>.vercel.app/tg`: вводите номер і отримуєте **нікнейм**, **Telegram ID** та ім'я, якщо номер зареєстрований у Telegram.
Під капотом ендпоінт `GET /api/tg/check?phone=380671234567` (заголовок `X-Access-Key`) через **ваш** Telegram-акаунт тимчасово додає номер у контакти, читає дані користувача й одразу видаляє контакт.

Налаштування (один раз):

1. На https://my.telegram.org → **API development tools** створіть додаток і скопіюйте `api_id` та `api_hash`.
2. Локально отримайте сесію (попросить ваш номер і код з Telegram):
   ```bash
   npm install
   TG_API_ID=... TG_API_HASH=... node scripts/tg-login.mjs
   ```
3. У Vercel → Settings → Environment Variables додайте:
   - `TG_API_ID`, `TG_API_HASH` — з кроку 1
   - `TG_SESSION` — рядок із кроку 2 (**це повний доступ до акаунта, нікому не передавайте**)
   - `TG_ACCESS_KEY` — будь-який довгий пароль (`openssl rand -hex 16`), його вводите на сторінці
4. Redeploy.

Обмеження: «не знайдено» означає, що номера немає в Telegram **або** людина заборонила пошук за номером. Telegram обмежує кількість таких перевірок (сервер поверне 429), тому для масових перевірок це не підходить.

## Бот крипто-сигналів (Bitget USDT-futures → Telegram)

Окремий бот у цьому ж репозиторії (код у `lib/signals/*`, ендпоінти `pages/api/signals/*`). Сканує **публічні** дані Bitget (`productType=USDT-FUTURES`), шукає сетапи в режимах `scalp` / `intraday` / `pump`, просить Claude підтвердити сигнал і надсилає його вам у Telegram з розрахунком позиції, плеча й ризику. Жодних API-ключів Bitget, жодних ордерів — бот лише надсилає повідомлення. Працює як **окремий проєкт Vercel з окремою базою**; проєкт AniDay не потребує жодних нових змінних середовища.

> Застереження: це **не фінансова порада**. Пороги стратегій у `lib/signals/config.ts` — лише стартові значення. Оцінюйте стратегію за статистикою (`/stats`) після кількох тижнів роботи, а не за окремими угодами. Запити до Bitget під час розробки наживо ніколи не виконувалися — перший живий запуск зробіть вручну (крок 8).

### 1. Telegram-бот і ваш ID
1. У [@BotFather](https://t.me/BotFather): `/newbot` → отримайте токен → це `TELEGRAM_BOT_TOKEN`.
2. Напишіть [@userinfobot](https://t.me/userinfobot) — він покаже ваш числовий ID → це `TELEGRAM_OWNER_ID`. Бот відповідає лише власнику.
3. Згенеруйте два секрети: `openssl rand -hex 32` → `TELEGRAM_WEBHOOK_SECRET`, ще раз → `CRON_SECRET`.
4. Напишіть своєму боту `/start`, щоб він міг вам писати.

### 2. Claude API
Створіть ключ на https://console.anthropic.com → `ANTHROPIC_API_KEY`. Одразу виставте там **місячний ліміт витрат** — це друга лінія захисту. Власний бюджет бота: ≤ $20 на календарний місяць і ≤ $20/30 на добу (за Києвом); після ліміту сигнали надходять без Claude з позначкою «⚠️ без перевірки Claude».

### 3. База Supabase
Створіть **новий** проєкт Supabase (не базу AniDay). Project → **Connect** → ORM/Prisma:
- pooled-URL (порт `6543`) з додатком `?pgbouncer=true` → `SIGNALS_DATABASE_URL`;
- direct/session-URL (порт `5432`) → `SIGNALS_DIRECT_URL`.

Створіть таблиці (один раз, локально, після `npm install`):
```bash
SIGNALS_DATABASE_URL='...' SIGNALS_DIRECT_URL='...' npm run signals:db-push
```
Альтернатива без CLI: вставте вміст `prisma/signals-migrations/0001_init/migration.sql` у Supabase → SQL Editor і виконайте.

### 4. Проєкт Vercel
Vercel → Add New Project → той самий репозиторій (другий проєкт поруч з AniDay). Build Command за замовчуванням (`npm run build`). У Settings → Environment Variables додайте:

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
