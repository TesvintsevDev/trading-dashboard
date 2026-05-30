const app = document.querySelector("#app");

let payload = null;
let selectedSymbol = null;
let mode = "live";
let detailTab = "Plan";
let chartMode = "5m";

const money = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "н/д";
  return `$${Number(value).toFixed(2)}`;
};

const scoreNumber = (score) => Number(String(score || "0").split("/")[0]) || 0;
const biasClass = (bias) => String(bias || "watch").toLowerCase();
const isQualified = (candidate) =>
  candidate.tapeCheck?.impulse5m && candidate.tapeCheck?.dailyHourlyBreak && candidate.tapeCheck?.pullback23;

function currentState() {
  return payload?.state;
}

function candidatesForMode() {
  const state = currentState();
  if (!state) return [];
  if (mode === "premarket") return state.premarketSnapshot || [];
  if (mode === "postopen") return state.candidates.filter((candidate) => candidate.postOpen);
  if (mode === "trades") {
    const activeSymbols = new Set((state.activeTrades || []).map((trade) => trade.symbol));
    return state.candidates.filter((candidate) => activeSymbols.has(candidate.symbol));
  }
  return state.candidates;
}

function selectedCandidate() {
  const state = currentState();
  if (!state) return null;
  return (
    state.candidates.find((candidate) => candidate.symbol === selectedSymbol) ||
    state.premarketSnapshot?.find((candidate) => candidate.symbol === selectedSymbol) ||
    state.candidates[0]
  );
}

function activeTrade(symbol) {
  return currentState()?.tradeManagement?.[symbol] || null;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "API error");
  return json;
}

async function load() {
  payload = await api("/api/state");
  selectedSymbol = payload.state.defaultSymbol || payload.state.candidates[0]?.symbol;
  render();
}

function render() {
  const state = currentState();
  const candidate = selectedCandidate();
  if (!state || !candidate) {
    app.innerHTML = `<div class="boot">Нет данных для dashboard</div>`;
    return;
  }

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="eyebrow">Premarket Scan</div>
          <h1>${state.pageTitle}</h1>
          <p>${state.note}</p>
        </div>
        ${renderModeTabs()}
        <div class="watchlist">${renderWatchlist()}</div>
      </aside>
      <main class="main">
        ${renderAlertStrip()}
        <header class="header">
          <div>
            <div class="eyebrow">Interactive Plan</div>
            <h2>${candidate.symbol} - ${candidate.bias}</h2>
            <p>${candidate.exchange}:${candidate.symbol} | score ${candidate.score}</p>
          </div>
          <div class="toolbar">
            <span class="freshness">${freshnessText(payload.marketData?.updatedAt)}</span>
            <button class="refresh" data-action="refresh">Обновить данные</button>
          </div>
        </header>
        <section class="content">
          <div class="left-panel">
            ${renderDetailTabs()}
            <div class="panel">${renderDetailPanel(candidate)}</div>
          </div>
          ${renderChart(candidate)}
        </section>
      </main>
    </div>
  `;

  bindEvents();
  if (chartMode === "5m") requestAnimationFrame(() => drawChart(candidate));
}

function renderModeTabs() {
  const tabs = [
    ["live", "Live"],
    ["premarket", "Premarket"],
    ["postopen", "Post-open"],
    ["trades", "Trades"],
  ];
  return `
    <nav class="mode-tabs">
      ${tabs
        .map(([key, label]) => `<button class="${mode === key ? "active" : ""}" data-mode="${key}">${label}</button>`)
        .join("")}
    </nav>
  `;
}

function renderWatchlist() {
  const list = candidatesForMode();
  const groups = mode === "live" ? groupBy(list, (candidate) => candidate.group || "core") : { [mode]: list };
  return Object.entries(groups)
    .map(([group, items]) => {
      if (!items.length) return "";
      return `
        <div class="section-title">${groupTitle(group)}</div>
        ${items.map(renderCandidateCard).join("")}
      `;
    })
    .join("");
}

function renderCandidateCard(candidate) {
  const score = scoreNumber(candidate.score);
  const rr = candidate.rr ? Number(candidate.rr) : null;
  const flags = candidate.filterFlags || [];
  const rrClass = rr ? (rr < 1.5 ? "low" : rr < 2 ? "mid" : "") : "";
  return `
    <button class="ticker-row ${candidate.symbol === selectedSymbol ? "active" : ""}" data-symbol="${candidate.symbol}">
      <div class="ticker-top">
        <span class="symbol">${candidate.symbol}</span>
        <span class="badge ${biasClass(candidate.bias)}">${candidate.bias}</span>
        <span class="score">${candidate.score}</span>
      </div>
      <div class="meter"><span style="width:${Math.min(score * 10, 100)}%"></span></div>
      <div class="ticker-meta">
        ${rr ? `<span class="rr ${rrClass}">${rr.toFixed(1)}R</span>` : ""}
        <span>${candidate.price} | ATR ${candidate.atr} | Vol ${candidate.avgVolume}</span>
      </div>
      <div class="ticker-status">${candidate.status || ""}</div>
      ${flags.length ? `<div class="ticker-flags">${flags.map((flag) => `<span class="mini-warn">${flag.label}</span>`).join("")}</div>` : ""}
    </button>
  `;
}

function renderAlertStrip() {
  const qualified = currentState().candidates.filter(isQualified);
  return `
    <div class="alert-strip">
      <div class="alert-label">🔥 Alert</div>
      <div class="alert-items">
        ${
          qualified.length
            ? qualified
                .map(
                  (candidate) =>
                    `<button class="alert-pill ${biasClass(candidate.bias)}" data-symbol="${candidate.symbol}" data-tab="Trade">${candidate.symbol} ${candidate.bias.toUpperCase()} | ${candidate.tapeCheck.note}</button>`
                )
                .join("")
            : `<span class="freshness">Нет тикеров, где одновременно есть 5m impulse + daily/hourly break + pullback 2-3</span>`
        }
      </div>
    </div>
  `;
}

function renderDetailTabs() {
  return `
    <nav class="detail-tabs">
      ${["Plan", "Trade", "Context"]
        .map((tab) => `<button class="${detailTab === tab ? "active" : ""}" data-detail="${tab}">${tab}</button>`)
        .join("")}
    </nav>
  `;
}

function renderDetailPanel(candidate) {
  if (detailTab === "Trade") return renderTradePanel(candidate);
  if (detailTab === "Context") return renderContextPanel(candidate);
  return renderPlanPanel(candidate);
}

function renderPlanPanel(candidate) {
  return `
    <h3>${candidate.symbol} план</h3>
    <div class="grid-2">
      <div class="fact"><small>Цена / ATR</small><strong>${candidate.price} / ATR ${candidate.atr}</strong></div>
      <div class="fact"><small>Avg Volume</small><strong>${candidate.avgVolume}</strong></div>
    </div>
    ${block("Post-open status", candidate.status)}
    ${block("Score reason / filters", candidate.scoreReason)}
    ${block("Почему в игре", candidate.why)}
    <div class="grid-2">
      ${block("Trigger zone", candidate.trigger)}
      ${block("Invalidation", candidate.invalidation)}
    </div>
    ${block("Targets", candidate.targets)}
  `;
}

function renderTradePanel(candidate) {
  const trade = activeTrade(candidate.symbol);
  if (!trade) {
    return `
      <h3>${candidate.symbol} trade</h3>
      <div class="text-block"><p>No active trade - wait for trigger.</p></div>
      ${renderTradeForm(candidate, {})}
    `;
  }
  const rr = trade.entry && trade.currentStop && trade.target ? Math.abs((trade.target - trade.entry) / (trade.entry - trade.currentStop)) : null;
  return `
    <h3>${candidate.symbol} trade</h3>
    <div class="grid-2">
      <div class="fact"><small>Entry</small><strong>${money(trade.entry)}</strong></div>
      <div class="fact"><small>Size</small><strong>${trade.size || "н/д"}</strong></div>
      <div class="fact"><small>Stop</small><strong>${money(trade.currentStop)}</strong></div>
      <div class="fact"><small>Target / R:R</small><strong>${money(trade.target)}${rr ? ` / ${rr.toFixed(1)}R` : ""}</strong></div>
    </div>
    ${block("Guidance", trade.guidance || candidate.riskContext)}
    ${renderTradeForm(candidate, trade)}
  `;
}

function renderTradeForm(candidate, trade) {
  return `
    <form class="trade-form" data-trade-form>
      <label>Entry <input name="entry" inputmode="decimal" value="${trade.entry ?? ""}" placeholder="11.21" /></label>
      <label>Stop <input name="stop" inputmode="decimal" value="${trade.currentStop ?? trade.initialStop ?? ""}" placeholder="10.79" /></label>
      <label>Target <input name="target" inputmode="decimal" value="${trade.target ?? ""}" placeholder="12.50" /></label>
      <label>Size <input name="size" inputmode="numeric" value="${trade.size ?? ""}" placeholder="10" /></label>
      <label>Guidance <textarea name="guidance" placeholder="Что делать дальше по структуре">${trade.guidance || ""}</textarea></label>
      <button type="submit">Сохранить trade</button>
    </form>
  `;
}

function renderContextPanel(candidate) {
  return `
    <h3>${candidate.symbol} context</h3>
    ${block("Сектор / с чем ходит", candidate.sectorPeers)}
    ${block("Что двигает сегодня", candidate.dayDriver)}
    ${block("Компания", candidate.companyDesc)}
    ${block("Что сломает идею", candidate.riskContext)}
  `;
}

function renderChart(candidate) {
  const tvUrl = `https://www.tradingview.com/chart/?symbol=${candidate.exchange || "NASDAQ"}:${candidate.symbol}`;
  return `
    <section class="chart-panel">
      <div class="chart-head">
        <div>
          <h3>${candidate.symbol} ${chartMode}</h3>
          <span>${chartMode === "5m" ? "Local Yahoo preview. Для реальной картины открывай TradingView." : "External context chart"}</span>
        </div>
        <div class="chart-actions">
          ${["5m", "Daily", "Weekly"].map((modeName) => `<button class="${chartMode === modeName ? "active" : ""}" data-chart="${modeName}">${modeName}</button>`).join("")}
          <a class="refresh" href="${tvUrl}" target="_blank" rel="noreferrer">Open TradingView</a>
        </div>
      </div>
      <div class="chart-wrap">
        ${
          chartMode === "5m"
            ? `<canvas id="chart"></canvas>`
            : `<div class="chart-empty">Daily/Weekly лучше смотреть в TradingView: статичные картинки часто врут или не обновляются.</div>`
        }
      </div>
    </section>
  `;
}

function drawChart(candidate) {
  const canvas = document.querySelector("#chart");
  if (!canvas) return;
  const bars = payload.marketData?.symbols?.[candidate.symbol] || [];
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!bars.length) {
    drawEmpty(ctx, rect, "Нет 5m данных. Нажми обновить данные или открой TradingView.");
    return;
  }

  const regularBars = bars.filter((bar) => (bar.v || 0) > 0).slice(-80);
  const shown = regularBars.length >= 8 ? regularBars : bars.slice(-80);
  const levels = candidate.planLevels || {};
  const prices = shown.flatMap((bar) => [bar.h, bar.l]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.15 || 1;
  const top = max + pad;
  const bottom = min - pad;
  const chartH = rect.height - 86;
  const volH = 60;
  const y = (price) => 20 + ((top - price) / (top - bottom)) * (chartH - 28);
  const xStep = (rect.width - 52) / shown.length;
  const labelSlots = [];

  ctx.strokeStyle = "#1d2b36";
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, sans-serif";
  ctx.fillStyle = "#9cadbb";
  for (let i = 0; i < 5; i += 1) {
    const yy = 20 + (i / 4) * (chartH - 28);
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(rect.width - 44, yy);
    ctx.stroke();
    const price = top - (i / 4) * (top - bottom);
    ctx.fillText(price.toFixed(2), rect.width - 40, yy + 4);
  }

  const maxVol = Math.max(...shown.map((bar) => bar.v || 0), 1);
  shown.forEach((bar, index) => {
    const x = 8 + index * xStep;
    const green = bar.c >= bar.o;
    ctx.strokeStyle = green ? "#64c987" : "#f16574";
    ctx.fillStyle = green ? "#64c987" : "#f16574";
    ctx.beginPath();
    ctx.moveTo(x + xStep * 0.45, y(bar.h));
    ctx.lineTo(x + xStep * 0.45, y(bar.l));
    ctx.stroke();
    const bodyTop = y(Math.max(bar.o, bar.c));
    const bodyBottom = y(Math.min(bar.o, bar.c));
    ctx.fillRect(x + xStep * 0.18, bodyTop, Math.max(2, xStep * 0.55), Math.max(2, bodyBottom - bodyTop));
    ctx.globalAlpha = 0.42;
    ctx.fillRect(x + xStep * 0.18, rect.height - 16 - ((bar.v || 0) / maxVol) * volH, Math.max(2, xStep * 0.55), ((bar.v || 0) / maxVol) * volH);
    ctx.globalAlpha = 1;
  });

  drawLevel(ctx, rect, y, levels.entryPrice, "entry", "#76aaff", false, top, bottom, labelSlots);
  drawLevel(ctx, rect, y, levels.triggerPrice, "trigger", "#76aaff", false, top, bottom, labelSlots);
  drawLevel(ctx, rect, y, levels.stopPrice, "stop", "#ff6474", false, top, bottom, labelSlots);
  drawLevel(ctx, rect, y, levels.target1Price, "target", "#4fd17b", false, top, bottom, labelSlots);
  drawLevel(ctx, rect, y, shown.at(-1)?.c, "last", "#f5bf4f", true, top, bottom, labelSlots);
}

function drawLevel(ctx, rect, y, value, label, color, dashed = false, top = Infinity, bottom = -Infinity, labelSlots = []) {
  const price = Number(value);
  if (!Number.isFinite(price)) return;
  const isAbove = price > top;
  const isBelow = price < bottom;
  const yy = isAbove ? 18 : isBelow ? rect.height - 78 : y(price);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  if (!isAbove && !isBelow) {
    if (dashed) ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(rect.width - 52, yy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.font = "12px Inter, sans-serif";
  const prefix = isAbove ? "above " : isBelow ? "below " : "";
  let labelY = isBelow ? yy + 14 : yy - 6;
  while (labelSlots.some((slot) => Math.abs(slot - labelY) < 14)) {
    labelY += isBelow ? -14 : 14;
  }
  labelSlots.push(labelY);
  ctx.fillText(`${prefix}${label} ${price.toFixed(2)}`, 8, labelY);
  ctx.restore();
}

function drawEmpty(ctx, rect, text) {
  ctx.fillStyle = "#9cadbb";
  ctx.font = "16px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, rect.width / 2, rect.height / 2);
}

function block(title, value) {
  return `
    <div class="text-block">
      <small>${title}</small>
      <p>${value || "н/д"}</p>
    </div>
  `;
}

function freshnessText(updatedAt) {
  if (!updatedAt) return "Данные не обновлялись";
  const date = new Date(updatedAt);
  const ageMin = Math.round((Date.now() - date.getTime()) / 60000);
  return `Updated ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}${ageMin >= 0 ? ` (${ageMin}m)` : ""}`;
}

function groupBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function groupTitle(group) {
  return {
    core: "Core Candidates",
    exception: "Exceptions / Watch",
    live: "Live Board",
    premarket: "Premarket Snapshot",
    postopen: "Post-open Check",
    trades: "Active Trades",
  }[group] || group;
}

function bindEvents() {
  document.querySelectorAll("[data-symbol]").forEach((node) => {
    node.addEventListener("click", async () => {
      selectedSymbol = node.dataset.symbol;
      if (node.dataset.tab) detailTab = node.dataset.tab;
      try {
        await api("/api/set-default", { method: "POST", body: JSON.stringify({ symbol: selectedSymbol }) });
      } catch {}
      render();
    });
  });

  document.querySelectorAll("[data-mode]").forEach((node) => {
    node.addEventListener("click", () => {
      mode = node.dataset.mode;
      render();
    });
  });

  document.querySelectorAll("[data-detail]").forEach((node) => {
    node.addEventListener("click", () => {
      detailTab = node.dataset.detail;
      render();
    });
  });

  document.querySelectorAll("[data-chart]").forEach((node) => {
    node.addEventListener("click", () => {
      chartMode = node.dataset.chart;
      render();
    });
  });

  document.querySelector("[data-action='refresh']")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.textContent = "Обновляю...";
    button.disabled = true;
    try {
      payload = await api("/api/refresh-market-data", { method: "POST" });
    } catch (error) {
      alert(`Не удалось обновить данные: ${error.message}`);
    } finally {
      render();
    }
  });

  document.querySelector("[data-trade-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload = await api("/api/update-trade", {
      method: "POST",
      body: JSON.stringify({ symbol: selectedSymbol, ...data }),
    });
    detailTab = "Trade";
    render();
  });
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const list = candidatesForMode();
  const index = list.findIndex((candidate) => candidate.symbol === selectedSymbol);
  if (event.key === "ArrowDown") selectedSymbol = list[Math.min(index + 1, list.length - 1)]?.symbol || selectedSymbol;
  if (event.key === "ArrowUp") selectedSymbol = list[Math.max(index - 1, 0)]?.symbol || selectedSymbol;
  if (event.key.toLowerCase() === "t") detailTab = "Trade";
  if (event.key.toLowerCase() === "p") detailTab = "Plan";
  if (event.key.toLowerCase() === "c") detailTab = "Context";
  if (event.key === "5") chartMode = "5m";
  if (event.key.toLowerCase() === "d") chartMode = "Daily";
  render();
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  if (chartMode !== "5m") return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const candidate = selectedCandidate();
    if (candidate) drawChart(candidate);
  }, 120);
});

load().catch((error) => {
  app.innerHTML = `<div class="boot">Ошибка загрузки: ${error.message}</div>`;
});
