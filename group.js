const APP_STATE_KEY = "ticktogether.sharedTimerState";
const CURRENT_GROUP_KEY = "ticktogether.currentGroupCode";
const GROUP_DATA_PREFIX = "ticktogether.groupData.";
const DEVICE_ID_KEY = "ticktogether.deviceId";

const groupNameEl = document.querySelector("#group-name");
const groupCodeEl = document.querySelector("#group-code");
const memberCountEl = document.querySelector("#member-count");
const memberListEl = document.querySelector("#member-list");
const activeAlarmsEl = document.querySelector("#active-alarms");
const historyListEl = document.querySelector("#history-list");
const statusEl = document.querySelector("#status");
const leaveTopButton = document.querySelector("#leave-group-top");
const copyCodeButton = document.querySelector("#copy-code");

const modal = document.querySelector("#timer-modal");
const openModalButton = document.querySelector("#open-modal");
const closeModalButton = document.querySelector("#close-modal");
const alarmForm = document.querySelector("#alarm-form");
const presetWrap = document.querySelector("#preset-wrap");
const customMinInput = document.querySelector("#custom-min");
const customSecInput = document.querySelector("#custom-sec");
const messageInput = document.querySelector("#alarm-message");
const recipientListEl = document.querySelector("#recipient-list");
const selectAllButton = document.querySelector("#select-all");

const alarmPopupEl = document.querySelector("#alarm-popup");
const alarmPopupMessageEl = document.querySelector("#alarm-popup-message");
const taskDoneButton = document.querySelector("#task-done");
const muteAlarmButton = document.querySelector("#mute-alarm");

const deviceId = ensureDeviceId();
const state = loadAppState();
const group = getActiveGroup();
let groupData = loadGroupData(group.code);
let ringingAlarmId = null;
let alarmAudioContext;
let alarmOscillator;
let alarmGain;

renderAll();
startTicker();
syncPopupWithCurrentState();

window.addEventListener("click", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });
window.addEventListener("storage", (event) => {
  if (event.key === `${GROUP_DATA_PREFIX}${group.code}`) {
    groupData = loadGroupData(group.code);
    renderAll();
    syncPopupWithCurrentState();
  }
});

openModalButton.addEventListener("click", () => {
  modal.showModal();
});

closeModalButton.addEventListener("click", () => modal.close());

presetWrap.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-minutes]");
  if (!button) {
    return;
  }

  const minutes = Number(button.dataset.minutes || 0);
  customMinInput.value = String(minutes);
  customSecInput.value = "0";

  [...presetWrap.querySelectorAll("button")].forEach((entry) => entry.classList.remove("active"));
  button.classList.add("active");
});

selectAllButton.addEventListener("click", () => {
  const checkboxes = recipientListEl.querySelectorAll("input[type='checkbox']");
  const shouldSelect = [...checkboxes].some((box) => !box.checked);
  checkboxes.forEach((box) => {
    box.checked = shouldSelect;
  });
});

alarmForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const durationSec = Number(customMinInput.value || 0) * 60 + Number(customSecInput.value || 0);
  if (durationSec < 1) {
    setStatus("Please choose a timer duration greater than 0.");
    return;
  }

  const selectedRecipients = [...recipientListEl.querySelectorAll("input[type='checkbox']:checked")].map(
    (entry) => entry.value
  );

  if (!selectedRecipients.length) {
    setStatus("Select at least one member to send the alarm.");
    return;
  }

  const alarm = {
    id: crypto.randomUUID(),
    message: messageInput.value.trim() || "Untitled alarm",
    createdBy: "You",
    recipients: selectedRecipients,
    totalSec: durationSec,
    remainingSec: durationSec,
    createdAt: Date.now(),
    status: "running",
    mutedBy: []
  };

  groupData.activeAlarms.unshift(alarm);
  persistGroupData();
  renderAlarms();
  setStatus(`Timer created for ${formatDuration(durationSec)}.`);
  alarmForm.reset();
  customMinInput.value = "5";
  customSecInput.value = "0";
  modal.close();
});

taskDoneButton.addEventListener("click", () => {
  const alarm = getCurrentRingingAlarm();
  if (!alarm) {
    hideAlarmPopup();
    return;
  }

  completeAlarmForEveryone(alarm, "You");
  setStatus(`Task completed for "${alarm.message}" by You.`);
});

muteAlarmButton.addEventListener("click", () => {
  const alarm = getCurrentRingingAlarm();
  if (!alarm) {
    hideAlarmPopup();
    return;
  }

  if (!Array.isArray(alarm.mutedBy)) {
    alarm.mutedBy = [];
  }
  if (!alarm.mutedBy.includes(deviceId)) {
    alarm.mutedBy.push(deviceId);
  }

  persistGroupData();
  renderAlarms();
  syncPopupWithCurrentState();
  setStatus(`Muted alarm on this device for "${alarm.message}".`);
});

leaveTopButton.addEventListener("click", leaveGroup);

copyCodeButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(group.code);
    setStatus("Group code copied.");
  } catch {
    setStatus(`Group code: ${group.code}`);
  }
});

function loadAppState() {
  const raw = localStorage.getItem(APP_STATE_KEY);
  const fallback = {
    availableGroups: [
      { code: "8AC03F", name: "Demo" },
      { code: "E9FE43", name: "Demo Again" }
    ],
    myGroupCodes: ["8AC03F", "E9FE43"]
  };

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.availableGroups || !parsed.myGroupCodes) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function getActiveGroup() {
  const params = new URLSearchParams(window.location.search);
  const paramCode = params.get("code")?.toUpperCase();
  const savedCode = localStorage.getItem(CURRENT_GROUP_KEY)?.toUpperCase();
  const code = paramCode || savedCode || state.myGroupCodes[0];
  const activeGroup = state.availableGroups.find((entry) => entry.code === code);

  if (!activeGroup || !state.myGroupCodes.includes(activeGroup.code)) {
    window.location.href = "index.html";
    throw new Error("Not in this group");
  }

  localStorage.setItem(CURRENT_GROUP_KEY, activeGroup.code);
  return activeGroup;
}

function loadGroupData(code) {
  const raw = localStorage.getItem(`${GROUP_DATA_PREFIX}${code}`);
  const defaultMembers = ["You", "Abhishek", "Ishna", "Ammaar", "Shristy"];

  if (!raw) {
    const initialData = {
      members: [...defaultMembers],
      activeAlarms: [],
      history:
        code === "8AC03F"
          ? [
              {
                id: crypto.randomUUID(),
                message: "Welcome timer",
                createdBy: "Abhishek",
                recipients: ["You", "Ishna"],
                durationSec: 20,
                completedBy: "Abhishek",
                createdAt: Date.now() - 172800000
              }
            ]
          : []
    };
    localStorage.setItem(`${GROUP_DATA_PREFIX}${code}`, JSON.stringify(initialData));
    return initialData;
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      members: Array.isArray(parsed.members) ? parsed.members : defaultMembers,
      activeAlarms: Array.isArray(parsed.activeAlarms)
        ? parsed.activeAlarms.map((alarm) => normalizeAlarm(alarm))
        : [],
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch {
    return { members: defaultMembers, activeAlarms: [], history: [] };
  }
}

function normalizeAlarm(alarm) {
  const remainingSec = Number(alarm.remainingSec || 0);
  return {
    ...alarm,
    remainingSec,
    totalSec: Number(alarm.totalSec || remainingSec || 0),
    status: alarm.status || (remainingSec > 0 ? "running" : "ringing"),
    mutedBy: Array.isArray(alarm.mutedBy) ? alarm.mutedBy : []
  };
}

function persistGroupData() {
  localStorage.setItem(`${GROUP_DATA_PREFIX}${group.code}`, JSON.stringify(groupData));
}

function renderAll() {
  groupNameEl.textContent = group.name;
  groupCodeEl.textContent = group.code;
  renderMembers();
  renderAlarms();
  renderHistory();
}

function renderMembers() {
  memberListEl.innerHTML = "";
  groupData.members.forEach((member) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = member;
    memberListEl.append(chip);
  });

  memberCountEl.textContent = String(groupData.members.length);

  recipientListEl.innerHTML = "";
  groupData.members.forEach((member, index) => {
    const id = `recipient-${index}`;
    const row = document.createElement("label");
    row.htmlFor = id;
    row.innerHTML = `<input id="${id}" type="checkbox" value="${member}" checked /> ${member}`;
    recipientListEl.append(row);
  });
}

function renderAlarms() {
  activeAlarmsEl.innerHTML = "";
  if (!groupData.activeAlarms.length) {
    activeAlarmsEl.innerHTML = '<div class="alarm-card">No running timers.</div>';
    return;
  }

  groupData.activeAlarms.forEach((alarm) => {
    const card = document.createElement("article");
    card.className = "alarm-card";
    const stateText = alarm.status === "ringing" ? "RINGING" : "RUNNING";
    card.innerHTML = `
      <div class="timer-ring">${formatDuration(alarm.remainingSec)}</div>
      <div>
        <h3 class="alarm-title">${escapeHtml(alarm.message)}</h3>
        <p class="meta">${stateText} · by ${escapeHtml(alarm.createdBy)}</p>
        <div class="chips">${alarm.recipients
          .map((recipient) => `<span class="chip">${escapeHtml(recipient)}</span>`)
          .join("")}</div>
      </div>
    `;
    activeAlarmsEl.append(card);
  });
}

function renderHistory() {
  historyListEl.innerHTML = "";

  groupData.history.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "history-card";
    const doneByText = entry.completedBy ? ` · task done by ${escapeHtml(entry.completedBy)}` : "";
    card.innerHTML = `
      <div class="inline-row">
        <h3 class="history-title">${escapeHtml(entry.message)}</h3>
        <p class="meta">${formatDuration(entry.durationSec)}</p>
      </div>
      <p class="meta">by ${escapeHtml(entry.createdBy)} · ${formatRelative(entry.createdAt)}${doneByText}</p>
      <div class="chips">${entry.recipients
        .map((recipient) => `<span class="chip">${escapeHtml(recipient)}</span>`)
        .join("")}</div>
    `;
    historyListEl.append(card);
  });
}

function startTicker() {
  window.setInterval(() => {
    if (!groupData.activeAlarms.length) {
      syncPopupWithCurrentState();
      return;
    }

    let changed = false;
    groupData.activeAlarms.forEach((alarm) => {
      if (alarm.status === "running" && alarm.remainingSec > 0) {
        alarm.remainingSec -= 1;
        changed = true;
      }

      if (alarm.status === "running" && alarm.remainingSec <= 0) {
        alarm.remainingSec = 0;
        alarm.status = "ringing";
        alarm.mutedBy = Array.isArray(alarm.mutedBy) ? alarm.mutedBy : [];
        changed = true;
      }
    });

    if (changed) {
      persistGroupData();
      renderAlarms();
    }

    syncPopupWithCurrentState();
  }, 1000);
}

function syncPopupWithCurrentState() {
  const alarm = getCurrentRingingAlarm();
  if (!alarm) {
    hideAlarmPopup();
    return;
  }

  ringingAlarmId = alarm.id;
  alarmPopupMessageEl.textContent = `"${alarm.message}" is ringing for ${formatDuration(
    alarm.totalSec
  )}.`; 
  alarmPopupEl.classList.remove("hidden");
  startLocalAlarmTone();
}

function getCurrentRingingAlarm() {
  return groupData.activeAlarms.find((alarm) => {
    if (alarm.status !== "ringing") {
      return false;
    }
    const mutedBy = Array.isArray(alarm.mutedBy) ? alarm.mutedBy : [];
    return !mutedBy.includes(deviceId);
  });
}

function completeAlarmForEveryone(alarm, completedBy) {
  groupData.history.unshift({
    id: alarm.id,
    message: alarm.message,
    createdBy: alarm.createdBy,
    recipients: alarm.recipients,
    durationSec: alarm.totalSec,
    completedBy,
    createdAt: Date.now()
  });

  groupData.activeAlarms = groupData.activeAlarms.filter((entry) => entry.id !== alarm.id);
  persistGroupData();
  renderAlarms();
  renderHistory();
  hideAlarmPopup();
}

function hideAlarmPopup() {
  ringingAlarmId = null;
  alarmPopupEl.classList.add("hidden");
  stopLocalAlarmTone();
}

function unlockAudio() {
  ensureAudioContext();
  if (!alarmAudioContext) {
    return;
  }

  if (alarmAudioContext.state === "suspended") {
    alarmAudioContext.resume().catch(() => {
      // ignore
    });
  }
}

function ensureAudioContext() {
  if (alarmAudioContext) {
    return;
  }
  if (!window.AudioContext && !window.webkitAudioContext) {
    return;
  }

  const Ctx = window.AudioContext || window.webkitAudioContext;
  alarmAudioContext = new Ctx();
}

function startLocalAlarmTone() {
  ensureAudioContext();
  if (!alarmAudioContext) {
    return;
  }
  if (alarmOscillator) {
    return;
  }

  if (alarmAudioContext.state === "suspended") {
    alarmAudioContext.resume().catch(() => {
      // user gesture may be needed
    });
  }

  alarmOscillator = alarmAudioContext.createOscillator();
  alarmGain = alarmAudioContext.createGain();
  alarmOscillator.type = "sine";
  alarmOscillator.frequency.value = 880;
  alarmGain.gain.value = 0.12;
  alarmOscillator.connect(alarmGain);
  alarmGain.connect(alarmAudioContext.destination);
  alarmOscillator.start();
}

function stopLocalAlarmTone() {
  if (!alarmOscillator) {
    return;
  }

  alarmOscillator.stop();
  alarmOscillator.disconnect();
  alarmGain.disconnect();
  alarmOscillator = null;
  alarmGain = null;
}

function ensureDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function leaveGroup() {
  state.myGroupCodes = state.myGroupCodes.filter((entry) => entry !== group.code);
  localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
  localStorage.removeItem(CURRENT_GROUP_KEY);
  stopLocalAlarmTone();
  window.location.href = "index.html";
}

function formatDuration(totalSec) {
  const minutes = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatRelative(timestamp) {
  const days = Math.max(1, Math.floor((Date.now() - timestamp) / 86400000));
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message) {
  statusEl.textContent = message;
}
