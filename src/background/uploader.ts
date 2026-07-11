import { readCaptures, clearCaptures, getConfig, RepoConfig } from "../lib/storage.js";

function encodeContent(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

async function getFileSha(owner: string, repo: string, path: string, branch: string, token: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } });
  if (res.status === 200) {
    const json = await res.json();
    return json.sha as string;
  }
  return null;
}

async function createOrUpdateFile(owner: string, repo: string, path: string, content: string, message: string, branch: string, token: string, sha?: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body: any = {
    message,
    content: encodeContent(content),
    branch
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub upload failed: ${res.status} ${txt}`);
  }

  return await res.json();
}

function extForLanguage(lang?: string): string {
  if (!lang) return "txt";
  const l = lang.toLowerCase();
  if (l.includes("python")) return "py";
  if (l.includes("cpp") || l.includes("c++")) return "cpp";
  if (l.includes("java")) return "java";
  if (l.includes("javascript") || l.includes("js")) return "js";
  if (l.includes("typescript") || l.includes("ts")) return "ts";
  if (l.includes("c#") || l.includes("csharp")) return "cs";
  return "txt";
}

export async function uploadAllCaptures(): Promise<void> {
  if ((globalThis as any).isUploading) {
    return;
  }
  (globalThis as any).isUploading = true;

  try {
    const cfg = await getConfig();
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      console.warn("[DSA-Uploader] GitHub config incomplete. Storing captures locally.");
      return;
    }

    const captures = await readCaptures();
    if (captures.length === 0) {
      return;
    }

    console.log(`[DSA-Uploader] Uploader started processing ${captures.length} solution captures...`);

    // Clear captures immediately to prevent overlapping runs/duplicates
    await clearCaptures();

    const failedCaptures: any[] = [];
    const processedReadmes = new Set<string>();

    for (const cap of captures) {
      try {
        const record = cap as any;
        const problemSlug = record.problemSlug || (record.url ? new URL(record.url).pathname.split("/").filter(Boolean)[1] : "unknown-problem");
        const submissionId = record.submissionId || record.payload?.submissionId || Date.now();
        const language = record.language || record.payload?.language || "txt";
        const code = record.sourceCode || record.graphqlVariables?.typed_code || record.graphqlVariables?.code || record.payload?.variables?.typed_code || record.payload?.variables?.code;

        const folder = `problems/${problemSlug}`;
        const submissionsFolder = `${folder}/submissions`;
        const filename = `${submissionId}.${extForLanguage(language)}`;
        const path = `${submissionsFolder}/${filename}`;

        // Ensure README exists (only check/create once per problem slug in this batch)
        const readmePath = `${folder}/README.md`;
        if (!processedReadmes.has(problemSlug)) {
          processedReadmes.add(problemSlug);
          const readmeSha = await getFileSha(cfg.owner!, cfg.repo!, readmePath, cfg.branch!, cfg.token!);
          if (!readmeSha) {
            const readmeDescription = record.description || record.problemDescriptionText || record.payload?.description || `Problem ${problemSlug}`;
            await createOrUpdateFile(
              cfg.owner!,
              cfg.repo!,
              readmePath,
              `# ${record.title || problemSlug}\n\n${readmeDescription}\n`,
              `Add README for ${problemSlug}`,
              cfg.branch!,
              cfg.token!,
              undefined
            );
            console.log(`[DSA-Uploader] Successfully created README for ${problemSlug} on GitHub`);
          } else {
            console.log(`[DSA-Uploader] README for ${problemSlug} already exists, skipping creation`);
          }
        }

        if (typeof code === "string" && code.trim()) {
          const submissionSha = await getFileSha(cfg.owner!, cfg.repo!, path, cfg.branch!, cfg.token!);
          await createOrUpdateFile(
            cfg.owner!,
            cfg.repo!,
            path,
            code,
            `${submissionSha ? "Update" : "Add"} submission ${submissionId} for ${problemSlug}`,
            cfg.branch!,
            cfg.token!,
            submissionSha || undefined
          );
          console.log(`[DSA-Uploader] Successfully uploaded submission ${submissionId} for ${problemSlug} on GitHub`);
        }
      } catch (err) {
        console.error("[DSA-Uploader] Upload error:", err);
        failedCaptures.push(cap);
      }
    }

    // Restore failures back to captures storage so they can be retried later
    if (failedCaptures.length > 0) {
      const stored = await chrome.storage.local.get({ captures: [] });
      const current = Array.isArray(stored.captures) ? stored.captures : [];
      await chrome.storage.local.set({ captures: [...failedCaptures, ...current] });
    }
  } finally {
    (globalThis as any).isUploading = false;
  }
}
