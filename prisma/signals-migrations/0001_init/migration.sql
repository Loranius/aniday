-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "entryLow" DOUBLE PRECISION NOT NULL,
    "entryHigh" DOUBLE PRECISION NOT NULL,
    "stop" DOUBLE PRECISION NOT NULL,
    "tp1" DOUBLE PRECISION NOT NULL,
    "tp2" DOUBLE PRECISION,
    "metrics" JSONB NOT NULL,
    "sizing" JSONB NOT NULL,
    "claudeReason" TEXT,
    "status" TEXT NOT NULL,
    "entryDeadline" TIMESTAMP(3) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "timeoutAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "fillPrice" DOUBLE PRECISION,
    "tp1Hit" BOOLEAN NOT NULL DEFAULT false,
    "closeReason" TEXT,
    "resultR" DOUBLE PRECISION,
    "lastCheckedTs" BIGINT NOT NULL,
    "telegramMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "depositUsd" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "riskScalp" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "riskIntraday" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "riskPump" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "paused" TEXT[],
    "scalpDailyLimit" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaudeSpend" (
    "day" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "calls" INTEGER NOT NULL,

    CONSTRAINT "ClaudeSpend_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "ts" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("ts")
);

-- CreateIndex
CREATE UNIQUE INDEX "Signal_dedupeKey_key" ON "Signal"("dedupeKey");

-- CreateIndex
CREATE INDEX "Signal_status_idx" ON "Signal"("status");

-- CreateIndex
CREATE INDEX "Signal_symbol_direction_status_idx" ON "Signal"("symbol", "direction", "status");

-- CreateIndex
CREATE INDEX "Signal_createdAt_idx" ON "Signal"("createdAt");

