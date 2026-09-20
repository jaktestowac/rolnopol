/**
 * Ticker board embedded in /financial-commodities.html via a same-origin iframe.
 *
 * Runs on its own: it has no access to the parent page's app modules and fetches
 * prices itself, relying on the rolnopolToken cookie the parent session set.
 * State is mirrored onto <body data-frame-state> so an observer outside the
 * frame can wait on it, and each refresh is posted to the parent window.
 */
(function initCommodityTicker() {
  const PRICES_URL = "/api/v1/commodities/prices";
  const SESSION_OPEN_FROM_HOUR_UTC = 6;
  const SESSION_OPEN_UNTIL_HOUR_UTC = 18;

  const body = document.body;
  const message = document.getElementById("tickerMessage");
  const table = document.querySelector(".ticker__table");
  const tbody = document.getElementById("tickerBody");
  const refreshBtn = document.getElementById("tickerRefreshBtn");
  const statusFrame = document.getElementById("tickerStatusFrame");

  let pendingSession = null;

  const setState = (state) => {
    body.dataset.frameState = state;
  };

  const describeSession = () => {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    const isWeekday = day >= 1 && day <= 5;
    const isTradingHour = hour >= SESSION_OPEN_FROM_HOUR_UTC && hour < SESSION_OPEN_UNTIL_HOUR_UTC;
    const isOpen = isWeekday && isTradingHour;

    return {
      state: isOpen ? "open" : "closed",
      text: isOpen ? `Session: open (${hour}:00 UTC)` : `Session: closed (${hour}:00 UTC)`,
    };
  };

  // The nested frame is srcdoc, so it shares this origin and its document is
  // reachable — but until it has been parsed, contentDocument is still the
  // placeholder about:blank and the targets below do not exist yet.
  const paintSession = (session) => {
    if (!statusFrame) return;

    const frameDoc = statusFrame.contentDocument;
    const dot = frameDoc?.getElementById("sessionDot");
    const text = frameDoc?.getElementById("sessionText");

    if (!dot || !text) {
      pendingSession = session;
      return;
    }

    dot.dataset.session = session.state;
    text.textContent = session.text;
  };

  statusFrame?.addEventListener("load", () => {
    const queued = pendingSession;
    pendingSession = null;
    if (queued) paintSession(queued);
  });

  const notifyParent = (payload) => {
    if (window.parent === window) return;

    try {
      window.parent.postMessage({ source: "commodity-ticker", ...payload }, window.location.origin);
    } catch {
      // A parent on another origin simply does not get the update.
    }
  };

  const renderRows = (prices) => {
    tbody.textContent = "";

    prices.forEach((item) => {
      const mid = Number(item?.price || 0);
      const spread = Number(item?.buyPrice ?? mid) - Number(item?.sellPrice ?? mid);
      const row = document.createElement("tr");
      row.dataset.testid = "ticker-row";
      row.dataset.symbol = String(item?.symbol || "");

      [String(item?.symbol || "-"), mid.toFixed(2), spread.toFixed(2)].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      tbody.appendChild(row);
    });
  };

  const loadPrices = async () => {
    setState("loading");
    message.textContent = "Loading prices...";
    table.hidden = true;

    if (refreshBtn) refreshBtn.disabled = true;

    try {
      const response = await fetch(PRICES_URL, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`Prices request failed with ${response.status}`);
      }

      const payload = await response.json();
      const prices = Array.isArray(payload?.data?.prices) ? payload.data.prices : [];

      renderRows(prices);
      paintSession(describeSession());

      if (prices.length === 0) {
        message.textContent = "No prices available.";
        table.hidden = true;
      } else {
        message.textContent = `${prices.length} symbols — hour ${prices[0]?.hourStartUtc || "-"}`;
        table.hidden = false;
      }

      setState("ready");
      notifyParent({ type: "prices-loaded", count: prices.length, hourStartUtc: prices[0]?.hourStartUtc || null });
    } catch (error) {
      message.textContent = "Failed to load prices in the ticker frame.";
      table.hidden = true;
      setState("error");
      notifyParent({ type: "prices-failed", error: String(error?.message || error) });
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  };

  refreshBtn?.addEventListener("click", () => {
    loadPrices();
  });

  loadPrices();
})();
