# Crypto Signals Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Особистий Telegram-бот, що сканує USDT-M ф'ючерси Bitget у трьох режимах (скальп, інтрадей, 🚀), фільтрує кандидатів через Claude, надсилає сигнали з розміром позиції та веде облік результатів.

**Architecture:** Чиста доменна логіка в `lib/signals/` (індикатори, стратегії, розмір позиції, визначення результату, статистика — без I/O), тонкі адаптери (Bitget REST, Claude, Telegram Bot API, Prisma) і два оркестратори (`runScan`, `runTracking`) з інжектованими залежностями. Next.js API routes викликаються cron-job.org (скан) і Telegram (webhook). Окрема Prisma-схема й окрема безкоштовна БД **Supabase Postgres** (у Neon Free рахуються CU-години, а БД, яку смикають кожні 5 хв, не засинає й вичерпає ліміт; Supabase Free не тарифікує обчислення); деплой окремим Vercel-проєктом з того ж репо.

**Tech Stack:** TypeScript, Next.js 14 Pages Router, Prisma 5 (друга схема `prisma/signals.prisma`), `@anthropic-ai/sdk`, zod 3, vitest, Telegram Bot API через `fetch`, Bitget REST v2 через `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-23-crypto-signals-bot-design.md`

## Global Constraints

- Тільки публічні дані Bitget: `https://api.bitget.com/api/v2/mix/market/*`, `productType=USDT-FUTURES`. Жодних API-ключів Bitget, жодних ордерів.
- Існуючі файли AniDay (`lib/auth.ts`, `lib/prisma.ts`, `lib/telegram.ts`, `pages/api/{auth,episodes,profile,tg,watchlist}`, `prisma/schema.prisma`) не змінюються. Дозволені зміни: `package.json` (deps, scripts), `.gitignore`, `README.md` (новий розділ).
- Env бота: `SIGNALS_DATABASE_URL`, `SIGNALS_DIRECT_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `ANTHROPIC_API_KEY`. Код AniDay не повинен їх вимагати, і навпаки.
- Режими: `scalp` (1m/5m, вікно входу 15 хв, таймаут 4 год, ризик 1%, Haiku), `intraday` (15m/1h, вікно входу 2 год, таймаут 3 дні, ризик 2%, Sonnet), `pump` (15m/1h, вікно входу 2 год, таймаут 3 дні, ризик 1%, Sonnet).
- Моделі Claude: `claude-sonnet-5-5` ($2/$10 за 1M вх/вих), `claude-haiku-5-5` ($0.10/$0.50).
- Бюджет Claude: ≤ $20 за календарний місяць і ≤ $20/30 за добу (Europe/Kyiv). Після ліміту — сигнал без Claude з позначкою «⚠️ без перевірки Claude».
- Депозит за замовч. $500. Плече: найменше ціле, за якого маржа ≤ 20% депозиту, максимум 20x.
- Облік: TP1 закриває 50% і переносить стоп у беззбиток; стоп і тейк в одній свічці → стоп; R на всю позицію.
- Часовий пояс для відображення, добових лімітів і бюджету: `Europe/Kyiv`.
- Мова повідомлень бота й пояснень Claude: українська.
- Усі числові пороги стратегій — тільки в `lib/signals/config.ts`.
- Скальп-скан (щохвилини) **не звертається до БД**, якщо немає кандидатів; трекінг і снапшоти — лише в `swing` (кожні 5 хв).
- Кожна API-функція має `export const config = { maxDuration: 60 }`; робота одного виклику ціль < 50 с.

## Review Focus

1. **Перекриття запусків cron** (попередній скан ще триває, коли стартує наступний) — дублікатів сигналів бути не повинно. → Task 6: унікальний ключ `dedupeKey`; Task 9: тест «два runScan поспіль з тими самими даними → 1 сигнал».
2. **Bitget повертає помилку/429/порожні свічки для однієї монети** — скан інших монет має продовжитися, а не впасти. → Task 9: тест «market кидає для однієї монети → решта обробляються, помилка в результаті».
3. **Claude недоступний / таймаут / refusal / невалідний JSON** — кандидат не губиться, йде як «без Claude». → Task 7: тест на кожен із трьох випадків.
4. **Повідомлення від стороннього користувача або без секрету webhook** — бот мовчить. → Task 8: тести `handleUpdate` для чужого `from.id` і неправильного секрету.
5. **Пропуск трекінгу на кілька годин** (cron лежав) — результат має бути правильним після відновлення. → Task 5: тест на пакет свічок, що одночасно покриває вхід, TP1 і таймаут.

---

## File Structure

```
lib/signals/
  types.ts           — спільні типи (Candle, Ticker, Mode, Direction, Candidate, SignalRecord…)
  config.ts          — усі пороги, моделі, ціни, бюджет, ліміти, вікна
  indicators.ts      — ema, sma, rsi, macd, atr, bollingerWidth, vwap, highest, lowest
  strategies/intraday.ts | pump.ts | scalp.ts  — чисті функції: свічки → Candidate | null
  universe.ts        — топ-20, передфільтр 🚀 зі снапшотів, «гарячі» монети (топ-мувери)
  sizing.ts          — розмір позиції, плече, ліквідація
  outcome.ts         — покрокова машина станів сигналу по свічках
  stats.ts           — агрегування статистики
  budget.ts          — вартість виклику, добовий/місячний ліміт
  bitget.ts          — REST-клієнт (MarketData)
  claude.ts          — Reviewer (Claude)
  telegram.ts        — Bot API клієнт (Notifier) + форматування повідомлень
  commands.ts        — обробка команд власника
  db.ts              — PrismaClient для схеми бота
  repo.ts            — SignalsRepo на Prisma
  scan.ts            — runScan(mode, deps)
  track.ts           — runTracking(deps)
  env.ts             — читання/валідація env бота
pages/api/signals/scan.ts      — cron-ендпоінт
pages/api/signals/telegram.ts  — webhook
prisma/signals.prisma
scripts/signals-set-webhook.mjs
tests/signals/*.test.ts, tests/signals/fixtures/*.json
vitest.config.ts
```

---

### Task 1: Основа — тести, типи, конфіг, індикатори

**Files:**
- Modify: `package.json` (devDeps `vitest`; deps `@anthropic-ai/sdk`; script `"test": "vitest run"`)
- Create: `vitest.config.ts`, `lib/signals/types.ts`, `lib/signals/config.ts`, `lib/signals/indicators.ts`
- Test: `tests/signals/indicators.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type Mode = 'scalp' | 'intraday' | 'pump'`, `type Direction = 'long' | 'short'`
  - `interface Candle { ts: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume: number }` (ts — початок свічки, мс; масиви завжди за зростанням ts)
  - `interface Ticker { symbol: string; last: number; quoteVolume24h: number; change24h: number; fundingRate: number; openInterest: number }`
  - `interface Candidate { mode: Mode; symbol: string; direction: Direction; timeframe: string; candleTs: number; entryLow: number; entryHigh: number; stop: number; tp1: number; tp2: number | null; pattern: string; metrics: Record<string, number> }`
  - `type SignalGroup = 'confirmed' | 'shadow' | 'no_claude'`
  - `type SignalStatus = 'pending' | 'open' | 'not_filled' | 'closed'`
  - `type CloseReason = 'tp2' | 'tp' | 'stop' | 'breakeven' | 'timeout'`
- Produces (`config.ts`): `SIGNALS_CONFIG` з полями `modes[mode] = { entryWindowMin, timeoutMin, defaultRiskPct, model, tpR: number[] }` (scalp: 15, 240, 1, `claude-haiku-5-5`, `[1.2]`; intraday: 120, 4320, 2, `claude-sonnet-5-5`, `[1.5, 3]`; pump: 120, 4320, 1, `claude-sonnet-5-5`, `[1.5, 3]`), `pricing` (як у Global Constraints), `budget = { monthlyUsd: 20, dailyUsd: 20/30 }`, `sizing = { defaultDepositUsd: 500, maxMarginPct: 20, maxLeverage: 20, mmr: 0.005 }`, `universe = { topN: 20, pumpMinQuoteVolume24h: 5_000_000, pumpMaxCandidates: 15 }`, `scalpDailyLimit: 10`, `maxReviewsPerRun: 5`, `tz: 'Europe/Kyiv'`, плюс об'єкти порогів стратегій (заповнюються в Task 3).
- Produces (`indicators.ts`), усі повертають масив тієї ж довжини, що вхід, з `NaN` до прогріву:
  `ema(values: number[], period: number): number[]`, `sma(...)`, `rsi(closes, period=14)`, `macd(closes, 12, 26, 9): { macd: number[]; signal: number[]; hist: number[] }`, `atr(candles: Candle[], period=14)` (Wilder), `bollingerWidth(closes, period=20, k=2)` ((upper−lower)/middle), `vwap(candles)` (кумулятивний від першої свічки, typical price), `highest(values, lookback): number[]`, `lowest(...)` (по попередніх `lookback` елементах, без поточного).

- [ ] **Step 1: Встановити** `npm i @anthropic-ai/sdk && npm i -D vitest`; додати `vitest.config.ts` (`test.include: ['tests/**/*.test.ts']`, environment `node`).
- [ ] **Step 2: Написати падаючі тести** `tests/signals/indicators.test.ts`:
  - `sma([1,2,3,4,5],3)` → `[NaN,NaN,2,3,4]`
  - `ema([1,2,3,4,5],3)[4]` ≈ `4` (seed = SMA перших 3, k=0.5) → `[NaN,NaN,2,3,4]`
  - `rsi` 15 монотонно зростаючих close → останнє значення `100`
  - `atr` для 15 свічок з `high-low = 2`, без гепів → останнє `2`
  - `bollingerWidth` для сталих значень → `0`
  - `vwap` двох свічок (tp=10, vol=1; tp=20, vol=3) → `[10, 17.5]`
  - `highest([1,5,3,2],2)` → `[NaN,NaN,5,5]`
- [ ] **Step 3:** `npx vitest run tests/signals/indicators.test.ts` → FAIL (модуль не знайдено).
- [ ] **Step 4:** Реалізувати `types.ts`, `config.ts`, `indicators.ts` за сигнатурами вище.
- [ ] **Step 5:** `npx vitest run tests/signals/indicators.test.ts` → PASS; `npx tsc --noEmit` → без помилок.
- [ ] **Step 6: Commit** `feat(signals): indicators, types, config, vitest`.

---

### Task 2: Bitget-клієнт і вибір монет

**Files:**
- Create: `lib/signals/bitget.ts`, `lib/signals/universe.ts`
- Test: `tests/signals/bitget.test.ts`, `tests/signals/universe.test.ts`, `tests/signals/fixtures/tickers.json`, `tests/signals/fixtures/candles-btc-15m.json`

**Interfaces:**
- Consumes: `Candle`, `Ticker`, `SIGNALS_CONFIG.universe`.
- Produces (`bitget.ts`):
  - `interface MarketData { tickers(): Promise<Ticker[]>; candles(symbol: string, granularity: '1m'|'5m'|'15m'|'1H', limit: number, startTime?: number): Promise<Candle[]>; contract(symbol: string): Promise<ContractInfo> }`
  - `interface ContractInfo { symbol: string; pricePlace: number; volumePlace: number; minTradeNum: number; maxLeverage: number }`
  - `createBitget(fetchImpl: typeof fetch = fetch): MarketData`
  - Ендпоінти: `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` (поля `symbol, lastPr, usdtVolume, change24h, fundingRate, holdingAmount` → `Ticker`; `openInterest = holdingAmount * lastPr`), `GET /api/v2/mix/market/candles?symbol&productType&granularity&limit[&startTime]` (рядок `[ts, open, high, low, close, baseVol, quoteVol]` — рядки → числа; **відсортувати за ts; викинути незакриту останню свічку**, тобто `ts + tfMs > now`), `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES` (кеш у пам'яті модуля на 1 год; поля `symbol, pricePlace, volumePlace, minTradeNum, maxLever`).
  - Не-`"00000"` `code` у відповіді або HTTP ≠ 200 → `throw new BitgetError(code, msg)`; таймаут запиту 8 с; не більше 10 паралельних запитів (простий семафор у модулі).
  - Формат відповіді перед реалізацією звірити з офіційною документацією Bitget v2 (Context7 або bitget.com/api-doc); якщо розходиться з описаним — довіряти документації й оновити фікстури.
- Produces (`universe.ts`):
  - `topByVolume(tickers: Ticker[], n: number): string[]`
  - `interface Snapshot { ts: number; bySymbol: Record<string, { quoteVolume24h: number; openInterest: number }> }`
  - `pumpPrefilter(tickers: Ticker[], top: Set<string>, snapshots: Snapshot[], now: number): PumpPre[]` де `PumpPre = { symbol: string; volBurstPct: number; oiChangePct: number }`. Правило: монета поза `top`, `quoteVolume24h ≥ pumpMinQuoteVolume24h`; знайти снапшот, найближчий до `now − 15 хв` (допуск ±5 хв) → `volBurstPct = (vol24h_now − vol24h_then)/vol24h_now·100`; снапшот `now − 30 хв` → `oiChangePct`. Кандидат, якщо `volBurstPct ≥ 3` **або** `oiChangePct ≥ 5`; сортувати за `volBurstPct` спадно; обрізати до `pumpMaxCandidates`. Без потрібних снапшотів → `[]`.
  - `makeSnapshot(tickers: Ticker[], now: number): Snapshot`
  - `hotMovers(tickers: Ticker[], top: Set<string>, n = 10): string[]` — монети поза `top` з `quoteVolume24h ≥ pumpMinQuoteVolume24h`, відсортовані за `|change24h|` спадно, перші `n` (без звернення до БД; «гарячі» монети для скальпу).

- [ ] **Step 1: Тести** `bitget.test.ts` з фейковим `fetchImpl`: тікери з фікстури мапляться в `Ticker` (перевірити `openInterest = holdingAmount*lastPr`); свічки у зворотному порядку повертаються за зростанням, незакрита остання відкинута; `code: "40034"` → `BitgetError`. `universe.test.ts`: `topByVolume` повертає 20 символів за спаданням обсягу; `pumpPrefilter` із двома снапшотами (−15 хв, −30 хв) дає кандидата з `volBurstPct=4` і відкидає монету з топ-20 та з обсягом $1M; без снапшотів → `[]`; `hotMovers` повертає монети з найбільшим `|change24h|` поза топ-20.
- [ ] **Step 2:** `npx vitest run tests/signals/bitget.test.ts tests/signals/universe.test.ts` → FAIL.
- [ ] **Step 3:** Реалізувати.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(signals): bitget market data client and universe selection`.

---

### Task 3: Стратегії (чисті функції)

**Files:**
- Create: `lib/signals/strategies/intraday.ts`, `pump.ts`, `scalp.ts`; доповнити `config.ts` порогами
- Test: `tests/signals/strategies.test.ts` (свічки генеруються хелпером `makeCandles(pattern)` у тесті, без фікстур)

**Interfaces:**
- Consumes: індикатори з Task 1, `Candidate`.
- Produces:
  - `detectIntraday(symbol: string, c15: Candle[], c1h: Candle[]): Candidate | null`
  - `detectPump(symbol: string, c15: Candle[], ticker: Ticker, pre: PumpPre): Candidate | null`
  - `detectScalp(symbol: string, c5: Candle[], c1: Candle[]): Candidate | null`
  - Усі дивляться лише на останню закриту свічку (`candleTs` = її `ts`), повертають `null`, якщо даних менше, ніж потрібно для прогріву (EMA200 на 1h → ≥ 210 свічок 1h).

Правила (стартові значення — у `config.ts`; ATR(14) того ж таймфрейму):
- **Інтрадей.** Тренд 1h: long якщо `close > EMA200` і `EMA50 > EMA200`; short — дзеркально; інакше `null`. Тригер 15m (будь-який):
  (а) *відкат*: `low ≤ EMA50_15 + 0.25·ATR`, `close > EMA50_15`, `close > open` (long);
  (б) *пробій*: `close > highest(high, 20)` і `volume ≥ 1.5 × SMA20(volume)`.
  Фільтр: long — `RSI14 < 70` і `hist > hist_prev`; short — `RSI14 > 30` і `hist < hist_prev`.
  Вхід: long `[close − 0.25·ATR, close]`. `entry = (entryLow+entryHigh)/2`. Стоп: далі з (`lowest(low,10) − 0.1·ATR`, `entry − 1.0·ATR`); якщо `entry − stop > 3·ATR` → `null`. `tp1 = entry + 1.5R`, `tp2 = entry + 3R`. Short — дзеркально.
- **🚀.** Обов'язково: `volume ≥ 5 × SMA20(volume)` останньої 15m-свічки. Плюс хоча б одне з: стиснення (мінімум `bollingerWidth` за 6 свічок перед останньою ≤ 20-го перцентиля ширини за останні 100), `pre.oiChangePct ≥ 5`. Напрям — за кольором свічки-сплеску. Funding: long відхилити, якщо `fundingRate > 0.0005`; short — якщо `< −0.0005`. Вхід long `[close − 0.3·ATR, close]`; стоп `low_spike − 0.1·ATR`, відхилити якщо `> 4·ATR`; тейки 1.5R/3R. `metrics` включає `volMult`, `oiChangePct`, `fundingRate`, `bbWidthPct`.
- **Скальп** (5m тригер, 1m уточнення). Будь-яке з:
  (а) *пробій*: `close > highest(high,12)` (5m), `volume ≥ 3 × SMA20(volume)`, close у верхніх 25% діапазону свічки;
  (б) *VWAP*: по 1m (VWAP останніх 60 свічок) — попередня 1m свічка закрилась нижче VWAP, остання — вище, і `close > open`;
  (в) *відскок від рівня*: `low` останньої 5m ≤ `lowest(low,48)` + 0.1·ATR і нижня тінь ≥ 60% діапазону свічки.
  Short — дзеркально. Вхід long `[close − 0.15·ATR5, close]`; стоп `low − 0.1·ATR5`; `tp1 = entry + 1.2R`, `tp2 = null`.

- [ ] **Step 1: Тести:** для кожної стратегії — один синтетичний ряд, що дає long-кандидата (перевірити напрям, `entryLow < entryHigh`, `stop < entryLow`, `tp1 − entry ≈ 1.5·(entry − stop)` (скальп 1.2), `tp2` ≈ 3R / `null`), дзеркальний для short, і «пласкі» свічки → `null`; інтрадей з контртрендовим тригером → `null`; 🚀 з `fundingRate = 0.001` для long → `null`; недостатньо свічок → `null`.
- [ ] **Step 2:** `npx vitest run tests/signals/strategies.test.ts` → FAIL.
- [ ] **Step 3:** Реалізувати.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(signals): intraday, pump and scalp detectors`.

---

### Task 4: Розмір позиції, плече, ліквідація

**Files:**
- Create: `lib/signals/sizing.ts`
- Test: `tests/signals/sizing.test.ts`

**Interfaces:**
- Produces: `sizePosition(input: { direction: Direction; entry: number; stop: number; depositUsd: number; riskPct: number; contract: ContractInfo }): Sizing`
  `interface Sizing { riskUsd: number; qty: number; notionalUsd: number; leverage: number; marginUsd: number; liquidationPrice: number; warnings: string[] }`
  - `qty = floor_to_volumePlace(riskUsd / |entry − stop|)`; `leverage = clamp(ceil(notional / (depositUsd·maxMarginPct/100)), 1, min(maxLeverage, contract.maxLeverage))`; `margin = notional / leverage`.
  - Ліквідація (isolated, наближено): long `entry·(1 − 1/lev + mmr)`, short `entry·(1 + 1/lev − mmr)`, округлено до `pricePlace`.
  - Попередження (українською): маржа > 20% (плече впиралось у ліміт); ліквідація не далі за стоп (long `liq ≥ stop`, short `liq ≤ stop`); `qty < minTradeNum`; `riskPct > 5` («ризик вище 5% на угоду»).

- [ ] **Step 1: Тести:** SOL long entry 142.55, stop 140.90, deposit 500, risk 2%, volumePlace 1 → `riskUsd 10`, `qty 6.0`, `notional ≈ 855.3`, `leverage 9`, `margin ≈ 95.03`, `liquidation < 140.90`, `warnings = []`; дуже вузький стоп (0.05%) → `leverage 20` і попередження про маржу; short дзеркально; `riskPct 10` → попередження про ризик.
- [ ] **Step 2:** FAIL → **Step 3:** реалізувати → **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(signals): position sizing, leverage and liquidation`.

---

### Task 5: Визначення результату і статистика

**Files:**
- Create: `lib/signals/outcome.ts`, `lib/signals/stats.ts`
- Test: `tests/signals/outcome.test.ts`, `tests/signals/stats.test.ts`

**Interfaces:**
- Produces (`outcome.ts`):
  - `interface TrackState { status: SignalStatus; direction: Direction; entryLow: number; entryHigh: number; stop: number; tp1: number; tp2: number | null; createdAt: number; entryDeadline: number; filledAt: number | null; fillPrice: number | null; tp1Hit: boolean; timeoutAt: number | null; closedAt: number | null; closeReason: CloseReason | null; resultR: number | null; lastCheckedTs: number }`
  - `advance(state: TrackState, candles: Candle[], mode: Mode, now: number): TrackState` — обробляє лише свічки з `ts > lastCheckedTs`, по черзі; повертає новий стан (чиста функція).
  - Правила:
    - `pending`: якщо свічка торкнулась зони (long: `low ≤ entryHigh`; short: `high ≥ entryLow`) до `entryDeadline` → `open`, `fillPrice = (entryLow+entryHigh)/2`, `filledAt = ts`, `timeoutAt = ts + timeoutMin`. На свічці входу перевіряється **лише стоп**. Якщо `now > entryDeadline` без торкання → `not_filled`.
    - `open` (`risk = |fillPrice − stop|`): стоп і тейк в одній свічці → стоп. Стоп до TP1 → `closed/stop`, `−1R`. TP1 (є `tp2`) → `tp1Hit`, стоп := `fillPrice`, зафіксувати `0.5·(tp1−fill)/risk`. Після TP1: стоп → `closed/breakeven` (результат = зафіксована частина); TP2 → `closed/tp2`, `+0.5·(tp2−fill)/risk`. Без `tp2` (скальп): TP1 → `closed/tp`, `(tp1−fill)/risk`. Таймаут: перша свічка з `ts ≥ timeoutAt` → `closed/timeout` за `close` цієї свічки (залишок позиції).
  - `initialState(c: Candidate, mode: Mode, createdAt: number): TrackState`.
- Produces (`stats.ts`):
  - `interface StatRow { mode: Mode; group: SignalGroup; status: SignalStatus; resultR: number | null; createdAt: number }`
  - `computeStats(rows: StatRow[], sinceMs: number | null): StatsReport` — по `mode × group`: `total`, `notFilled`, `closed`, `wins` (`resultR > 0`), `winRate`, `avgR`, `sumR`; плюс підсумок по групах.

- [ ] **Step 1: Тести** `outcome.test.ts` (long entry 99–101, fill 100, stop 98, tp1 103, tp2 106):
  - зона не торкнута до дедлайну → `not_filled`;
  - вхід, потім стоп → `−1`;
  - вхід, TP1, потім повернення до 100 → `breakeven`, `+0.75`;
  - вхід, TP1, TP2 → `tp2`, `+2.25`;
  - одна свічка зачіпає і 98, і 103 → `stop`, `−1`;
  - вхід, далі 3 дні без руху → `timeout` за close;
  - скальп без `tp2`, tp1 = 102.4 → `tp`, `+1.2`;
  - **(Review Focus 5)** один виклик `advance` з пакетом свічок, що містить вхід, TP1 і таймаут → `closed/timeout`, `resultR = 0.75 + 0.5·(close−100)/2`;
  - повторний виклик з тими самими свічками не змінює стан (`lastCheckedTs`);
  - short-дзеркало для «вхід → стоп».
  `stats.test.ts`: 3 закриті (+2.25, −1, +0.75) і 1 `not_filled` → `winRate 2/3`, `sumR 2.0`, `avgR ≈ 0.667`, `notFilled 1`; фільтр `sinceMs` відкидає старі.
- [ ] **Step 2:** FAIL → **Step 3:** реалізувати → **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(signals): outcome tracking state machine and stats`.

---

### Task 6: База даних бота

**Files:**
- Create: `prisma/signals.prisma`, `lib/signals/db.ts`, `lib/signals/repo.ts`, `lib/signals/env.ts`
- Modify: `package.json` (`build`: `prisma generate && prisma generate --schema prisma/signals.prisma && next build`; `postinstall` те саме без `next build`; `signals:migrate`: `prisma migrate dev --schema prisma/signals.prisma`), `.gitignore` (`lib/signals/generated/`)

**Interfaces:**
- `signals.prisma`: `datasource db { provider = "postgresql", url = env("SIGNALS_DATABASE_URL"), directUrl = env("SIGNALS_DIRECT_URL") }`, `generator client { provider = "prisma-client-js", output = "../lib/signals/generated" }`. Моделі:
  - `Signal` — `id cuid`, `dedupeKey String @unique` (`${mode}:${symbol}:${direction}:${candleTs}`), `mode`, `group`, `symbol`, `direction`, `timeframe`, `pattern`, `entryLow/entryHigh/stop/tp1 Float`, `tp2 Float?`, `metrics Json`, `sizing Json`, `claudeReason String?`, `status`, `entryDeadline DateTime`, `filledAt/timeoutAt/closedAt DateTime?`, `fillPrice Float?`, `tp1Hit Boolean`, `closeReason String?`, `resultR Float?`, `lastCheckedTs BigInt`, `telegramMessageId Int?`, `createdAt`. Індекси: `[status]`, `[symbol, direction, status]`, `[createdAt]`.
  - `Settings` — `id Int @id @default(1)`, `depositUsd Float @default(500)`, `riskScalp Float @default(1)`, `riskIntraday Float @default(2)`, `riskPump Float @default(1)`, `paused String[]`, `scalpDailyLimit Int @default(10)`.
  - `ClaudeSpend` — `day String @id` (`YYYY-MM-DD` у Kyiv), `costUsd Float`, `calls Int`.
  - `MarketSnapshot` — `ts DateTime @id`, `data Json`; зберігати останні 2 год, старші видаляти при записі.
- Produces (`repo.ts`), `interface SignalsRepo`:
  `getSettings(): Promise<SettingsT>`, `updateSettings(p: Partial<SettingsT>): Promise<SettingsT>`,
  `insertSignal(s: NewSignal): Promise<{ id: string } | null>` (`null` при порушенні `dedupeKey` — P2002),
  `hasActive(symbol: string, direction: Direction): Promise<boolean>` (`group ≠ 'shadow'`, `status ∈ {pending, open}`),
  `countSentToday(mode: Mode, dayStartMs: number): Promise<number>` (`group ≠ 'shadow'`),
  `listActive(): Promise<SignalRow[]>`, `saveTrackState(id: string, st: TrackState): Promise<void>`, `setMessageId(id, msgId)`,
  `statRows(sinceMs: number | null): Promise<StatRow[]>`,
  `addSpend(day: string, costUsd: number): Promise<void>`, `spendSince(dayFrom: string): Promise<number>`,
  `saveSnapshot(s: Snapshot): Promise<void>`, `recentSnapshots(sinceMs: number): Promise<Snapshot[]>`.
- `db.ts`: синглтон як `lib/prisma.ts`, але з `./generated`. `env.ts`: `signalsEnv()` — zod-валідація всіх env бота, кидає зрозумілу помилку з переліком відсутніх.

- [ ] **Step 1:** Написати схему; `npx prisma validate --schema prisma/signals.prisma` → valid; `npx prisma generate --schema prisma/signals.prisma` → клієнт у `lib/signals/generated`.
- [ ] **Step 2:** `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/signals.prisma --script > prisma/signals-migrations/0001_init/migration.sql` (тека міграцій бота окремо; у README описати `prisma migrate deploy --schema prisma/signals.prisma`).
- [ ] **Step 3:** Реалізувати `db.ts`, `repo.ts`, `env.ts`. Тест `tests/signals/env.test.ts`: відсутній `TELEGRAM_OWNER_ID` → помилка з його назвою.
- [ ] **Step 4:** `npx tsc --noEmit` і `npm test` → PASS; `npm run build` проходить **без** env бота (AniDay не зламано).
- [ ] **Step 5: Commit** `feat(signals): separate prisma schema and repository`.

---

### Task 7: Рецензент Claude і бюджет

**Files:**
- Create: `lib/signals/budget.ts`, `lib/signals/claude.ts`
- Test: `tests/signals/budget.test.ts`, `tests/signals/claude.test.ts`

**Interfaces:**
- Produces (`budget.ts`): `callCostUsd(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number`; `kyivDay(ms: number): string`; `canSpend(spentToday: number, spentMonth: number): boolean` (обидва ліміти з конфігу, з запасом на один виклик: оцінка $0.02 Sonnet / $0.002 Haiku).
- Produces (`claude.ts`):
  - `type Review = { decision: 'confirm' | 'reject'; reason: string; stop?: number; tp1?: number } | { decision: 'unavailable'; error: string }`
  - `interface Reviewer { review(c: Candidate, ctx: { candles: Candle[]; ticker?: Ticker }): Promise<{ review: Review; costUsd: number }> }`
  - `createClaudeReviewer(client: Anthropic): Reviewer` — `client.messages.parse` з `output_config: { effort: 'low', format: zodOutputFormat(ReviewSchema) }` (якщо `zodOutputFormat` несумісний з zod 3 — `output_config.format: { type: 'json_schema', schema }` і розбір через zod), модель з `SIGNALS_CONFIG.modes[c.mode].model`, `max_tokens: 2000`, таймаут 20 с (Haiku) / 40 с (Sonnet), `maxRetries: 1`. Для `claude-sonnet-5-5` — серверний fallback при відмові (beta `server-side-fallback-2026-07-01`, `fallbacks: 'default'`) за прикладом зі скіла claude-api; якщо в `parse` це недоступно — пропустити й обробити `stop_reason: 'refusal'` як `unavailable`.
  - Системний промпт (стабільний, кешований): роль — досвідчений ф'ючерсний трейдер-ризик-менеджер; оцінити один сетап; відхиляти при суперечливих даних, низькій ліквідності, вході «в кінці руху»; `reason` — 1–2 речення українською до 200 символів; коригувати стоп/тейк лише якщо це суттєво покращує сетап. Користувацьке повідомлення: компактний JSON (кандидат, `metrics`, останні 40 свічок робочого таймфрейму як `[ts,o,h,l,c,v]`).
  - Скориговані `stop`/`tp1` приймаються лише якщо стоп по правильний бік зони і відстань ≤ ліміту стратегії; інакше ігноруються.
  - Будь-яка помилка SDK, таймаут, `refusal`, `parsed_output === null` → `{ decision: 'unavailable' }`, `costUsd` за фактичним `usage`, якщо він є, інакше 0.

- [ ] **Step 1: Тести** з фейковим `client` (`{ messages: { parse: vi.fn() } }`): confirm з `usage` 3000/150 на Sonnet → `costUsd = 0.0075`; reject проходить як є; **(Review Focus 3)** `parse` кидає `APIConnectionError`/таймаут → `unavailable`; `stop_reason: 'refusal'` → `unavailable`; `parsed_output: null` → `unavailable`; стоп по неправильний бік → ігнорується. `budget.test.ts`: Haiku 3000/150 → `0.000375`; `canSpend(0.66, 5)` → `false`, `canSpend(0.1, 19.99)` → `false`, `canSpend(0.1, 5)` → `true`; `kyivDay` для `2026-11-23T22:30Z` → `2026-11-24`.
- [ ] **Step 2:** FAIL → **Step 3:** реалізувати → **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(signals): claude reviewer with budget tracking`.

---

### Task 8: Telegram — повідомлення і команди

**Files:**
- Create: `lib/signals/telegram.ts`, `lib/signals/commands.ts`, `pages/api/signals/telegram.ts`, `scripts/signals-set-webhook.mjs`
- Test: `tests/signals/telegram.test.ts`, `tests/signals/commands.test.ts`

**Interfaces:**
- Produces (`telegram.ts`):
  - `interface Notifier { send(text: string, replyTo?: number): Promise<number | null> }` (повертає `message_id`; помилки логуються, не кидаються)
  - `createTelegram(token: string, chatId: string, fetchImpl = fetch): Notifier` — `POST https://api.telegram.org/bot<token>/sendMessage`, `parse_mode: 'HTML'`, `disable_web_page_preview: true`.
  - `formatSignal(c: Candidate, sizing: Sizing, group: SignalGroup, claudeReason: string | null, entryDeadline: number): string` — за прикладом зі специфікації §5.5: емодзі 🟢/🔴, `LONG/SHORT`, символ, режим (`скальп`/`інтрадей`/`🚀 висока волатильність`), вхід, стоп з %, тейки з R, рядок позиції (`qty`, `≈ $notional`, `плече Nx`, `маржа $`), ризик ($ і %), ліквідація з ✅ або ⚠️, рядок `Claude: …` або `⚠️ без перевірки Claude`, попередження з `sizing.warnings`, `Вхід дійсний до: DD.MM HH:mm` (Kyiv). Ціни — з точністю `pricePlace`.
  - `formatClose(row: SignalRow): string` — один рядок: `✅/❌/➖ SOLUSDT LONG: TP2 +2.25R` / `стоп −1R` / `беззбиток +0.75R` / `таймаут +0.4R` / `⌛ не спрацював`; надсилається як відповідь (`replyTo`) на повідомлення сигналу.
  - `formatStats(r: StatsReport, spendMonthUsd: number): string`.
- Produces (`commands.ts`):
  - `handleUpdate(update: unknown, deps: { repo: SignalsRepo; notifier: Notifier; ownerId: string; now: () => number }): Promise<void>` — ігнорує все, крім `message.text` від `from.id === ownerId`.
  - Команди: `/start`, `/help` (список); `/stats [7d|30d|all]` (за замовч. 30d); `/open` (активні надіслані); `/risk <scalp|intraday|pump|all> <pct>` (0.1–50, >5 — з попередженням); `/deposit <usd>` (> 0); `/pause [mode|all]`, `/resume [mode|all]`; `/limit <n>` (денний ліміт скальпу, 0–100). Невідома/невалідна команда → коротка підказка.
- `pages/api/signals/telegram.ts`: лише `POST`; заголовок `x-telegram-bot-api-secret-token` має дорівнювати `TELEGRAM_WEBHOOK_SECRET`, інакше `401` без обробки; завжди відповідає `200 {ok:true}` після обробки (помилки логуються), щоб Telegram не повторював.
- `scripts/signals-set-webhook.mjs`: читає `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, URL з аргументу; викликає `setWebhook` з `secret_token` і `allowed_updates: ["message"]`; друкує відповідь.

- [ ] **Step 1: Тести:** `formatSignal` для long-кандидата містить `🟢 LONG SOLUSDT`, `плече 9x`, `Claude:`; для `no_claude` — `⚠️ без перевірки Claude`; HTML-спецсимволи в `claudeReason` екрановані. `formatClose` для `breakeven` → `+0.75R`. `commands.test.ts` (фейкові repo/notifier): **(Review Focus 4)** повідомлення від чужого id → `notifier.send` не викликано, repo не змінено; `/risk intraday 3` → `updateSettings({ riskIntraday: 3 })`; `/risk all 10` → оновлює всі три і відповідь містить попередження; `/risk foo` → підказка; `/pause scalp` → `paused` містить `scalp`. Тест хендлера route: неправильний секрет → 401, `handleUpdate` не викликано.
- [ ] **Step 2:** FAIL → **Step 3:** реалізувати → **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(signals): telegram notifier, formatting and owner commands`.

---

### Task 9: Оркестратори скану й трекінгу, cron-ендпоінт

**Files:**
- Create: `lib/signals/scan.ts`, `lib/signals/track.ts`, `pages/api/signals/scan.ts`
- Test: `tests/signals/scan.test.ts`, `tests/signals/track.test.ts`

**Interfaces:**
- Consumes: усе вище.
- Produces:
  - `interface Deps { market: MarketData; repo: SignalsRepo; reviewer: Reviewer; notifier: Notifier; now: () => number }`
  - `runScan(job: 'scalp' | 'swing', deps: Deps): Promise<ScanReport>` де `ScanReport = { mode: Mode; candidates: number; sent: number; shadow: number; skipped: number; errors: string[] }[]`.
    - `swing` = `intraday` + `pump` в одному виклику (один запит тікерів, збереження снапшоту); `scalp` = скальп по `topByVolume(…,20) ∪ hotMovers(…)`.
    - Режими з `settings.paused` пропускаються. Для `scalp` налаштування читаються **лише якщо знайдено хоч одного кандидата** (без кандидатів — нуль звернень до БД).
    - Свічки: інтрадей — `15m×120` і `1H×220`; 🚀 — `15m×120` для монет з `pumpPrefilter`; скальп — `5m×100` і `1m×60`.
    - Порядок для кожного кандидата: `hasActive(symbol, direction)` → пропустити; скальп — `countSentToday ≥ scalpDailyLimit` → пропустити; далі (не більше `maxReviewsPerRun` рецензій, паралельно) — якщо `canSpend` → `reviewer.review`, `repo.addSpend`; група: `confirm` → `confirmed`, `reject` → `shadow`, `unavailable` або бюджет вичерпано → `no_claude`. Скориговані стоп/тейк від Claude перераховують `tp2` для збереження R-структури. `sizePosition` з налаштувань. `insertSignal` (`null` → дублікат, пропустити). Для `confirmed`/`no_claude` → `notifier.send(formatSignal)` → `setMessageId`.
    - Помилка по одній монеті (Bitget/стратегія) додається в `errors` і не зупиняє інші.
  - `runTracking(deps: Deps): Promise<{ checked: number; closed: number; errors: string[] }>` — `listActive()` (усі групи), групування за символом, `market.candles(symbol,'1m',1000, minLastCheckedTs+1)`; якщо від `lastCheckedTs` пройшло > 16 год — `5m` замість `1m`; `advance` → `saveTrackState`; переходи в `closed`/`not_filled` для не-`shadow` → `notifier.send(formatClose, telegramMessageId)`.
- `pages/api/signals/scan.ts`: `GET`/`POST`, `Authorization: Bearer ${CRON_SECRET}` інакше 401; `?job=scalp|swing`; `scalp` виконує `runScan('scalp')`; `swing` — `runScan('swing')`, потім `runTracking` (історичні 1m-свічки, тож 5-хвилинний інтервал не впливає на точність). Відповідь — JSON зі звітами. `export const config = { maxDuration: 60 }`.

- [ ] **Step 1: Тести** з in-memory `FakeRepo` (реалізує `SignalsRepo` на масивах; `insertSignal` повертає `null` на повторний `dedupeKey`), фейковим `market` (фікстурні свічки, що дають інтрадей-кандидата для `SOLUSDT`), фейковими `reviewer`/`notifier`:
  - confirm → 1 сигнал `confirmed`, 1 повідомлення, `messageId` збережено;
  - reject → 1 `shadow`, 0 повідомлень, а наступний confirm по тій самій монеті й напряму на новій свічці **не** блокується;
  - бюджет вичерпано (`spendSince` повертає 20) → `no_claude`, reviewer не викликано;
  - **(Review Focus 1)** два `runScan('swing')` поспіль з тими самими даними → 1 сигнал, 1 повідомлення;
  - **(Review Focus 2)** `market.candles` кидає для `BTCUSDT` → `SOLUSDT` все одно оброблено, `errors.length === 1`;
  - `paused: ['intraday']` → інтрадей пропущено;
  - скальп-ліміт досягнуто → скальп-кандидат пропущено;
  - `runScan('scalp')` без кандидатів → жодного виклику методів `repo`.
  `track.test.ts`: відкритий сигнал + свічки до TP2 → стан `closed`, надіслано `formatClose` з `replyTo`; `shadow` закривається без повідомлення.
- [ ] **Step 2:** FAIL → **Step 3:** реалізувати → **Step 4:** PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(signals): scan and tracking orchestrators with cron endpoint`.

---

### Task 10: Документація, перевірка збірки, фінал

**Files:**
- Modify: `README.md` (новий розділ «Бот крипто-сигналів»), `docs/superpowers/specs/2026-11-23-crypto-signals-bot-design.md` (виправити приклад §5.5: при стопі 1.1% і ризику $10 позиція ≈ $855, плече 9x, маржа ≈ $95)

- [ ] **Step 1: README:** покроково — бот у @BotFather (токен), свій Telegram ID (через @userinfobot), нова база Supabase (Project → Connect → ORM/Prisma: pooled URL з `?pgbouncer=true` у `SIGNALS_DATABASE_URL`, direct URL у `SIGNALS_DIRECT_URL`), новий Vercel-проєкт з цього репо (env зі списку Global Constraints; Build Command за замовч. `npm run build`), `npx prisma migrate deploy --schema prisma/signals.prisma`, `node scripts/signals-set-webhook.mjs https://<project>.vercel.app/api/signals/telegram`, два завдання на cron-job.org (`/api/signals/scan?job=scalp` щохвилини, `?job=swing` кожні 5 хв, заголовок `Authorization: Bearer <CRON_SECRET>`, таймаут 60 с), команди бота, застереження «не фінансова порада; стратегія перевіряється статистикою».
- [ ] **Step 2:** `npm test` → усі PASS; `npx tsc --noEmit` → 0 помилок; `npm run build` без env бота → успіх.
- [ ] **Step 3: Commit** `docs(signals): setup guide and spec example fix`; `git push`.

---

## Після реалізації (власник)
Жива перевірка, яку не можна зробити в цьому середовищі: перший запит до Bitget, `/stats` у Telegram, надходження сигналу. Зробити `GET /api/signals/scan?job=swing` вручну після деплою і перевірити JSON-звіт.
