import { supabase, ensureSession } from "./supabaseClient.js";

const CURRENT_GROUP_KEY = "ticktogether.currentGroupCode";
const DEVICE_ID_KEY = "ticktogether.deviceId";
const DEVICE_MEMBER_NAME_KEY = "ticktogether.deviceMemberName";

const groupNameEl = document.querySelector("#group-name");
const groupCodeEl = document.querySelector("#group-code");
const memberCountEl = document.querySelector("#member-count");
const memberListEl = document.querySelector("#member-list");
const activeAlarmsEl = document.querySelector("#active-alarms");
const historyListEl = document.querySelector("#history-list");
const statusEl = document.querySelector("#status");
const leaveTopButton = document.querySelector("#leave-group-top");
const deleteGroupButton = document.querySelector("#delete-group-top");
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
const startTimerButton = document.querySelector("#start-timer");

const alarmPopupEl = document.querySelector("#alarm-popup");
const alarmPopupMessageEl = document.querySelector("#alarm-popup-message");
const taskDoneButton = document.querySelector("#task-done");
const muteAlarmButton = document.querySelector("#mute-alarm");

let authUser = null;
const deviceId = ensureDeviceId();
const currentMemberName = getCurrentMemberNameOrRedirect();

let group = null;
let members = [];
let alarms = [];
let ringingAlarmId = null;
let alarmAudioContext;
let alarmOscillator;
let alarmGain;
let realtimeChannel = null;

await init();

async function init() {
  try {
    await ensureSession();
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw error || new Error("Could not load auth user.");
    }

    authUser = user;
    group = await getActiveGroupFromDb();
    groupNameEl.textContent = group.name;
    groupCodeEl.textContent = group.code;

    if (group.created_by_user_id === authUser.id) {
      deleteGroupButton.hidden = false;
    }

    await ensureCurrentMemberJoined();
    await refreshAll();
    subscribeRealtime();
    startTicker();
    syncPopupWithCurrentState();
    updateStartTimerButton();
  } catch (error) {
    setStatus(error.message);
    window.location.href = "index.html";
  }
}

window.addEventListener("click", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });
window.addEventListener("beforeunload", () => {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }
});

openModalButton.addEventListener("click", () => modal.showModal());
closeModalButton.addEventListener("click", () => modal.close());

presetWrap.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-minutes]");
  if (!button) return;

  const minutes = Number(button.dataset.minutes || 0);
  customMinInput.value = String(minutes);
  customSecInput.value = "0";

  [...presetWrap.querySelectorAll("button")].forEach((entry) => entry.classList.remove("active"));
  button.classList.add("active");
  updateStartTimerButton();
});

customMinInput.addEventListener("input", updateStartTimerButton);
customSecInput.addEventListener("input", updateStartTimerButton);
messageInput.addEventListener("input", updateStartTimerButton);
recipientListEl.addEventListener("change", updateStartTimerButton);

selectAllButton.addEventListener("click", () => {
  const checkboxes = recipientListEl.querySelectorAll("input[type='checkbox']");
  const shouldSelect = [...checkboxes].some((box) => !box.checked);
  checkboxes.forEach((box) => {
    box.checked = shouldSelect;
  });
  updateStartTimerButton();
});

alarmForm.addEventListener("submit", async (event) => {
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

  const endsAt = new Date(Date.now() + durationSec * 1000).toISOString();

  const { error } = await supabase.from("alarms").insert({
    group_code: group.code,
    message: messageInput.value.trim() || "Untitled alarm",
    created_by_name: currentMemberName,
    created_by_user_id: authUser.id,
    recipients: selectedRecipients,
    total_sec: durationSec,
    ends_at: endsAt,
    status: "running",
    muted_by: []
  });

  if (error) {
    setStatus(error.message);
    return;
  }

  setStatus(`Timer created for ${formatDuration(durationSec)}.`);
  alarmForm.reset();
  customMinInput.value = "5";
  customSecInput.value = "0";
  updateStartTimerButton();
  modal.close();
});

taskDoneButton.addEventListener("click", async () => {
  const alarm = getCurrentRingingAlarm();
  if (!alarm) {
    hideAlarmPopup();
    return;
  }

  const { error } = await supabase
    .from("alarms")
    .update({
      status: "completed",
      completed_by_name: currentMemberName,
      completed_at: new Date().toISOString()
    })
    .eq("id", alarm.id);

  if (error) {
    setStatus(error.message);
    return;
  }

  setStatus(`Task completed for "${alarm.message}" by ${currentMemberName}.`);
});

muteAlarmButton.addEventListener("click", async () => {
  const alarm = getCurrentRingingAlarm();
  if (!alarm) {
    hideAlarmPopup();
    return;
  }

  const muted = Array.isArray(alarm.muted_by) ? [...alarm.muted_by] : [];
  if (!muted.includes(deviceId)) muted.push(deviceId);

  const { error } = await supabase.from("alarms").update({ muted_by: muted }).eq("id", alarm.id);
  if (error) {
    setStatus(error.message);
    return;
  }

  setStatus(`Muted alarm on this device for "${alarm.message}".`);
});

leaveTopButton.addEventListener("click", leaveGroup);
deleteGroupButton.addEventListener("click", deleteGroup);

copyCodeButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(group.code);
    setStatus("Group code copied.");
  } catch {
    setStatus(`Group code: ${group.code}`);
  }
});

async function getActiveGroupFromDb() {
  const params = new URLSearchParams(window.location.search);
  const paramCode = params.get("code")?.toUpperCase();
  const savedCode = localStorage.getItem(CURRENT_GROUP_KEY)?.toUpperCase();
  const code = paramCode || savedCode;

  if (!code) {
    throw new Error("No group selected.");
  }

  const { data: membership, error: memErr } = await supabase
    .from("group_members")
    .select("group_code")
    .eq("group_code", code)
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (memErr || !membership) {
    throw new Error("You are not a member of this group.");
  }

  const { data: groupRow, error: groupErr } = await supabase
    .from("groups")
    .select("code, name, created_by_user_id")
    .eq("code", code)
    .maybeSingle();

  if (groupErr || !groupRow) {
    throw new Error("Group not found.");
  }

  localStorage.setItem(CURRENT_GROUP_KEY, groupRow.code);
  return groupRow;
}

async function ensureCurrentMemberJoined() {
  const { data, error } = await supabase
    .from("group_members")
    .select("group_code, user_id")
    .eq("group_code", group.code)
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Membership missing.");
  }

  await supabase
    .from("group_members")
    .update({ member_name: currentMemberName, device_id: deviceId })
    .eq("group_code", group.code)
    .eq("user_id", authUser.id);
}

async function refreshAll() {
  await Promise.all([refreshMembers(), refreshAlarms()]);
  renderAll();
}

async function refreshMembers() {
  const { data, error } = await supabase
    .from("group_members")
    .select("member_name, joined_at")
    .eq("group_code", group.code)
    .order("joined_at", { ascending: true });

  if (error) throw error;
  members = data || [];
}

async function refreshAlarms() {
  const { data, error } = await supabase
    .from("alarms")
    .select("*")
    .eq("group_code", group.code)
    .order("created_at", { ascending: false });

  if (error) throw error;
  alarms = data || [];
}

function subscribeRealtime() {
  realtimeChannel = supabase
    .channel(`group-${group.code}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "group_members", filter: `group_code=eq.${group.code}` },
      async () => {
        await refreshMembers();
        renderMembers();
        updateStartTimerButton();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "alarms", filter: `group_code=eq.${group.code}` },
      async () => {
        await refreshAlarms();
        renderAlarms();
        renderHistory();
        syncPopupWithCurrentState();
      }
    )
    .subscribe();
}

function renderAll() {
  renderMembers();
  renderAlarms();
  renderHistory();
}

function renderMembers() {
  memberListEl.innerHTML = "";
  const n = members.length;
  memberCountEl.textContent = `${n} member${n === 1 ? "" : "s"}`;

  members.forEach((member) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = member.member_name;
    memberListEl.append(chip);
  });

  recipientListEl.innerHTML = "";
  members.forEach((member, index) => {
    const id = `member-${index}`;
    const label = document.createElement("label");
    label.className = "recipient-option";
    label.innerHTML = `
      <input id="${id}" type="checkbox" value="${escapeHtml(member.member_name)}" />
      <span>${escapeHtml(member.member_name)}</span>
    `;
    recipientListEl.append(label);
  });
}

function renderAlarms() {
  activeAlarmsEl.innerHTML = "";
  const active = alarms.filter((alarm) => alarm.status !== "completed");

  if (!active.length) return;

  active.forEach((alarm) => {
    const remainingSec = getRemainingSec(alarm);
    const card = document.createElement("article");
    card.className = "alarm-card";
    card.innerHTML = `
      <div class="inline-row">
        <h3>${escapeHtml(alarm.message)}</h3>
        <p class="timer">${formatDuration(remainingSec)}</p>
      </div>
      <p class="meta">by ${escapeHtml(alarm.created_by_name)}</p>
      <div class="chips">${(alarm.recipients || []).map((r) => `<span class="chip">${escapeHtml(r)}</span>`).join("")}</div>
      <div class="actions">
        <button class="stop-all-btn" type="button">Stop For All</button>
      </div>
    `;

    card.querySelector(".stop-all-btn").addEventListener("click", async () => {
      const { error } = await supabase
        .from("alarms")
        .update({
          status: "completed",
          completed_by_name: `${currentMemberName} (stopped)`,
          completed_at: new Date().toISOString()
        })
        .eq("id", alarm.id);

      if (error) {
        setStatus(error.message);
        return;
      }

      setStatus(`Stopped timer for all: "${alarm.message}".`);
    });

    activeAlarmsEl.append(card);
  });
}

function renderHistory() {
  historyListEl.innerHTML = "";
  const history = alarms.filter((alarm) => alarm.status === "completed");

  history.forEach((entry) => {
    const doneByText = entry.completed_by_name ? ` · task done by ${escapeHtml(entry.completed_by_name)}` : "";
    const card = document.createElement("article");
    card.className = "history-card";
    card.innerHTML = `
      <div class="inline-row">
        <h3 class="history-title">${escapeHtml(entry.message)}</h3>
        <p class="meta">${formatDuration(entry.total_sec || 0)}</p>
      </div>
      <p class="meta">by ${escapeHtml(entry.created_by_name)}${doneByText}</p>
      <div class="chips">${(entry.recipients || []).map((r) => `<span class="chip">${escapeHtml(r)}</span>`).join("")}</div>
    `;
    historyListEl.append(card);
  });
}

function startTicker() {
  window.setInterval(async () => {
    const running = alarms.filter((alarm) => alarm.status === "running");
    for (const alarm of running) {
      if (getRemainingSec(alarm) <= 0) {
        await supabase.from("alarms").update({ status: "ringing" }).eq("id", alarm.id).eq("status", "running");
      }
    }

    renderAlarms();
    syncPopupWithCurrentState();
    updateStartTimerButton();
  }, 1000);
}

function getRemainingSec(alarm) {
  if (!alarm.ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(alarm.ends_at).getTime() - Date.now()) / 1000));
}

function syncPopupWithCurrentState() {
  const alarm = getCurrentRingingAlarm();
  if (!alarm) {
    hideAlarmPopup();
    return;
  }

  ringingAlarmId = alarm.id;
  alarmPopupMessageEl.textContent = `"${alarm.message}" is ringing for ${formatDuration(alarm.total_sec || 0)}.`;
  alarmPopupEl.classList.remove("hidden");
  startLocalAlarmTone();
}

function getCurrentRingingAlarm() {
  return alarms.find((alarm) => {
    if (alarm.status !== "ringing") return false;
    const mutedBy = Array.isArray(alarm.muted_by) ? alarm.muted_by : [];
    return !mutedBy.includes(deviceId);
  });
}

function hideAlarmPopup() {
  ringingAlarmId = null;
  alarmPopupEl.classList.add("hidden");
  stopLocalAlarmTone();
}

function unlockAudio() {
  ensureAudioContext();
  if (!alarmAudioContext) return;
  if (alarmAudioContext.state === "suspended") {
    alarmAudioContext.resume().catch(() => {});
  }
}

function ensureAudioContext() {
  if (alarmAudioContext) return;
  if (!window.AudioContext && !window.webkitAudioContext) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  alarmAudioContext = new Ctx();
}

function startLocalAlarmTone() {
  ensureAudioContext();
  if (!alarmAudioContext || alarmOscillator) return;

  if (alarmAudioContext.state === "suspended") {
    alarmAudioContext.resume().catch(() => {});
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
  if (!alarmOscillator) return;
  alarmOscillator.stop();
  alarmOscillator.disconnect();
  alarmGain.disconnect();
  alarmOscillator = null;
  alarmGain = null;
}

function ensureDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function getCurrentMemberNameOrRedirect() {
  const existing = localStorage.getItem(DEVICE_MEMBER_NAME_KEY)?.trim();
  if (existing) return existing;
  window.location.href = "index.html?setName=1";
  throw new Error("Member name is required");
}

function updateStartTimerButton() {
  const durationSec = Number(customMinInput.value || 0) * 60 + Number(customSecInput.value || 0);
  const hasMessage = messageInput.value.trim().length > 0;
  const hasRecipient = recipientListEl.querySelectorAll("input[type='checkbox']:checked").length > 0;
  const enabled = durationSec > 0 && hasMessage && hasRecipient;

  startTimerButton.disabled = !enabled;
  startTimerButton.classList.toggle("is-active", enabled);
}

async function deleteGroup() {
  const confirmed = window.confirm(
    `Delete "${group.name}"? This will remove the group and all its timers for everyone.`
  );
  if (!confirmed) return;

  const { error: alarmsErr } = await supabase
    .from("alarms")
    .delete()
    .eq("group_code", group.code);

  if (alarmsErr) {
    setStatus(alarmsErr.message);
    return;
  }

  const { error: membersErr } = await supabase
    .from("group_members")
    .delete()
    .eq("group_code", group.code);

  if (membersErr) {
    setStatus(membersErr.message);
    return;
  }

  const { error: groupErr } = await supabase
    .from("groups")
    .delete()
    .eq("code", group.code);

  if (groupErr) {
    setStatus(groupErr.message);
    return;
  }

  localStorage.removeItem(CURRENT_GROUP_KEY);
  stopLocalAlarmTone();
  window.location.href = "index.html";
}

async function leaveGroup() {
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_code", group.code)
    .eq("user_id", authUser.id);

  if (error) {
    setStatus(error.message);
    return;
  }

  localStorage.removeItem(CURRENT_GROUP_KEY);
  stopLocalAlarmTone();
  window.location.href = "index.html";
}

function formatDuration(totalSec) {
  const safe = Math.max(0, Number(totalSec || 0));
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message) {
  statusEl.textContent = message;
}