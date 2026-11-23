import type { Direction } from './types';
import type { ContractInfo } from './bitget';
import { SIGNALS_CONFIG } from './config';

export interface Sizing {
  riskUsd: number;
  qty: number;
  notionalUsd: number;
  leverage: number;
  marginUsd: number;
  liquidationPrice: number;
  warnings: string[];
}

export interface SizingInput {
  direction: Direction;
  entry: number;
  stop: number;
  depositUsd: number;
  riskPct: number;
  contract: ContractInfo;
}

function floorToPlace(x: number, places: number): number {
  const f = 10 ** places;
  // 1e-9 гасить float-артефакти типу 0.29999999 * 10
  return Number((Math.floor(x * f + 1e-9) / f).toFixed(places));
}

function roundToPlace(x: number, places: number): number {
  return Number(x.toFixed(places));
}

export function sizePosition(input: SizingInput): Sizing {
  const { direction, entry, stop, depositUsd, riskPct, contract } = input;
  const cfg = SIGNALS_CONFIG.sizing;
  const warnings: string[] = [];

  const riskUsd = roundToPlace((depositUsd * riskPct) / 100, 8);
  const qty = floorToPlace(riskUsd / Math.abs(entry - stop), contract.volumePlace);
  const notionalUsd = qty * entry;

  const marginCap = (depositUsd * cfg.maxMarginPct) / 100;
  const maxLev = Math.min(cfg.maxLeverage, contract.maxLeverage);
  const rawLev = Math.ceil(notionalUsd / marginCap - 1e-9);
  const leverage = Math.min(Math.max(rawLev, 1), maxLev);
  const marginUsd = notionalUsd / leverage;

  const liq =
    direction === 'long'
      ? entry * (1 - 1 / leverage + cfg.mmr)
      : entry * (1 + 1 / leverage - cfg.mmr);
  const liquidationPrice = roundToPlace(liq, contract.pricePlace);

  if (marginUsd > marginCap + 1e-9) {
    warnings.push(
      `маржа ${marginUsd.toFixed(2)}$ перевищує ${cfg.maxMarginPct}% депозиту (плече впирається в ліміт ${maxLev}x)`,
    );
  }
  const liqTooClose = direction === 'long' ? liquidationPrice >= stop : liquidationPrice <= stop;
  if (liqTooClose) {
    warnings.push('ліквідація не далі за стоп — стоп може не спрацювати до ліквідації');
  }
  if (qty < contract.minTradeNum) {
    warnings.push(`обсяг ${qty} менший за мінімальний ${contract.minTradeNum}`);
  }
  if (riskPct > cfg.highRiskWarnPct) {
    warnings.push(`ризик вище ${cfg.highRiskWarnPct}% на угоду`);
  }

  return { riskUsd, qty, notionalUsd, leverage, marginUsd, liquidationPrice, warnings };
}
