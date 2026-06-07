const OPEN_SKY_URL = "https://opensky-network.org/api/states/all";
const NOAA_KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const NOAA_SOLAR_FLUX_URL = "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json";
const AIRCRAFT_FALLBACK_URL = "data/aircraft-fallback.json";
const SPACE_FALLBACK_URL = "data/space-weather-fallback.json";
const REFRESH_INTERVAL_SECONDS = 60;
const MAX_AIRCRAFT_ROWS = 12;
const BUILT_IN_AIRCRAFT_FALLBACK = {
  time: 1770091200,
  states: [
    ["a1b2c3", "NXS101", "United States", 1770091110, 1770091110, -77.0365, 38.8977, 10668, false, 235, 84, 0.2, null, 10972, "7600", false, 0],
    ["b2c3d4", "ORB204", "Brazil", 1770091120, 1770091120, -46.6333, -23.5505, 9144, false, 248, 122, -1.1, null, 9340, null, false, 0],
    ["d4e5f6", "AUR909", "Iceland", 1770091140, 1770091140, -21.9426, 64.1466, 13200, false, 315, 33, 3.4, null, 13480, null, false, 0],
    ["f6g7h8", "VECTOR5", "Japan", 1770091160, 1770091160, 139.6917, 35.6895, 14320, false, 330, 70, 38.0, null, 14510, null, false, 0],
    ["i9j0k1", "ZENITH", "United Kingdom", 1770091190, 1770091190, -0.1276, 51.5072, 12580, false, 281, 144, 26.5, null, 12760, null, false, 0]
  ]
};

const BUILT_IN_SPACE_FALLBACK = {
  kpIndex: 3.3,
  solarFlux: 148.7,
  stormLevel: "Nominal",
  summary: "Fallback interno: atividade geomagnética nominal, com fluxo solar moderado e sem tempestade severa estimada."
};

const state = {
  aircraft: [],
  anomalies: [],
  usingFallback: false,
  nextRefresh: REFRESH_INTERVAL_SECONDS,
  refreshTimer: null,
  countdownTimer: null,
  eventTimer: null
};

const elements = {
  bootScreen: document.querySelector("#bootScreen"),
  bootText: document.querySelector("#bootText"),
  utcClock: document.querySelector("#utcClock"),
  connectionStatus: document.querySelector("#connectionStatus"),
  aircraftCount: document.querySelector("#aircraftCount"),
  aircraftSource: document.querySelector("#aircraftSource"),
  anomalyCount: document.querySelector("#anomalyCount"),
  riskCard: document.querySelector("#riskCard"),
  riskLevel: document.querySelector("#riskLevel"),
  riskReason: document.querySelector("#riskReason"),
  refreshCountdown: document.querySelector("#refreshCountdown"),
  radarScope: document.querySelector("#radarScope"),
  aircraftTable: document.querySelector("#aircraftTable"),
  eventTerminal: document.querySelector("#eventTerminal"),
  refreshButton: document.querySelector("#refreshButton"),
  spaceSource: document.querySelector("#spaceSource"),
  kpIndex: document.querySelector("#kpIndex"),
  solarFlux: document.querySelector("#solarFlux"),
  stormLevel: document.querySelector("#stormLevel"),
  spaceSummary: document.querySelector("#spaceSummary")
};

document.addEventListener("DOMContentLoaded", () => {
  bootSequence();
  startClock();
  bindActions();
  initializeMissionControl();
});

function bindActions() {
  elements.refreshButton.addEventListener("click", () => {
    addTerminalEvent("CMD", "Atualização manual solicitada pelo operador.");
    refreshAllData();
  });
}

function bootSequence() {
  const bootMessages = [
    "Sincronizando telemetria orbital...",
    "Calibrando radar holográfico...",
    "Estabelecendo canal NOAA/SWPC...",
    "Inicializando análise de anomalias..."
  ];

  bootMessages.forEach((message, index) => {
    window.setTimeout(() => {
      elements.bootText.textContent = message;
    }, index * 520);
  });

  window.setTimeout(() => {
    elements.bootScreen.classList.add("is-hidden");
    addTerminalEvent("BOOT", "NEXUS UAP Command operacional.");
  }, 2400);
}

function startClock() {
  window.setInterval(() => {
    elements.utcClock.textContent = new Date().toISOString().slice(11, 19);
  }, 1000);
}

async function initializeMissionControl() {
  await refreshAllData();

  state.refreshTimer = window.setInterval(refreshAllData, REFRESH_INTERVAL_SECONDS * 1000);

  state.countdownTimer = window.setInterval(() => {
    state.nextRefresh = Math.max(0, state.nextRefresh - 1);
    elements.refreshCountdown.textContent = `${state.nextRefresh}s`;
  }, 1000);

  state.eventTimer = window.setInterval(addMissionHeartbeat, 8500);
}

async function refreshAllData() {
  state.nextRefresh = REFRESH_INTERVAL_SECONDS;
  elements.refreshCountdown.textContent = `${state.nextRefresh}s`;

  const [aircraftPayload, spaceWeatherPayload] = await Promise.all([
    fetchAircraftData(),
    fetchSpaceWeatherData()
  ]);

  state.aircraft = normalizeAircraft(aircraftPayload.data);
  state.anomalies = detectAnomalies(state.aircraft);
  state.usingFallback = aircraftPayload.fallback || spaceWeatherPayload.fallback;

  renderAircraft(aircraftPayload);
  renderSpaceWeather(spaceWeatherPayload);
  renderRisk();
  renderConnectionState();
}

async function fetchAircraftData() {
  try {
    const response = await fetch(OPEN_SKY_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`OpenSky HTTP ${response.status}`);
    }

    const data = await response.json();
    addTerminalEvent("API", "OpenSky Network sincronizado com sucesso.");
    return { data, fallback: false, source: "OpenSky Network API" };
  } catch (error) {
    addTerminalEvent("WARN", `OpenSky indisponível. Fallback local ativado: ${error.message}`);
    const fallback = await fetchJson(AIRCRAFT_FALLBACK_URL, BUILT_IN_AIRCRAFT_FALLBACK);
    return { data: fallback, fallback: true, source: "Fallback JSON" };
  }
}

async function fetchSpaceWeatherData() {
  try {
    const [kpResponse, fluxResponse] = await Promise.all([
      fetch(NOAA_KP_URL, { cache: "no-store" }),
      fetch(NOAA_SOLAR_FLUX_URL, { cache: "no-store" })
    ]);

    if (!kpResponse.ok || !fluxResponse.ok) {
      throw new Error("NOAA/SWPC HTTP error");
    }

    const kpData = await kpResponse.json();
    const fluxData = await fluxResponse.json();

    addTerminalEvent("API", "NOAA/SWPC sincronizado com sucesso.");

    return {
      data: normalizeSpaceWeather(kpData, fluxData),
      fallback: false,
      source: "NOAA/SWPC"
    };
  } catch (error) {
    addTerminalEvent("WARN", `NOAA/SWPC indisponível. Fallback local ativado: ${error.message}`);
    const fallback = await fetchJson(SPACE_FALLBACK_URL, BUILT_IN_SPACE_FALLBACK);
    return { data: fallback, fallback: true, source: "Fallback JSON" };
  }
}

async function fetchJson(url, builtInFallback) {
  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Falha ao carregar ${url}`);
    }

    return response.json();
  } catch (error) {
    addTerminalEvent("WARN", `Fallback interno ativado: ${error.message}`);
    return builtInFallback;
  }
}

function normalizeAircraft(payload) {
  const states = Array.isArray(payload.states) ? payload.states : [];

  return states
    .map((item) => ({
      icao24: item[0],
      callsign: String(item[1] || "UNKNOWN").trim() || "UNKNOWN",
      country: item[2] || "N/A",
      longitude: toNumber(item[5]),
      latitude: toNumber(item[6]),
      altitude: toNumber(item[7] || item[13]),
      velocity: toNumber(item[9]),
      heading: toNumber(item[10]),
      verticalRate: toNumber(item[11])
    }))
    .filter((aircraft) => Number.isFinite(aircraft.latitude) && Number.isFinite(aircraft.longitude))
    .slice(0, 160);
}

function normalizeSpaceWeather(kpData, fluxData) {
  const latestKp = kpData[kpData.length - 1] || [];
  const latestFlux = fluxData[fluxData.length - 1] || {};
  const kp = Number(latestKp[1] || latestKp.kp_index || 0);
  const solarFlux = Number(latestFlux.observed_flux || latestFlux.f107 || 0);

  return {
    kpIndex: Number.isFinite(kp) ? kp : 0,
    solarFlux: Number.isFinite(solarFlux) ? solarFlux : 0,
    stormLevel: classifyStorm(kp),
    summary: buildSpaceSummary(kp, solarFlux)
  };
}

function detectAnomalies(aircraft) {
  return aircraft.filter((item) => {
    const speedKmh = item.velocity * 3.6;
    const altitudeMeters = item.altitude || 0;
    const verticalRate = Math.abs(item.verticalRate || 0);

    return speedKmh > 980 || altitudeMeters > 12500 || verticalRate > 25;
  });
}

function classifyAircraftRisk(aircraft) {
  const speedKmh = aircraft.velocity * 3.6;
  const altitudeMeters = aircraft.altitude || 0;
  const verticalRate = Math.abs(aircraft.verticalRate || 0);

  if (speedKmh > 1100 || altitudeMeters > 14000 || verticalRate > 35) {
    return "alto";
  }

  if (speedKmh > 900 || altitudeMeters > 11000 || verticalRate > 20) {
    return "medio";
  }

  return "baixo";
}

function renderAircraft(payload) {
  elements.aircraftCount.textContent = state.aircraft.length;
  elements.aircraftSource.textContent = payload.source;

  renderRadarBlips();
  renderAircraftTable();

  const anomalyMessage = state.anomalies.length
    ? `${state.anomalies.length} anomalia(s) detectada(s) na telemetria.`
    : "Nenhuma anomalia crítica detectada.";

  addTerminalEvent(
    state.anomalies.length ? "ALERT" : "SCAN",
    anomalyMessage,
    state.anomalies.length > 0
  );
}

function renderRadarBlips() {
  elements.radarScope.querySelectorAll(".radar-blip").forEach((node) => node.remove());

  state.aircraft.slice(0, 28).forEach((aircraft) => {
    const blip = document.createElement("span");
    const risk = classifyAircraftRisk(aircraft);
    const x = ((aircraft.longitude + 180) / 360) * 100;
    const y = (1 - ((aircraft.latitude + 90) / 180)) * 100;

    blip.className = `radar-blip ${risk === "medio" ? "medium" : risk === "alto" ? "high" : ""}`;
    blip.style.left = `${clamp(x, 8, 92)}%`;
    blip.style.top = `${clamp(y, 8, 92)}%`;
    blip.title = `${aircraft.callsign} · ${risk.toUpperCase()}`;

    elements.radarScope.appendChild(blip);
  });
}

function renderAircraftTable() {
  const rows = state.aircraft.slice(0, MAX_AIRCRAFT_ROWS).map((aircraft) => {
    const risk = classifyAircraftRisk(aircraft);

    return `
      <tr>
        <td>${escapeHtml(aircraft.callsign)}</td>
        <td>${formatNumber(aircraft.latitude, 3)}</td>
        <td>${formatNumber(aircraft.longitude, 3)}</td>
        <td>${formatNumber(aircraft.altitude, 0)} m</td>
        <td>${formatNumber(aircraft.velocity * 3.6, 0)} km/h</td>
        <td>${risk}</td>
      </tr>
    `;
  });

  elements.aircraftTable.innerHTML = rows.length
    ? rows.join("")
    : '<tr><td colspan="6">Nenhuma aeronave com coordenadas válidas no ciclo atual.</td></tr>';
}

function renderSpaceWeather(payload) {
  const data = payload.data;

  elements.spaceSource.textContent = payload.source;
  elements.kpIndex.textContent = formatNumber(data.kpIndex, 1);
  elements.solarFlux.textContent = data.solarFlux ? formatNumber(data.solarFlux, 1) : "--";
  elements.stormLevel.textContent = data.stormLevel;
  elements.spaceSummary.textContent = data.summary;
}

function renderRisk() {
  const anomalyRatio = state.aircraft.length ? state.anomalies.length / state.aircraft.length : 0;
  let level = "Baixo";
  let className = "metric-card risk-low";
  let reason = "Sistema nominal";

  if (state.anomalies.length >= 8 || anomalyRatio > 0.16) {
    level = "Alto";
    className = "metric-card risk-high";
    reason = "Múltiplas anomalias simultâneas";
  } else if (state.anomalies.length >= 2 || anomalyRatio > 0.06) {
    level = "Médio";
    className = "metric-card risk-medium";
    reason = "Padrões incomuns em observação";
  }

  elements.anomalyCount.textContent = state.anomalies.length;
  elements.riskLevel.textContent = level;
  elements.riskReason.textContent = reason;
  elements.riskCard.className = className;
}

function renderConnectionState() {
  elements.connectionStatus.classList.toggle("is-fallback", state.usingFallback);
  elements.connectionStatus.lastChild.textContent = state.usingFallback ? " Fallback" : " Online";
}

function addTerminalEvent(type, message, alert = false) {
  const line = document.createElement("div");

  line.className = `terminal-line ${alert ? "alert" : ""}`;
  line.innerHTML = `<strong>${new Date().toISOString().slice(11, 19)}</strong><span>[${type}] ${escapeHtml(message)}</span>`;

  elements.eventTerminal.prepend(line);

  while (elements.eventTerminal.children.length > 80) {
    elements.eventTerminal.removeChild(elements.eventTerminal.lastChild);
  }
}

function addMissionHeartbeat() {
  const events = [
    ["SYS", "Varredura de integridade HUD concluída."],
    ["RADAR", "Sweep tático sincronizado com a malha de telemetria."],
    ["LINK", "Canal de dados em observação contínua."],
    ["NAV", "Referência geoespacial recalibrada."],
    ["AI", "Modelo de anomalias aguardando novo pacote de sinais."]
  ];

  const event = events[Math.floor(Math.random() * events.length)];

  addTerminalEvent(event[0], event[1]);
}

function classifyStorm(kp) {
  if (kp >= 7) {
    return "Forte";
  }

  if (kp >= 5) {
    return "Moderada";
  }

  return "Nominal";
}

function buildSpaceSummary(kp, solarFlux) {
  const storm = classifyStorm(kp);

  return `Kp ${formatNumber(kp, 1)} com condição ${storm.toLowerCase()}. Fluxo solar observado em ${formatNumber(solarFlux, 1)} sfu.`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "--";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
