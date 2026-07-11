const tokenInput = document.getElementById("token") as HTMLInputElement | null;
const ownerInput = document.getElementById("owner") as HTMLInputElement | null;
const repoInput = document.getElementById("repo") as HTMLInputElement | null;
const branchInput = document.getElementById("branch") as HTMLInputElement | null;
const saveButton = document.getElementById("save");
const testButton = document.getElementById("test");
const statusEl = document.getElementById("status") as HTMLPreElement | null;

function showStatus(text: string, isError = false) {
  if (!statusEl) return;
  statusEl.style.display = "block";
  statusEl.textContent = text;
  statusEl.className = isError ? "error" : "success";
}

async function load() {
  const stored = await chrome.storage.local.get({ githubToken: "", githubOwner: "", githubRepo: "", githubBranch: "main" });
  if (tokenInput) tokenInput.value = stored.githubToken || "";
  if (ownerInput) ownerInput.value = stored.githubOwner || "";
  if (repoInput) repoInput.value = stored.githubRepo || "";
  if (branchInput) branchInput.value = stored.githubBranch || "main";
  if (statusEl) statusEl.style.display = "none";
}

saveButton?.addEventListener("click", async () => {
  await chrome.storage.local.set({
    githubToken: tokenInput?.value || "",
    githubOwner: ownerInput?.value || "",
    githubRepo: repoInput?.value || "",
    githubBranch: branchInput?.value || "main"
  });
  showStatus("Settings saved successfully.");
});

testButton?.addEventListener("click", async () => {
  const token = tokenInput?.value || "";
  const owner = ownerInput?.value || "";
  const repo = repoInput?.value || "";
  if (!token || !owner || !repo) {
    showStatus("Please provide GitHub token, owner, and repository to test.", true);
    return;
  }

  showStatus("Testing repository connection...");

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `token ${token}` }
    });
    if (res.ok) {
      showStatus("Repository connection verified successfully!");
    } else {
      showStatus(`Test failed: ${res.status} ${res.statusText}`, true);
    }
  } catch (err) {
    showStatus(`Connection error: ${err}`, true);
  }
});

void load();
