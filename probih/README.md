# Пробіг — облік авто, пробігу та обслуговування (Android)

Персональний Android-застосунок: **GPS → поїздка → кілометраж → загальний пробіг → обслуговування → прогноз наступної заміни**.
Карта, поїздки, збережені місця та базова навігація — другорядні функції.

Стек: **React + TypeScript + Vite + Tailwind CSS**, обгорнутий у нативний Android-застосунок через **Capacitor 7**;
бекенд — **Supabase** (PostgreSQL, Auth, RLS, Realtime). Карта — Leaflet + OpenStreetMap (без API-ключів).

## Чому Capacitor

Вимога — Android-застосунок, а стек — React/Vite/Tailwind. Capacitor дає справжній APK з нативними плагінами:

- `@capacitor-community/background-geolocation` — запис поїздки з вимкненим екраном (foreground service + сповіщення);
- `@capacitor/geolocation`, `@capacitor/network`, `@capacitor/preferences` (SharedPreferences), `@capacitor/app`.

Той самий код працює й у браузері (для розробки/десктопу), але там запис іде лише з відкритою вкладкою.

## Архітектура

```
src/
  domain/        чисті функції та типи (без React, без мережі) — уся бізнес-логіка
    types.ts         сутності (snake_case = колонки БД)
    geo.ts           haversine, calculateTripDistance (фільтр GPS-стрибків, jitter, точність), спрощення маршруту
    odometer.ts      calculateTotalOdometer / breakdown — derived-пробіг
    maintenance.ts   calculateMaintenanceStatus, calculateNextService, шаблони розхідників
    prediction.ts    calculateAverageMonthlyMileage, estimateServiceDate
    fuel.ts          calculateFuelConsumption (full-to-full), calculateCostPerKm, підсумки витрат
    trips.ts         summarizeTrip, matchPlace, findFrequentRoutes
    overview.ts      buildVehicleOverview — усі цифри дашборда в одному місці
    demo.ts          генератор демо-даних (is_demo = true)
  data/          шар даних
    supabaseClient.ts    клієнт (сесія в Preferences — переживає перезапуск)
    supabaseRepository.ts читання + SyncTransport (insert … on conflict do nothing)
    syncQueue.ts         офлайн-черга: локально → черга → (онлайн) → Supabase; applyPendingOps
    storage.ts           KeyValueStore (Preferences / пам'ять для тестів)
  tracking/      GPS-шар
    locationProvider.ts  інтерфейс LocationProvider (phone / obd / gps_tracker)
    phoneLocationProvider.ts  Android foreground service або navigator.geolocation
    tripRecorder.ts      стан-машина поїздки, семплінг, відновлення після вбивства процесу
  map/           MapProvider (інтерфейс) + LeafletMapProvider
  navigation/    NavigationService (інтерфейс) + ExternalAppNavigationService
  app/           провайдер стану, роутинг, оболонка з нижньою навігацією, тема
  features/      екрани: auth, vehicle, dashboard, map, trips, maintenance, fuel, places, more
  ui/            примітиви (Card, Button, Sheet, Field…), форматування uk-UA
supabase/
  migrations/    схема, тригери, RLS, realtime
  tests/         SQL-тести тригерів і RLS на локальному PostgreSQL
android/         нативний проєкт Capacitor
```

### Ключові рішення

- **Пробіг — derived, а не поле.** `пробіг = базова точка (останній показник одометра або initial_odometer) + Σ валідних
  поїздок після неї + Σ ручних км після неї`. Та сама формула в TS (`odometer.ts`) і в SQL (`calculate_vehicle_odometer`).
  `vehicles.current_odometer` перераховує тригер; клієнт не може його записати.
- **Аудит.** Коригування та ручні км — окрема таблиця `odometer_entries` (журнал). Виміряні дані поїздки незмінні
  (тригер), поїздку можна лише позначити «не враховувати» з причиною.
- **Без дублювання км.** `id` поїздки генерується на телефоні; синхронізація — `insert … on conflict do nothing`;
  додатково `unique (vehicle_id, started_at)`. Повтор відправки не додає кілометрів.
- **Обслуговування** — `MaintenanceItem` (інтервал км та/або днів, «що раніше») + `MaintenanceEvent`.
  `last_service_*` виводиться тригером з останньої події, тож заміна «раніше плану» просто стає новою базою.
  Статуси: 🟢 OK (< 85 %), 🟡 Скоро (≥ 85 %), 🔴 Час замінити (≥ 97 %), ⚫ Прострочено (> 100 %).
- **Прогноз** — середній пробіг за 90 днів (мінімум 14 днів історії) → «Орієнтовно через N місяців». Це прогноз, не дата.
- **Офлайн.** Усі записи йдуть через персистентну чергу (SharedPreferences). Активна поїздка зберігається кожні 15 с —
  після вбивства процесу її можна продовжити або завершити. Знімок даних кешується для холодного старту без мережі.
- **GPS.** distanceFilter 10 м, точка не частіше ніж раз на 5 с (або при зсуві ≥ 30 м), відкидання точок з точністю
  гірше 100 м, фільтр стрибків (> 252 км/год), обробка: дозвіл відхилено, GPS вимкнено, слабкий/втрачений сигнал,
  втрата інтернету, повторне підключення.
- **Real-time-готовність.** `vehicle_locations` (source: phone / obd / gps_tracker / manual) у публікації
  `supabase_realtime`; карта підписана на нові позиції. Зовнішній трекер/OBD лише пише в цю таблицю — UI не змінюється.
- **VIN не дає GPS.** VIN і номер — лише ідентифікатори. Жодної «інтеграції», що нібито знаходить авто за VIN.
- **Навігація.** Власного routing engine немає. `NavigationService` передає пункт призначення встановленому навігатору
  (Google Maps тощо); оцінка «Дім → Робота 21 км ~32 хв» — з вашої історії поїздок. Для варіантів Fastest/Shortest/
  Alternative у застосунку треба підключити провайдера (Mapbox/OSRM/Google), що реалізує `getRoutes()`.

## База даних

Таблиці: `profiles`, `vehicles`, `odometer_entries`, `saved_places`, `trips`, `trip_points`, `vehicle_locations`,
`maintenance_items`, `maintenance_events`, `fuel_entries` + view `maintenance_item_status` (security_invoker).

- RLS увімкнено на всіх таблицях; користувач бачить і змінює лише свої авто та все, що до них належить. `anon` — без доступу.
- FK з `on delete cascade`, CHECK-обмеження (координати, невід'ємні км/літри/вартість, формат VIN, порядок часу),
  складений FK «подія ТО належить тому ж авто, що й позиція».
- Індекси: `vehicle_id`, `user_id`, часові (`started_at`, `ended_at`, `recorded_at`, `timestamp`), `date`, `odometer`.

## Запуск

```bash
npm install
cp .env.example .env        # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (публічний anon key; секретів у коді немає)
npm run dev                 # у браузері
```

### Supabase

1. Створіть проєкт на supabase.com.
2. Застосуйте міграції з `supabase/migrations` по порядку (SQL Editor або `supabase link && supabase db push`).
3. Authentication → Providers → Email: увімкнено. Якщо «Confirm email» увімкнено — після реєстрації треба підтвердити пошту.

### Android APK

Потрібні Android Studio / Android SDK і JDK 21.

```bash
npm run android:sync        # збірка web + копіювання в android/
npm run android:open        # відкрити в Android Studio → Run
# або без IDE:
npm run android:apk         # android/app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions (`.github/workflows/probih-android.yml`) запускає перевірки й збирає debug-APK як артефакт.
Для робочого APK додайте секрети репозиторію `VITE_SUPABASE_URL` і `VITE_SUPABASE_ANON_KEY`.

На телефоні: при першому старті поїздки дозвольте «Точне місцезнаходження» та сповіщення (Android 13+).
Для довгих поїздок вимкніть оптимізацію батареї для застосунку — деякі виробники (Xiaomi, Huawei, Samsung) агресивно
зупиняють фонові сервіси.

## Перевірки

```bash
npm run typecheck
npm run lint
npm test          # unit-тести доменної логіки, черги синхронізації, запису поїздки
npm run test:db   # міграції + тригери + RLS на локальному PostgreSQL (потрібен postgres у PATH або /usr/lib/postgresql)
npm run build
```

## Демо-дані

«Ще → Демо-дані» або кнопка на екрані першого авто: створює окреме демо-авто (Nissan Tiida 2008, 1.6, МКПП, 184 000 км)
з поїздками за 2 місяці, заправками, історією ТО та місцями. Усе позначено `is_demo` і видаляється однією кнопкою, не
зачіпаючи ваші дані.

## Пріоритети

Реалізовано P0 (auth, авто, пробіг, поїздки, GPS, ТО, дашборд, Supabase, RLS) і P1 (паливо, місця, історія поїздок,
прогноз, темна тема, офлайн-черга). P2 підготовлено інтерфейсами, але не реалізовано: in-app routing
(`NavigationService.getRoutes`), зовнішній трекер / OBD-II (`LocationProvider` + `vehicle_locations.source`),
діагностика, розширена аналітика. Кілька авто підтримуються схемою та перемикачем у «Ще».
