const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const APP_DIR = __dirname;
const WORKSPACE_DIR = path.resolve(APP_DIR, "..");
const DATA_DIR = path.join(APP_DIR, "data");
const PUBLIC_DIR = path.join(APP_DIR, "public");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PORT = Number(process.env.PORT || 8788);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function latestDashboardFile() {
  const files = fs
    .readdirSync(WORKSPACE_DIR)
    .filter((file) => /^dashboard_data_\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort();
  if (!files.length) throw new Error("No dashboard_data_YYYY-MM-DD.json file found");
  return path.join(WORKSPACE_DIR, files[files.length - 1]);
}

function numeric(value) {
  if (typeof value === "number") return value;
  if (!value) return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function candidateRR(candidate) {
  const levels = candidate.planLevels || {};
  const entry = numeric(levels.entryPrice ?? levels.triggerPrice);
  const stop = numeric(levels.stopPrice);
  const target = numeric(levels.target1Price);
  if (!entry || !stop || !target || entry === stop) return null;
  return Math.abs((target - entry) / (entry - stop));
}

function normalizeCandidate(candidate) {
  return {
    ...candidate,
    postOpen: Boolean(candidate.postOpen),
    rr: candidateRR(candidate),
  };
}

function bootstrapState() {
  if (fs.existsSync(STATE_FILE)) return readJson(STATE_FILE);

  const sourceFile = latestDashboardFile();
  const source = readJson(sourceFile);
  const date = source.date || new Date().toISOString().slice(0, 10);
  const marketDataFile = `market-data-${date}.json`;
  const legacy5mFile = path.join(WORKSPACE_DIR, source.fiveMinuteDataFile || "");
  const app5mFile = path.join(DATA_DIR, marketDataFile);

  if (source.fiveMinuteDataFile && fs.existsSync(legacy5mFile)) {
    fs.copyFileSync(legacy5mFile, app5mFile);
  } else {
    writeJson(app5mFile, { updatedAt: null, symbols: {} });
  }

  const candidates = (source.candidates || [])
    .filter((candidate) => candidate.symbol !== "TSEM")
    .map(normalizeCandidate);

  const state = {
    appVersion: 1,
    importedFrom: path.basename(sourceFile),
    date,
    pageTitle: source.pageTitle || `Отбор на ${date}`,
    note: source.note || "",
    defaultSymbol: source.defaultSymbol || candidates[0]?.symbol || null,
    marketDataFile,
    lastRefreshAt: readJson(app5mFile).updatedAt || null,
    premarketSnapshot: candidates.map((candidate) => ({
      ...candidate,
      snapshotStatus: candidate.status,
    })),
    candidates,
    tradeManagement: source.tradeManagement || {},
    activeTrades: Object.entries(source.tradeManagement || {}).map(([symbol, trade]) => ({
      symbol,
      ...trade,
    })),
    journal: [],
  };

  writeJson(STATE_FILE, state);
  return state;
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  writeJson(STATE_FILE, state);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return sendText(res, 404, "Not found");
  }

  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

async function fetchYahooBars(symbol) {
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=1d&interval=5m&includePrePost=true`;
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`${symbol}: Yahoo HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps
    .map((timestamp, index) => ({
      t: timestamp,
      o: quote.open?.[index],
      h: quote.high?.[index],
      l: quote.low?.[index],
      c: quote.close?.[index],
      v: quote.volume?.[index] || 0,
    }))
    .filter((bar) =>
      [bar.o, bar.h, bar.l, bar.c].every((value) => typeof value === "number" && Number.isFinite(value))
    );
}

async function refreshMarketData(state) {
  const symbols = [...new Set(state.candidates.map((candidate) => candidate.symbol))];
  const settled = await Promise.allSettled(
    symbols.map(async (symbol) => ({ symbol, bars: await fetchYahooBars(symbol) }))
  );
  const results = {};
  const errors = [];

  settled.forEach((item) => {
    if (item.status === "fulfilled") {
      results[item.value.symbol] = item.value.bars;
    } else {
      errors.push(item.reason?.message || String(item.reason));
    }
  });

  const marketData = {
    updatedAt: new Date().toISOString(),
    source: "Yahoo Finance chart API",
    symbols: results,
    errors,
  };
  writeJson(path.join(DATA_DIR, state.marketDataFile), marketData);
  state.lastRefreshAt = marketData.updatedAt;
  saveState(state);
  return marketData;
}

function loadStatePayload() {
  const state = bootstrapState();
  const marketDataPath = path.join(DATA_DIR, state.marketDataFile);
  const marketData = fs.existsSync(marketDataPath)
    ? readJson(marketDataPath)
    : { updatedAt: null, symbols: {} };
  return { state, marketData };
}

async function handleApi(req, res, url) {
  const { state, marketData } = loadStatePayload();

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, { state, marketData });
  }

  if (req.method === "POST" && url.pathname === "/api/refresh-market-data") {
    try {
      const fresh = await refreshMarketData(state);
      return sendJson(res, 200, { state: bootstrapState(), marketData: fresh });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/update-trade") {
    const body = await readBody(req);
    if (!body.symbol) return sendJson(res, 400, { error: "symbol is required" });
    const symbol = String(body.symbol).toUpperCase();
    const trade = {
      symbol,
      entry: numeric(body.entry),
      initialStop: numeric(body.initialStop ?? body.stop),
      currentStop: numeric(body.currentStop ?? body.stop),
      target: numeric(body.target),
      size: numeric(body.size),
      status: body.status || "active",
      guidance: body.guidance || "",
      updatedAt: new Date().toISOString(),
    };
    state.tradeManagement = state.tradeManagement || {};
    state.tradeManagement[symbol] = trade;
    state.activeTrades = Object.entries(state.tradeManagement).map(([key, value]) => ({
      symbol: key,
      ...value,
    }));
    state.defaultSymbol = symbol;
    const candidate = state.candidates.find((item) => item.symbol === symbol);
    if (candidate) {
      candidate.status = `Позиция активна: entry $${trade.entry}, stop $${trade.currentStop}, target $${trade.target}.`;
      candidate.planLevels = {
        ...(candidate.planLevels || {}),
        entryPrice: trade.entry,
        stopPrice: trade.currentStop,
        target1Price: trade.target,
      };
      candidate.rr = candidateRR(candidate);
    }
    saveState(state);
    return sendJson(res, 200, { state, marketData });
  }

  if (req.method === "POST" && url.pathname === "/api/set-default") {
    const body = await readBody(req);
    const symbol = String(body.symbol || "").toUpperCase();
    if (!state.candidates.some((candidate) => candidate.symbol === symbol)) {
      return sendJson(res, 404, { error: "symbol not found" });
    }
    state.defaultSymbol = symbol;
    saveState(state);
    return sendJson(res, 200, { state, marketData });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Trading dashboard app: http://localhost:${PORT}`);
});
