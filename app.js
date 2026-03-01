import { supabase, ensureSession } from "./supabaseClient.js";

const CURRENT_GROUP_KEY = "ticktogether.currentGroupCode";
const DEVICE_MEMBER_NAME_KEY = "ticktogether.deviceMemberName";
const DEVICE_ID_KEY = "ticktogether.deviceId";

const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const groupNameInput = document.querySelector("#group-name");
const groupCodeInput = document.querySelector("#group-code");
const groupList = document.querySelector("#group-list");
const emptyState = document.querySelector("#empty-state");
const statusEl = document.querySelector("#status");
const createGroupButton = document.querySelector("#create-group-btn");
const joinGroupButton = document.querySelector("#join-group-btn");

const profileNameInput = document.querySelector("#profile-name-input");
const editNameButton = document.querySelector("#edit-name-btn");
const saveNameButton = document.querySelector("#save-name-btn");
const cancelNameButton = document.querySelector("#cancel-name-btn");
const profileActionsEl = document.querySelector("#profile-actions");

const nameModal = document.querySelector("#name-modal");
const nameForm = document.querySelector("#name-form");
const nameModalInput = document.querySelector("#name-modal-input");
const nameCancelButton = document.querySelector("#name-cancel");

let pendingAction = null;
let isEditingProfileName = false;
let authUser = null;
let myGroups = [];

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
    await refreshMyGroups();
    renderProfile();
    setProfileEditing(false);
    updateActionButtons();
  } catch (error) {
    setStatus(`Failed to initialize: ${error.message}`);
  }

  if (new URLSearchParams(window.location.search).get("setName") === "1") {
    openNameModal();
  }
}

groupNameInput.addEventListener("input", updateActionButtons);
groupCodeInput.addEventListener("input", updateActionButtons);

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ensureNameThen(() => createGroup());
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ensureNameThen(() => joinGroup());
});

editNameButton.addEventListener("click", () => {
  setProfileEditing(true);
  profileNameInput.focus();
  profileNameInput.setSelectionRange(profileNameInput.value.length, profileNameInput.value.length);
});

profileNameInput.addEventListener("pointerdown", (event) => {
  if (!isEditingProfileName) {
    event.preventDefault();
  }
});

cancelNameButton.addEventListener("click", () => {
  renderProfile();
  setProfileEditing(false);
});

saveNameButton.addEventListener("click", async () => {
  const name = profileNameInput.value.trim();
  if (!name) {
    setStatus("Please enter a valid name.");
    return;
  }

  saveCurrentMemberName(name);
  setProfileEditing(false);
  setStatus("Name updated.");
  renderProfile();

  if (authUser) {
    await syncMemberNameAcrossMyGroups(name);
  }
});

nameCancelButton.addEventListener("click", () => {
  nameModalInput.value = "";
  nameModal.close();
  pendingAction = null;
});

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameModalInput.value.trim();
  if (!name) {
    setStatus("Please enter your name.");
    return;
  }

  saveCurrentMemberName(name);
  renderProfile();
  nameModalInput.value = "";
  nameModal.close();

  const action = pendingAction;
  pendingAction = null;
  if (action) {
    action();
  }
});

function setProfileEditing(isEditing) {
  isEditingProfileName = isEditing;
  profileNameInput.readOnly = !isEditing;
  profileNameInput.tabIndex = isEditing ? 0 : -1;
  profileActionsEl.hidden = !isEditing;
}

async function refreshMyGroups() {
  if (!authUser) return;

  const { data, error } = await supabase
    .from("group_members")
    .select("group_code, groups(code, name)")
    .eq("user_id", authUser.id)
    .order("joined_at", { ascending: false });

  if (error) {
    setStatus(`Could not load groups: ${error.message}`);
    return;
  }

  myGroups = (data || [])
    .map((row) => row.groups)
    .filter(Boolean);

  render();
}

async function createGroup() {
  updateActionButtons();
  const groupName = groupNameInput.value.trim();
  if (!groupName) {
    setStatus("Please enter a group name.");
    return;
  }

  const code = await generateUniqueHexCode();
  const memberName = getCurrentMemberName();
  const deviceId = ensureDeviceId();

  const { error: groupErr } = await supabase.from("groups").insert({
    code,
    name: groupName,
    created_by_user_id: authUser.id
  });

  if (groupErr) {
    setStatus(groupErr.message);
    return;
  }

  const { error: memberErr } = await supabase.from("group_members").insert({
    group_code: code,
    user_id: authUser.id,
    member_name: memberName,
    device_id: deviceId
  });

  if (memberErr) {
    setStatus(memberErr.message);
    return;
  }

  createForm.reset();
  updateActionButtons();
  await refreshMyGroups();

  setStatus(`Created "${groupName}" with code ${code}.`);
  localStorage.setItem(CURRENT_GROUP_KEY, code);
  window.location.href = `group.html?code=${code}`;
}

async function joinGroup() {
  updateActionButtons();
  const code = groupCodeInput.value.trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(code)) {
    setStatus("Group code must be a 6-character hex code (0-9, A-F).");
    return;
  }

  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("code, name")
    .eq("code", code)
    .maybeSingle();

  if (groupErr) {
    setStatus(groupErr.message);
    return;
  }

  if (!group) {
    setStatus(`No group found for code ${code}.`);
    return;
  }

  const memberName = getCurrentMemberName();
  const deviceId = ensureDeviceId();

  const { error: memberErr } = await supabase.from("group_members").upsert(
    {
      group_code: code,
      user_id: authUser.id,
      member_name: memberName,
      device_id: deviceId
    },
    { onConflict: "group_code,user_id" }
  );

  if (memberErr) {
    setStatus(memberErr.message);
    return;
  }

  joinForm.reset();
  updateActionButtons();
  await refreshMyGroups();

  setStatus(`Joined "${group.name}" (${code}).`);
  localStorage.setItem(CURRENT_GROUP_KEY, code);
  window.location.href = `group.html?code=${code}`;
}

function ensureNameThen(callback) {
  const name = getCurrentMemberName();
  if (name) {
    callback();
    return;
  }
  pendingAction = callback;
  openNameModal();
}

function openNameModal() {
  nameModalInput.value = "";
  nameModal.showModal();
  nameModalInput.focus();
}

function render() {
  groupList.innerHTML = "";

  myGroups.forEach((group) => {
    const li = document.createElement("li");

    const left = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = group.name;
    const code = document.createElement("span");
    code.textContent = group.code;
    left.append(name, code);

    const actions = document.createElement("div");
    actions.className = "group-actions";

    const open = document.createElement("a");
    open.href = `group.html?code=${group.code}`;
    open.className = "open-btn";
    open.setAttribute("aria-label", `Open ${group.name}`);
    open.innerHTML = getOpenIconSvg();
    open.addEventListener("click", () => {
      localStorage.setItem(CURRENT_GROUP_KEY, group.code);
    });

    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "leave-btn";
    leave.innerHTML = getExitIconSvg();
    leave.setAttribute("aria-label", `Leave ${group.name}`);
    leave.addEventListener("click", async () => {
      await leaveGroup(group.code);
    });

    actions.append(open, leave);
    li.append(left, actions);
    groupList.append(li);
  });

  emptyState.hidden = myGroups.length > 0;
}

async function leaveGroup(code) {
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_code", code)
    .eq("user_id", authUser.id);

  if (error) {
    setStatus(error.message);
    return;
  }

  await refreshMyGroups();
  setStatus(`Left "${code}".`);
}

async function generateUniqueHexCode() {
  for (let i = 0; i < 20; i += 1) {
    const candidate = randomHexCode();
    const { data } = await supabase.from("groups").select("code").eq("code", candidate).maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Could not generate a unique code. Please try again.");
}

function randomHexCode() {
  const alphabet = "0123456789ABCDEF";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function ensureDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

function getCurrentMemberName() {
  return localStorage.getItem(DEVICE_MEMBER_NAME_KEY)?.trim() || "";
}

function saveCurrentMemberName(name) {
  localStorage.setItem(DEVICE_MEMBER_NAME_KEY, name);
}

async function syncMemberNameAcrossMyGroups(name) {
  const updates = myGroups.map((group) =>
    supabase
      .from("group_members")
      .update({ member_name: name })
      .eq("group_code", group.code)
      .eq("user_id", authUser.id)
  );
  await Promise.all(updates);
}

function renderProfile() {
  const name = getCurrentMemberName();
  profileNameInput.value = name;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function updateActionButtons() {
  const hasGroupName = groupNameInput.value.trim().length > 0;
  const hasGroupCode = groupCodeInput.value.trim().length > 0;

  createGroupButton.disabled = !hasGroupName;
  joinGroupButton.disabled = !hasGroupCode;

  createGroupButton.classList.toggle("is-active", hasGroupName);
  joinGroupButton.classList.toggle("is-active", hasGroupCode);
}

function getOpenIconSvg() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="8 4 16 12 8 20"></polyline>
      <line x1="4" y1="12" x2="16" y2="12"></line>
    </svg>
  `;
}

function getExitIconSvg() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
      <polyline points="16 17 21 12 16 7"></polyline>
      <line x1="21" y1="12" x2="9" y2="12"></line>
    </svg>
  `;
}