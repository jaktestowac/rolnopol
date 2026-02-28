const MS_IN_HOUR = 60 * 60 * 1000;
const TWO_PI = Math.PI * 2;
const PRICE_SEED = "ROLNOPOL_COMMODITIES_V1";

const COMMODITY_CONFIG = {
  GOLD: {
    basePrice: 320,
    mediumAmplitude: 0.025,
    longAmplitude: 0.045,
    noiseAmplitude: 0.003,
    floorPrice: 190,
  },
  SILVER: {
    basePrice: 35,
    mediumAmplitude: 0.045,
    longAmplitude: 0.08,
    noiseAmplitude: 0.006,
    floorPrice: 14,
  },
  PLATINUM: {
    basePrice: 180,
    mediumAmplitude: 0.055,
    longAmplitude: 0.095,
    noiseAmplitude: 0.007,
    floorPrice: 80,
  },
  PALLADIUM: {
    basePrice: 210,
    mediumAmplitude: 0.065,
    longAmplitude: 0.11,
    noiseAmplitude: 0.008,
    floorPrice: 95,
  },
  ETHERIUM: {
    basePrice: 2000,
    mediumAmplitude: 0.1,
    longAmplitude: 0.15,
    noiseAmplitude: 0.02,
    floorPrice: 500,
  },
  MARKER_FRAGMENT: {
    basePrice: 2400,
    mediumAmplitude: 0.22,
    longAmplitude: 0.42,
    noiseAmplitude: 0.04,
    floorPrice: 1000,
  },
  ISHIMURA_ALLOY: {
    basePrice: 770,
    mediumAmplitude: 0.1,
    longAmplitude: 0.19,
    noiseAmplitude: 0.014,
    floorPrice: 360,
  },
};

const MEDIUM_CYCLE_HOURS = 14 * 24; // 14 days
const LONG_CYCLE_HOURS = 120 * 24; // 120 days
const TREND_CYCLE_HOURS = 95 * 24; // ~quarter
const MOMENTUM_CYCLE_HOURS = 35 * 24; // ~5 weeks
const REGIME_CYCLE_HOURS = 180 * 24; // ~6 months
const EVENT_PERIOD_HOURS = 45 * 24; // event window cadence

class CommoditiesPricingService {
  getSupportedSymbols() {
    return Object.keys(COMMODITY_CONFIG);
  }

  normalizeSymbol(symbol) {
    const normalized = String(symbol || "")
      .trim()
      .toUpperCase();

    if (!normalized || !COMMODITY_CONFIG[normalized]) {
      throw new Error("Validation failed: unsupported commodity symbol");
    }

    return normalized;
  }

  _hourBucketFromDate(inputDate = new Date()) {
    const timestamp = inputDate instanceof Date ? inputDate.getTime() : new Date(inputDate).getTime();

    if (Number.isNaN(timestamp)) {
      throw new Error("Validation failed: invalid date value");
    }

    return Math.floor(timestamp / MS_IN_HOUR);
  }

  _hourStartIso(hourBucket) {
    return new Date(hourBucket * MS_IN_HOUR).toISOString();
  }

  _fnv1a32(text) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
  }

  _toUnitInterval(text) {
    const hash = this._fnv1a32(text);
    return hash / 0xffffffff;
  }

  _phase(symbol, cycleLabel) {
    return this._toUnitInterval(`${PRICE_SEED}|${symbol}|${cycleLabel}`) * TWO_PI;
  }

  _noise(symbol, hourBucket, amplitude) {
    const unit = this._toUnitInterval(`${PRICE_SEED}|${symbol}|${hourBucket}|noise`);
    const centered = unit * 2 - 1;
    return centered * amplitude;
  }

  _eventOffsetInPeriod(symbol, eventSlot, periodHours) {
    const unit = this._toUnitInterval(`${PRICE_SEED}|${symbol}|event-offset|${eventSlot}`);
    return Math.floor(unit * periodHours);
  }

  _eventAmplitude(symbol, eventSlot) {
    const unit = this._toUnitInterval(`${PRICE_SEED}|${symbol}|event-amplitude|${eventSlot}`);
    const sign = unit >= 0.5 ? 1 : -1;
    const magnitude = 0.09 + Math.abs(unit - 0.5) * 0.48;
    return sign * magnitude;
  }

  _eventWidthHours(symbol, eventSlot) {
    const unit = this._toUnitInterval(`${PRICE_SEED}|${symbol}|event-width|${eventSlot}`);
    return 6 + unit * 18;
  }

  _gaussianPulse(distance, widthHours) {
    const width = Math.max(widthHours, 1);
    const normalized = distance / width;
    return Math.exp(-0.5 * normalized * normalized);
  }

  _shockAndReboundComponent(symbol, hourBucket) {
    const baseSlot = Math.floor(hourBucket / EVENT_PERIOD_HOURS);
    let total = 0;

    for (let slot = baseSlot - 1; slot <= baseSlot + 1; slot += 1) {
      const eventCenter = slot * EVENT_PERIOD_HOURS + this._eventOffsetInPeriod(symbol, slot, EVENT_PERIOD_HOURS);
      const amplitude = this._eventAmplitude(symbol, slot);
      const widthHours = this._eventWidthHours(symbol, slot);
      const distance = hourBucket - eventCenter;

      const shock = amplitude * this._gaussianPulse(distance, widthHours);
      const rebound = -0.45 * amplitude * this._gaussianPulse(distance - 10, widthHours * 1.9);

      total += shock + rebound;
    }

    return total;
  }

  _priceAtHourBucket(symbol, hourBucket) {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const config = COMMODITY_CONFIG[normalizedSymbol];

    const mediumComponent =
      config.mediumAmplitude * Math.sin((TWO_PI * hourBucket) / MEDIUM_CYCLE_HOURS + this._phase(normalizedSymbol, "medium"));

    const longComponent = config.longAmplitude * Math.sin((TWO_PI * hourBucket) / LONG_CYCLE_HOURS + this._phase(normalizedSymbol, "long"));

    const noise = this._noise(normalizedSymbol, hourBucket, config.noiseAmplitude);

    const trendComponent = 0.18 * Math.sin((TWO_PI * hourBucket) / TREND_CYCLE_HOURS + this._phase(normalizedSymbol, "trend"));

    const momentumComponent = 0.12 * Math.sin((TWO_PI * hourBucket) / MOMENTUM_CYCLE_HOURS + this._phase(normalizedSymbol, "momentum"));

    const regimeWave = Math.sin((TWO_PI * hourBucket) / REGIME_CYCLE_HOURS + this._phase(normalizedSymbol, "regime"));
    const regimeComponent = 0.08 * Math.tanh(3 * regimeWave);

    const clusterWave = Math.sin((TWO_PI * hourBucket) / (24 * 11) + this._phase(normalizedSymbol, "cluster"));
    const volatilityClusterIntensity = 0.02 + 0.08 * clusterWave * clusterWave;
    const volatilityClusterComponent =
      volatilityClusterIntensity * Math.sin((TWO_PI * hourBucket) / (24 * 3) + this._phase(normalizedSymbol, "cluster-fast"));

    const shockComponent = this._shockAndReboundComponent(normalizedSymbol, hourBucket);
    const microJitter = this._noise(normalizedSymbol, hourBucket, config.noiseAmplitude * 1.8);

    const totalReturn = Math.max(
      -0.85,
      Math.min(
        1.2,
        mediumComponent +
          longComponent +
          trendComponent +
          momentumComponent +
          regimeComponent +
          volatilityClusterComponent +
          shockComponent +
          noise +
          microJitter,
      ),
    );

    const rawPrice = config.basePrice * Math.exp(totalReturn);
    const clampedPrice = Math.max(config.floorPrice, rawPrice);

    return Number(clampedPrice.toFixed(2));
  }

  getCurrentPrice(symbol, inputDate = new Date()) {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const hourBucket = this._hourBucketFromDate(inputDate);

    return {
      symbol: normalizedSymbol,
      hourBucket,
      hourStartUtc: this._hourStartIso(hourBucket),
      price: this._priceAtHourBucket(normalizedSymbol, hourBucket),
    };
  }

  getCurrentPrices(symbols = null, inputDate = new Date()) {
    const requestedSymbols = Array.isArray(symbols) && symbols.length > 0 ? symbols : this.getSupportedSymbols();
    return requestedSymbols.map((symbol) => {
      const midSnapshot = this.getCurrentPrice(symbol, inputDate);
      const quote = this.getExecutionQuote(symbol, "buy", 1, inputDate);

      return {
        ...midSnapshot,
        buyPrice: quote.buyPrice,
        sellPrice: quote.sellPrice,
        spreadPct: quote.spreadPct,
      };
    });
  }

  _computeVolatilityRatio(symbol, hourBucket) {
    const lookbackHours = 24;
    const prices = [];

    for (let i = 0; i < lookbackHours; i += 1) {
      prices.push(this._priceAtHourBucket(symbol, hourBucket - i));
    }

    const mean = prices.reduce((sum, value) => sum + value, 0) / Math.max(prices.length, 1);
    if (mean <= 0) {
      return 0;
    }

    const variance =
      prices.reduce((sum, value) => {
        const delta = value - mean;
        return sum + delta * delta;
      }, 0) / Math.max(prices.length, 1);

    const standardDeviation = Math.sqrt(variance);
    return standardDeviation / mean;
  }

  getExecutionQuote(symbol, side = "buy", quantity = 1, inputDate = new Date()) {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const normalizedSide = String(side || "buy")
      .trim()
      .toLowerCase();
    const normalizedQuantity = Number(quantity);

    if (!["buy", "sell"].includes(normalizedSide)) {
      throw new Error("Validation failed: side must be buy or sell");
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      throw new Error("Validation failed: quantity must be a positive number");
    }

    const midSnapshot = this.getCurrentPrice(normalizedSymbol, inputDate);
    const midPrice = Number(midSnapshot.price);
    const notional = midPrice * normalizedQuantity;
    const volatilityRatio = this._computeVolatilityRatio(normalizedSymbol, midSnapshot.hourBucket);

    const baseSpread = 0.0035;
    const volatilitySpread = Math.min(Math.max(volatilityRatio * 0.7, 0), 0.025);
    const spreadPct = baseSpread + volatilitySpread;
    const halfSpread = spreadPct / 2;

    const liquidityImpact = Math.min(Math.log10(1 + Math.max(notional, 0) / 4000) * 0.0055, 0.02);

    const buyMultiplier = 1 + halfSpread + liquidityImpact;
    const sellMultiplier = Math.max(0.0001, 1 - halfSpread - liquidityImpact);

    const buyPrice = Number((midPrice * buyMultiplier).toFixed(2));
    const sellPrice = Number((midPrice * sellMultiplier).toFixed(2));

    return {
      symbol: normalizedSymbol,
      side: normalizedSide,
      quantity: Number(normalizedQuantity.toFixed(4)),
      hourBucket: midSnapshot.hourBucket,
      hourStartUtc: midSnapshot.hourStartUtc,
      midPrice,
      buyPrice,
      sellPrice,
      spreadPct: Number((spreadPct * 100).toFixed(3)),
      liquidityImpactPct: Number((liquidityImpact * 100).toFixed(3)),
      volatilityPct: Number((volatilityRatio * 100).toFixed(3)),
      executionPrice: normalizedSide === "buy" ? buyPrice : sellPrice,
    };
  }

  getPriceHistory(symbol, hours = 168, inputDate = new Date()) {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const normalizedHours = Number(hours);

    if (!Number.isInteger(normalizedHours) || normalizedHours < 12 || normalizedHours > 720) {
      throw new Error("Validation failed: hours must be an integer between 12 and 720");
    }

    const currentBucket = this._hourBucketFromDate(inputDate);
    const startBucket = currentBucket - (normalizedHours - 1);

    const points = [];
    for (let bucket = startBucket; bucket <= currentBucket; bucket += 1) {
      points.push({
        hourBucket: bucket,
        hourStartUtc: this._hourStartIso(bucket),
        price: this._priceAtHourBucket(normalizedSymbol, bucket),
      });
    }

    return {
      symbol: normalizedSymbol,
      hours: normalizedHours,
      points,
    };
  }
}

module.exports = new CommoditiesPricingService();
