/**
 * Shadow-DOM widgets for the commodities page.
 *
 * Two custom elements that both hold their markup in a shadow root, but differ
 * in the one way that matters to anything reaching in from outside:
 *
 *   <commodity-converter>    open root   — its internals are reachable.
 *   <commodity-spread-badge> closed root — they are not, at all. The element
 *                            therefore publishes what it knows on the host
 *                            itself: a `data-widest-spread` attribute and a
 *                            getState() method.
 *
 * Neither element fetches anything. The page owns the prices and pushes them in
 * through the `prices` property, so the widgets stay in step with the tables
 * without issuing their own requests.
 */
(function defineCommodityShadowWidgets() {
  const normalizePrices = (value) =>
    (Array.isArray(value) ? value : [])
      .map((item) => ({
        symbol: String(item?.symbol || "").toUpperCase(),
        mid: Number(item?.price || 0),
        buy: Number(item?.buyPrice ?? item?.price ?? 0),
        sell: Number(item?.sellPrice ?? item?.price ?? 0),
      }))
      .filter((item) => item.symbol && Number.isFinite(item.mid) && item.mid > 0);

  const SHARED_STYLES = `
    :host {
      display: block;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      color: #2f3d2b;
    }
    :host([hidden]) { display: none; }
  `;

  class CommodityConverter extends HTMLElement {
    constructor() {
      super();
      // Open: devtools, the page script and automation tools can all reach in.
      this._root = this.attachShadow({ mode: "open" });
      this._prices = [];
      this._render();
    }

    set prices(value) {
      this._prices = normalizePrices(value);
      this._syncSymbols();
    }

    get prices() {
      return this._prices.slice();
    }

    _render() {
      this._root.innerHTML = `
        <style>
          ${SHARED_STYLES}
          .grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            gap: 0.5rem;
          }
          label {
            display: block;
            font-size: 0.75rem;
            color: #5d6459;
            margin-bottom: 0.2rem;
          }
          input, select {
            width: 100%;
            box-sizing: border-box;
            font: inherit;
            font-size: 0.85rem;
            padding: 0.35rem 0.45rem;
            border-radius: 0.5rem;
            border: 1px solid rgba(106, 123, 94, 0.4);
            background: rgba(255, 255, 255, 0.7);
            color: inherit;
          }
          button {
            margin-top: 0.6rem;
            font: inherit;
            font-size: 0.85rem;
            padding: 0.35rem 0.8rem;
            border-radius: 0.5rem;
            border: 1px solid rgba(106, 123, 94, 0.45);
            background: rgba(106, 123, 94, 0.18);
            color: inherit;
            cursor: pointer;
          }
          button:hover { background: rgba(106, 123, 94, 0.3); }
          .result {
            display: block;
            margin-top: 0.6rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }
          .note {
            display: block;
            margin-top: 0.5rem;
            font-size: 0.75rem;
            color: #5d6459;
          }
        </style>
        <div class="grid">
          <div>
            <label for="amount">Amount</label>
            <input id="amount" part="amount" type="number" min="0" step="0.0001" value="1"
              data-testid="converter-amount" />
          </div>
          <div>
            <label for="symbol">Symbol</label>
            <select id="symbol" part="symbol" data-testid="converter-symbol">
              <option value="">Loading symbols...</option>
            </select>
          </div>
          <div>
            <label for="direction">Direction</label>
            <select id="direction" part="direction" data-testid="converter-direction">
              <option value="toRol" selected>Quantity to ROL</option>
              <option value="toQuantity">ROL to quantity</option>
            </select>
          </div>
          <div>
            <label for="side">Price side</label>
            <select id="side" part="side" data-testid="converter-side">
              <option value="mid" selected>Mid</option>
              <option value="buy">Buy (ask)</option>
              <option value="sell">Sell (bid)</option>
            </select>
          </div>
        </div>
        <button id="convert" part="convert" type="button" data-testid="converter-submit">Convert</button>
        <output id="result" class="result" data-testid="converter-result">-</output>
        <span class="note"><slot name="note"></slot></span>
      `;

      this._root.getElementById("convert").addEventListener("click", () => this._convert());
    }

    _syncSymbols() {
      const select = this._root.getElementById("symbol");
      const previous = select.value;

      select.textContent = "";

      if (this._prices.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No symbols available";
        select.appendChild(option);
        select.disabled = true;
        return;
      }

      this._prices.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.symbol;
        option.textContent = item.symbol;
        select.appendChild(option);
      });

      select.disabled = false;
      if (previous && this._prices.some((item) => item.symbol === previous)) {
        select.value = previous;
      }
    }

    _convert() {
      const result = this._root.getElementById("result");
      const amount = Number(this._root.getElementById("amount").value);
      const symbol = this._root.getElementById("symbol").value;
      const direction = this._root.getElementById("direction").value;
      const side = this._root.getElementById("side").value;
      const entry = this._prices.find((item) => item.symbol === symbol);

      if (!entry) {
        result.value = "Pick a symbol first";
        return;
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        result.value = "Enter an amount above zero";
        return;
      }

      const price = entry[side] || entry.mid;
      const converted = direction === "toRol" ? amount * price : amount / price;

      result.value =
        direction === "toRol" ? `${amount} ${symbol} = ${converted.toFixed(2)} ROL` : `${amount} ROL = ${converted.toFixed(4)} ${symbol}`;

      this.dispatchEvent(
        new CustomEvent("commodity-converted", {
          bubbles: true,
          composed: true,
          detail: { symbol, amount, direction, side, price, converted },
        }),
      );
    }
  }

  class CommoditySpreadBadge extends HTMLElement {
    constructor() {
      super();
      // Closed: `element.shadowRoot` is null and nothing outside this class can
      // read the rendered text — which is exactly why the state below is also
      // published on the host.
      this._root = this.attachShadow({ mode: "closed" });
      this._state = { symbol: null, spread: 0, symbolCount: 0 };
      this._render();
    }

    set prices(value) {
      const prices = normalizePrices(value);
      const widest = prices.reduce((best, item) => {
        const spread = item.buy - item.sell;
        return !best || spread > best.spread ? { symbol: item.symbol, spread } : best;
      }, null);

      this._state = {
        symbol: widest?.symbol || null,
        spread: widest?.spread || 0,
        symbolCount: prices.length,
      };

      this._publish();
      this._paint();
    }

    /** The supported way to read this element's state from outside. */
    getState() {
      return { ...this._state };
    }

    _publish() {
      if (this._state.symbol) {
        this.dataset.widestSpread = this._state.symbol;
        this.dataset.widestSpreadValue = this._state.spread.toFixed(2);
      } else {
        delete this.dataset.widestSpread;
        delete this.dataset.widestSpreadValue;
      }
      this.dataset.symbolCount = String(this._state.symbolCount);
    }

    _render() {
      this._root.innerHTML = `
        <style>
          ${SHARED_STYLES}
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.3rem 0.6rem;
            border-radius: 999px;
            font-size: 0.8rem;
            background: rgba(106, 123, 94, 0.16);
            border: 1px solid rgba(106, 123, 94, 0.32);
          }
          .value { font-weight: 700; font-variant-numeric: tabular-nums; }
        </style>
        <span class="badge">
          <span>Widest spread</span>
          <span class="value" id="value">-</span>
        </span>
      `;
    }

    _paint() {
      const value = this._root.getElementById("value");
      if (!value) return;

      value.textContent = this._state.symbol ? `${this._state.symbol} ${this._state.spread.toFixed(2)} ROL` : "-";
    }
  }

  if (!customElements.get("commodity-converter")) {
    customElements.define("commodity-converter", CommodityConverter);
  }

  if (!customElements.get("commodity-spread-badge")) {
    customElements.define("commodity-spread-badge", CommoditySpreadBadge);
  }
})();
