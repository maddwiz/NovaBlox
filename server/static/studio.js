"use strict";

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

  const recognition = new Speech();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  state.recognition = recognition;

  recognition.onstart = () => {
    state.listening = true;
    el.voiceBtn.className = "btn-danger";
    el.voiceBtn.textContent = "Listening...";
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
  };

  recognition.onerror = (event) => {
    log(`voice error: ${event.error || "unknown"}`, true);
  };

  recognition.onend = () => {
    state.listening = false;
    el.voiceBtn.className = "btn-secondary";
    el.voiceBtn.textContent = "Voice Input";
  };

  el.voiceBtn.addEventListener("click", () => {
    if (state.listening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });
}

el.template.addEventListener("change", () =>
  pickTemplate(el.template.value || ""),
);
el.healthBtn.addEventListener("click", checkHealth);
el.planBtn.addEventListener("click", generatePlan);
el.queueBtn.addEventListener("click", queuePlan);
el.apiKey.addEventListener("change", loadTemplates);

setupVoice();
loadTemplates();
checkHealth();
