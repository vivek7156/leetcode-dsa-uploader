import { getConfig } from "../lib/storage.js";

const settingsBtn = document.getElementById("settings");
const statusDot = document.getElementById("status-dot");
const statusTitle = document.getElementById("status-title");
const statusDesc = document.getElementById("status-desc");
const syncLimit = document.getElementById("sync-limit") as HTMLSelectElement | null;
const startSyncBtn = document.getElementById("start-sync") as HTMLButtonElement | null;
const progressArea = document.getElementById("progress-area");
const progressBar = document.getElementById("progress-bar");
const progressDesc = document.getElementById("progress-desc");
const progressVal = document.getElementById("progress-val");
const guideCard = document.getElementById("guide-card");
const autoTip = document.getElementById("auto-tip");

settingsBtn?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function checkConfig() {
  const cfg = await getConfig();
  const isConfigured = !!(cfg.token && cfg.owner && cfg.repo);

  if (statusDot && statusTitle && statusDesc) {
    if (isConfigured) {
      statusDot.className = "status-indicator ready";
      statusTitle.textContent = "GitHub Connected";
      statusDesc.textContent = `Linked to ${cfg.owner}/${cfg.repo} (${cfg.branch || "main"})`;
      if (startSyncBtn) startSyncBtn.disabled = false;
    } else {
      statusDot.className = "status-indicator";
      statusTitle.textContent = "GitHub Link Missing";
      statusDesc.textContent = "Please configure settings (click gear icon ⚙)";
      if (startSyncBtn) startSyncBtn.disabled = true;
    }
  }

  // Show guide for new users, tip for configured users
  if (guideCard) guideCard.className = isConfigured ? "guide-card" : "guide-card visible";
  if (autoTip) autoTip.style.display = isConfigured ? "flex" : "none";
}

function updateProgressUI(progress: any) {
  if (!progress || !progressArea || !progressBar || !progressDesc || !progressVal || !startSyncBtn || !syncLimit) {
    return;
  }

  if (progress.active) {
    progressArea.style.display = "block";
    startSyncBtn.disabled = true;
    syncLimit.disabled = true;

    const current = progress.current || 0;
    const total = progress.total || 0;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;

    progressBar.style.width = `${pct}%`;
    progressVal.textContent = `${pct}%`;
    progressDesc.textContent = progress.status || "Syncing...";
  } else {
    if (progress.status) {
      progressArea.style.display = "block";
      progressBar.style.width = "100%";
      progressVal.textContent = "Done";
      progressDesc.textContent = progress.status;
    } else {
      progressArea.style.display = "none";
    }

    startSyncBtn.disabled = false;
    syncLimit.disabled = false;
    void checkConfig();
  }
}

startSyncBtn?.addEventListener("click", () => {
  const limitVal = syncLimit ? syncLimit.value : "50";
  const limit = limitVal === "all" ? 2000 : parseInt(limitVal, 10);
  chrome.runtime.sendMessage({
    type: "leetcode:sync_older",
    payload: { limit }
  });
});

async function init() {
  await checkConfig();

  const stored = await chrome.storage.local.get({ syncProgress: null });
  if (stored.syncProgress) {
    updateProgressUI(stored.syncProgress);
  }
}

chrome.storage.onChanged.addListener((changes: Record<string, any>) => {
  if (changes.syncProgress) {
    updateProgressUI(changes.syncProgress.newValue);
  }
});

void init();
