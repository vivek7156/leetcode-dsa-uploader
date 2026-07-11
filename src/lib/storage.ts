export async function readCaptures(): Promise<unknown[]> {
  const stored = await chrome.storage.local.get({ captures: [] as unknown[] });
  return Array.isArray(stored.captures) ? stored.captures : [];
}

export async function clearCaptures(): Promise<void> {
  await chrome.storage.local.set({ captures: [] });
}

export type RepoConfig = {
  token?: string;
  owner?: string;
  repo?: string;
  branch?: string;
};

export async function getConfig(): Promise<RepoConfig> {
  const stored = await chrome.storage.local.get({ githubToken: "", githubOwner: "", githubRepo: "", githubBranch: "main" });
  return {
    token: stored.githubToken,
    owner: stored.githubOwner,
    repo: stored.githubRepo,
    branch: stored.githubBranch || "main"
  };
}
