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
