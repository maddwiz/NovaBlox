"use strict";

const API_KEY_STORAGE_KEY = "novablox_studio_api_key";
const MAX_VOICE_LISTEN_MS = 8000;

const el = {
  apiKey: document.getElementById("apiKey"),
  healthBtn: document.getElementById("healthBtn"),
  prompt: document.getElementById("prompt"),
  template: document.getElementById("template"),
  templateCards: document.getElementById("templateCards"),
  voiceBtn: document.getElementById("voiceBtn"),
  planBtn: document.getElementById("planBtn"),
  queueBtn: document.getElementById("queueBtn"),
  allowDangerous: document.getElementById("allowDangerous"),
  riskRow: document.getElementById("riskRow"),
  planMeta: document.getElementById("planMeta"),
  commands: document.getElementById("commands"),
  log: document.getElementById("log"),
};

const state = {
  templates: [],
  plan: null,
  listening: false,
  recognition: null,
  voiceTimer: null,
  voiceForceAbortTimer: null,
  voiceStopRequested: false,
  suppressAbortError: false,
};

function log(message, isError = false) {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  line.style.color = isError ? "#8a1f1f" : "#20323f";
  el.log.prepend(line);
}

function headers() {
  const out = { "Content-Type": "application/json" };
  const key = el.apiKey.value.trim();
  if (key) {
    out["X-API-Key"] = key;
  }
  return out;
}

function parseApiKeyFromHash() {
  const hash = window.location.hash || "";
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return "";
  }
  const params = new URLSearchParams(normalized);
  return (
    params.get("api_key") ||
    params.get("novablox_api_key") ||
    params.get("key") ||
    ""
  ).trim();
}

function saveApiKey(key) {
  try {
    const value = (key || "").trim();
    if (!value) {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(API_KEY_STORAGE_KEY, value);
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

function loadStoredApiKey() {
  try {
    return (localStorage.getItem(API_KEY_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function initializeApiKey() {
  const hashKey = parseApiKeyFromHash();
  if (hashKey) {
    el.apiKey.value = hashKey;
    saveApiKey(hashKey);
    // Remove key fragment from URL so it doesn't linger in history.
    try {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    } catch {
      // Ignore history API failures.
    }
    log("API key auto-filled from one-click setup.");
    return;
  }

  const storedKey = loadStoredApiKey();
  if (storedKey) {
    el.apiKey.value = storedKey;
  }
}

function setVoiceButtonIdle() {
  el.voiceBtn.className = "btn-secondary";
  el.voiceBtn.textContent = "Voice Input";
}

function clearVoiceTimer() {
  if (state.voiceTimer) {
    clearTimeout(state.voiceTimer);
    state.voiceTimer = null;
  }
}

function clearVoiceForceAbortTimer() {
  if (state.voiceForceAbortTimer) {
    clearTimeout(state.voiceForceAbortTimer);
    state.voiceForceAbortTimer = null;
  }
}

function finalizeVoiceSession() {
  clearVoiceTimer();
  clearVoiceForceAbortTimer();
  state.listening = false;
  state.voiceStopRequested = false;
  state.suppressAbortError = false;
  state.recognition = null;
  setVoiceButtonIdle();
}

function stopVoiceSession(reason = "") {
  if (!state.recognition) {
    finalizeVoiceSession();
    return;
  }
  if (!state.listening) {
    setVoiceButtonIdle();
    return;
  }
  clearVoiceTimer();
  state.voiceStopRequested = true;
  state.suppressAbortError = reason !== "error";
  try {
    state.recognition.stop();
  } catch {
    // Ignore browser-specific SpeechRecognition stop errors.
  }
  clearVoiceForceAbortTimer();
  state.voiceForceAbortTimer = setTimeout(() => {
    if (!state.listening || !state.recognition) {
      return;
    }
    try {
      state.recognition.abort();
    } catch {
      // Ignore browser-specific SpeechRecognition abort errors.
    }
  }, 1200);
  setVoiceButtonIdle();
}

async function fetchJson(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function riskPill(label, count, className = "") {
  const span = document.createElement("span");
  span.className = `pill ${className}`.trim();
  span.textContent = `${label}: ${count}`;
  return span;
}

function renderPlan(plan) {
  state.plan = plan;
  el.commands.innerHTML = "";
  el.riskRow.innerHTML = "";

  if (!plan) {
    el.planMeta.textContent = "No plan generated yet.";
    return;
  }

  const risk = plan.risk_summary || {
    safe: 0,
    caution: 0,
    dangerous: 0,
    max_risk: "safe",
  };
  el.riskRow.append(
    riskPill("Safe", risk.safe),
    riskPill("Caution", risk.caution, "warn"),
    riskPill("Danger", risk.dangerous, "bad"),
  );

  el.planMeta.textContent = `${plan.title} • ${plan.workflow.template} • ${plan.commands.length} commands`;

  plan.commands.forEach((command, index) => {
    const card = document.createElement("article");
    card.className = "command";

    const riskClass = `risk-${command.risk || "safe"}`;
    card.innerHTML = `
      <div class="command-head">
        <strong>${index + 1}. ${command.action}</strong>
        <span class="badge ${riskClass}">${command.risk || "safe"}</span>
      </div>
      <div class="mono">${command.route}</div>
      <div class="subtle">${command.reason || ""}</div>
    `;
    el.commands.appendChild(card);
  });

  if (Array.isArray(plan.warnings) && plan.warnings.length > 0) {
    plan.warnings.forEach((warning) => log(`warning: ${warning}`, true));
  }
}

function pickTemplate(id) {
  el.template.value = id || "";
  [...el.templateCards.querySelectorAll("button")].forEach((button) => {
    button.classList.toggle("active", button.dataset.templateId === id);
  });
}

async function loadTemplates() {
  try {
    const data = await fetchJson("/bridge/planner/templates", {
      headers: headers(),
    });
    state.templates = Array.isArray(data.templates) ? data.templates : [];

    el.template.innerHTML = `<option value="">Auto Detect</option>`;
    el.templateCards.innerHTML = "";

    state.templates.forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.label;
      el.template.appendChild(option);

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "template-chip";
      chip.dataset.templateId = template.id;
      chip.textContent = `${template.label}\n${template.description}`;
      chip.addEventListener("click", () => pickTemplate(template.id));
      el.templateCards.appendChild(chip);
    });
  } catch (err) {
    log(`template load failed: ${err.message}`, true);
  }
}

async function checkHealth() {
  try {
    const health = await fetchJson("/bridge/health", { headers: headers() });
    const queue = health.queue || {};
    log(
      `health ok | queued=${queue.pending_count || 0} total=${queue.total_commands || 0}`,
    );
  } catch (err) {
    log(`health failed: ${err.message}`, true);
  }
}

async function generatePlan() {
  try {
    const body = {
      prompt: el.prompt.value,
      template: el.template.value || undefined,
      voice_mode: state.listening,
    };
    const data = await fetchJson("/bridge/assistant/plan", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    renderPlan(data.plan);
    log(
      `plan generated: ${data.plan.workflow.template} (${data.plan.commands.length} commands)`,
    );
  } catch (err) {
    log(`plan failed: ${err.message}`, true);
  }
}

async function queuePlan() {
  if (!state.plan) {
    log("no plan available to queue", true);
    return;
  }

  try {
    const data = await fetchJson("/bridge/assistant/execute", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        plan: state.plan,
        allow_dangerous: el.allowDangerous.checked,
      }),
    });
    log(`queued ${data.queued_count} commands | deduped=${data.deduped_count}`);
  } catch (err) {
    log(`queue failed: ${err.message}`, true);
  }
}

function setupVoice() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    el.voiceBtn.disabled = true;
    el.voiceBtn.title = "SpeechRecognition API unavailable in this browser";
    return;
  }

  function createRecognition() {
    const recognition = new Speech();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      state.listening = true;
      state.voiceStopRequested = false;
      state.suppressAbortError = false;
      el.voiceBtn.className = "btn-danger";
      el.voiceBtn.textContent = "Listening...";
      clearVoiceTimer();
      state.voiceTimer = setTimeout(() => {
        if (!state.listening) {
          return;
        }
        log("voice input timed out, stopping mic");
        stopVoiceSession("timeout");
      }, MAX_VOICE_LISTEN_MS);
    };

    recognition.onresult = (event) => {
      const text =
        (event.results &&
          event.results[0] &&
          event.results[0][0] &&
          event.results[0][0].transcript) ||
        "";
      if (text) {
        el.prompt.value = text;
        log(`voice captured: ${text}`);
      }
      stopVoiceSession("captured");
    };

    recognition.onerror = (event) => {
      const errorCode = event.error || "unknown";
      const isExpectedAbort =
        errorCode === "aborted" &&
        (state.suppressAbortError || state.voiceStopRequested);
      if (!isExpectedAbort) {
        log(`voice error: ${errorCode}`, true);
      }
      finalizeVoiceSession();
    };

    recognition.onend = () => {
      finalizeVoiceSession();
    };

    return recognition;
  }

  el.voiceBtn.addEventListener("click", () => {
    if (state.listening) {
      stopVoiceSession("manual");
    } else {
      state.recognition = createRecognition();
      try {
        state.recognition.start();
      } catch (err) {
        log(`voice start failed: ${err.message || err}`, true);
        finalizeVoiceSession();
      }
    }
  });
}

el.template.addEventListener("change", () =>
  pickTemplate(el.template.value || ""),
);
el.healthBtn.addEventListener("click", checkHealth);
el.planBtn.addEventListener("click", generatePlan);
el.queueBtn.addEventListener("click", queuePlan);
el.apiKey.addEventListener("input", () => {
  saveApiKey(el.apiKey.value);
});
el.apiKey.addEventListener("change", () => {
  saveApiKey(el.apiKey.value);
  loadTemplates();
});

initializeApiKey();
setupVoice();
loadTemplates();
checkHealth();

window.addEventListener("beforeunload", () => {
  stopVoiceSession("unload");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopVoiceSession("hidden");
  }
});
