import { uploadAllCaptures } from "./uploader.js";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({
    captures: [],
    problemsMetadata: {},
    pendingSubmissions: {}
  });
});

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "leetcode:metadata") {
    void (async () => {
      const stored = await chrome.storage.local.get({ problemsMetadata: {} });
      const payload = message.payload || {};
      if (!payload.slug) return;

      const current = stored.problemsMetadata[payload.slug] || {};
      const merged = {
        slug: payload.slug,
        title: payload.title || current.title,
        difficulty: payload.difficulty || current.difficulty,
        tags: payload.tags || current.tags,
        description: payload.description || current.description,
        descriptionHtml: payload.descriptionHtml || current.descriptionHtml
      };

      console.log("[DSA-Uploader] Cached metadata for slug:", payload.slug, merged.title);
      stored.problemsMetadata[payload.slug] = merged;
      await chrome.storage.local.set({ problemsMetadata: stored.problemsMetadata });
    })();
    return;
  }

  if (message.type === "leetcode:submit_sent") {
    void (async () => {
      const stored = await chrome.storage.local.get({ pendingSubmissions: {} });
      const payload = message.payload || {};
      if (!payload.submissionId || !payload.problemSlug) return;

      // Clean up entries older than 5 minutes
      const now = Date.now();
      for (const id of Object.keys(stored.pendingSubmissions)) {
        if (now - stored.pendingSubmissions[id].timestamp > 5 * 60 * 1000) {
          delete stored.pendingSubmissions[id];
        }
      }

      console.log("[DSA-Uploader] Registered pending submission ID:", payload.submissionId, "for problem:", payload.problemSlug);
      stored.pendingSubmissions[payload.submissionId] = {
        problemSlug: payload.problemSlug,
        language: payload.language || "txt",
        sourceCode: payload.sourceCode || "",
        timestamp: now
      };

      await chrome.storage.local.set({ pendingSubmissions: stored.pendingSubmissions });
    })();
    return;
  }

  if (message.type === "leetcode:check_response") {
    void (async () => {
      const stored = await chrome.storage.local.get({
        pendingSubmissions: {},
        problemsMetadata: {},
        captures: []
      });
      const payload = message.payload || {};
      const subId = payload.submissionId;
      if (!subId) return;

      const sub = stored.pendingSubmissions[subId];
      if (!sub) return;

      console.log("[DSA-Uploader] Check status validation:", payload.state, "status Msg:", payload.statusMsg, "code:", payload.statusCode);

      // Wait until check is complete
      if (payload.state !== "SUCCESS") {
        return;
      }

      // If accepted (status_code 10 is Accepted, statusMsg "Accepted" may be returned)
      if (payload.statusCode === 10 || payload.statusMsg === "Accepted") {
        const meta = stored.problemsMetadata[sub.problemSlug];
        const captures = Array.isArray(stored.captures) ? stored.captures : [];

        console.log("[DSA-Uploader] Submission accepted! Collated and saved capture for problem:", sub.problemSlug);

        captures.push({
          problemSlug: sub.problemSlug,
          submissionId: subId,
          language: sub.language,
          sourceCode: sub.sourceCode,
          title: meta?.title || sub.problemSlug,
          difficulty: meta?.difficulty,
          tags: meta?.tags || [],
          description: meta?.description || "",
          problemDescriptionHtml: meta?.descriptionHtml || "",
          statusMsg: payload.statusMsg,
          runtime: payload.runtime,
          memory: payload.memory,
          capturedAt: new Date().toISOString()
        });

        await chrome.storage.local.set({ captures });

        // Trigger uploader automatically!
        void uploadAllCaptures();
      } else {
        console.log("[DSA-Uploader] Submission was check-complete but not accepted:", payload.statusMsg);
      }

      // delete from pending since result is processed
      delete stored.pendingSubmissions[subId];
      await chrome.storage.local.set({ pendingSubmissions: stored.pendingSubmissions });
    })();
    return;
  }

  if (message.type === "leetcode:capture") {
    void (async () => {
      const stored = await chrome.storage.local.get({ captures: [] as unknown[] });
      const captures = Array.isArray(stored.captures) ? stored.captures : [];
      captures.push({
        ...message.payload,
        capturedAt: new Date().toISOString()
      });
      await chrome.storage.local.set({ captures });
    })();
    return;
  }

  if (message.type === "upload:all") {
    void uploadAllCaptures();
    return;
  }

  if (message.type === "leetcode:sync_older") {
    void (async () => {
      const payload = message.payload || {};
      try {
        // Step 1: Get CSRF token from LeetCode cookies (needed for authenticated GraphQL)
        const csrfToken = await getLeetCodeCsrfToken();
        console.log("[DSA-Uploader] CSRF token found:", !!csrfToken);

        // Step 2: Verify we're signed in
        const username = await fetchUsername(csrfToken);
        if (!username) {
          await chrome.storage.local.set({
            syncProgress: { active: false, status: "Error: Please sign in to LeetCode first.", error: "Not signed in" }
          });
          return;
        }

        await chrome.storage.local.set({
          syncProgress: { active: true, status: `Signed in as ${username}. Fetching your solved problems...`, current: 0, total: 0 }
        });

        // Step 3: Get list of solved problems (unique slugs)
        const limit = payload.limit || 50;
        const recentList = await fetchRecentAcSubmissions(username, limit, csrfToken);

        if (!recentList || recentList.length === 0) {
          await chrome.storage.local.set({
            syncProgress: { active: false, status: "No accepted submissions found. Make sure you are signed in.", error: null }
          });
          return;
        }

        // Deduplicate by slug — we'll fetch ALL submissions per slug below
        const slugSet = new Set<string>();
        for (const item of recentList) {
          if (item.titleSlug) slugSet.add(item.titleSlug);
        }
        const uniqueSlugs = Array.from(slugSet);

        const total = uniqueSlugs.length;
        console.log("[DSA-Uploader] Distinct problem slugs to sync:", total);

        await chrome.storage.local.set({
          syncProgress: { active: true, status: `Found ${total} problems. Fetching all accepted submissions...`, current: 0, total }
        });

        const metadataCache: Record<string, any> = {};
        const newCaptures: any[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < total; i++) {
          const slug = uniqueSlugs[i];

          await chrome.storage.local.set({
            syncProgress: {
              active: true,
              status: `[${i + 1}/${total}] Fetching submissions for: ${slug}...`,
              current: i + 1,
              total,
              successCount,
              errorCount
            }
          });

          try {
            // Small delay between problems to avoid rate limiting
            if (i > 0) await sleep(600);

            // Step 4: Get ALL accepted submissions for this problem slug
            const submissions = await fetchAllAcceptedSubmissionsForProblem(slug, csrfToken);
            console.log(`[DSA-Uploader] Got ${submissions.length} accepted submissions for ${slug}`);

            if (submissions.length === 0) {
              errorCount++;
              continue;
            }

            // Step 5: Fetch problem metadata (once per slug)
            if (!metadataCache[slug]) {
              await sleep(400);
              const qMeta = await fetchQuestionMetadata(slug, csrfToken);
              metadataCache[slug] = qMeta ? {
                title: qMeta.title || slug,
                difficulty: qMeta.difficulty,
                tags: Array.isArray(qMeta.topicTags) ? qMeta.topicTags.map((t: any) => t.name || t.slug).filter(Boolean) : [],
                description: qMeta.content ? htmlToText(qMeta.content) : "",
                descriptionHtml: qMeta.content || ""
              } : { title: slug, tags: [], description: "" };
            }
            const meta = metadataCache[slug];

            // Step 6: Fetch code for each submission
            for (const sub of submissions) {
              try {
                await sleep(500);
                const submissionId = Number(sub.id);
                const detail = await fetchSubmissionDetail(submissionId, csrfToken);

                if (!detail || !detail.code) {
                  console.warn("[DSA-Uploader] No code returned for submission", submissionId);
                  errorCount++;
                  continue;
                }

                const language = typeof detail.lang === "string" ? detail.lang : (detail.lang?.name || "txt");

                newCaptures.push({
                  problemSlug: slug,
                  submissionId: String(submissionId),
                  language,
                  sourceCode: detail.code,
                  title: meta.title,
                  difficulty: meta.difficulty,
                  tags: meta.tags,
                  description: meta.description,
                  problemDescriptionHtml: meta.descriptionHtml,
                  statusMsg: sub.statusDisplay || "Accepted",
                  runtime: sub.runtime || "",
                  memory: sub.memory || "",
                  capturedAt: new Date().toISOString()
                });

                successCount++;
              } catch (subErr) {
                console.error("[DSA-Uploader] error fetching submission detail", subErr);
                errorCount++;
              }
            }
          } catch (err) {
            console.error("[DSA-Uploader] error syncing slug", slug, err);
            errorCount++;
          }
        }

        console.log(`[DSA-Uploader] Sync complete. ${successCount} captures, ${errorCount} errors.`);

        if (newCaptures.length > 0) {
          const stored = await chrome.storage.local.get({ captures: [] });
          const currentCaptures = Array.isArray(stored.captures) ? stored.captures : [];
          await chrome.storage.local.set({ captures: [...newCaptures, ...currentCaptures] });
          void uploadAllCaptures();
        }

        await chrome.storage.local.set({
          syncProgress: {
            active: false,
            status: `Done! ${successCount} submission${successCount !== 1 ? "s" : ""} synced to GitHub${errorCount > 0 ? ` (${errorCount} skipped)` : "."}.`,
            current: total,
            total,
            successCount,
            errorCount
          }
        });

      } catch (e: any) {
        console.error("Bulk sync error", e);
        await chrome.storage.local.set({
          syncProgress: { active: false, status: `Sync failed: ${e.message || e}`, error: String(e) }
        });
      }
    })();
    return;
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getLeetCodeCsrfToken(): Promise<string> {
  try {
    const cookie = await chrome.cookies.get({ url: "https://leetcode.com", name: "csrftoken" });
    return cookie?.value || "";
  } catch {
    return "";
  }
}

function leetcodeHeaders(csrfToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Referer": "https://leetcode.com/",
    "x-csrftoken": csrfToken,
    "Origin": "https://leetcode.com"
  };
}

async function fetchUsername(csrfToken: string): Promise<string | null> {
  const query = `query userStatus { userStatus { username isSignedIn } }`;
  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: leetcodeHeaders(csrfToken),
      body: JSON.stringify({ query, operationName: "userStatus" }),
      credentials: "include"
    });
    if (!res.ok) { console.error("[DSA-Uploader] fetchUsername HTTP fail:", res.status); return null; }
    const json = await res.json();
    console.log("[DSA-Uploader] userStatus:", json.data?.userStatus);
    return (json.data?.userStatus?.isSignedIn && json.data?.userStatus?.username) || null;
  } catch (err) {
    console.error("fetchUsername error", err);
    return null;
  }
}

async function fetchRecentAcSubmissions(username: string, limit: number, csrfToken: string): Promise<any[]> {
  const query = `
    query recentAcSubmissions($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id title titleSlug timestamp
      }
    }
  `;
  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: leetcodeHeaders(csrfToken),
      body: JSON.stringify({ query, operationName: "recentAcSubmissions", variables: { username, limit } }),
      credentials: "include"
    });
    if (!res.ok) { console.error("[DSA-Uploader] fetchRecentAcSubmissions fail:", res.status); return []; }
    const json = await res.json();
    console.log("[DSA-Uploader] recentAcSubmissionList count:", json.data?.recentAcSubmissionList?.length);
    if (json.errors) console.error("[DSA-Uploader] recentAcSubmissions errors:", json.errors);
    return json.data?.recentAcSubmissionList || [];
  } catch (err) {
    console.error("fetchRecentAcSubmissions error", err);
    return [];
  }
}

async function fetchAllAcceptedSubmissionsForProblem(titleSlug: string, csrfToken: string): Promise<any[]> {
  // Uses submissionList which returns all submissions for a specific problem
  const query = `
    query Submissions($offset: Int!, $limit: Int!, $questionSlug: String!) {
      submissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
        lastKey
        hasNext
        submissions {
          id
          statusDisplay
          lang
          runtime
          timestamp
          memory
        }
      }
    }
  `;
  const allAccepted: any[] = [];
  let offset = 0;
  const pageSize = 40;

  try {
    while (true) {
      const res = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: leetcodeHeaders(csrfToken),
        body: JSON.stringify({
          query,
          operationName: "Submissions",
          variables: { offset, limit: pageSize, questionSlug: titleSlug }
        }),
        credentials: "include"
      });

      if (!res.ok) {
        console.error(`[DSA-Uploader] submissionList HTTP fail ${res.status} for ${titleSlug}`);
        break;
      }

      const json = await res.json();
      if (json.errors) {
        console.error("[DSA-Uploader] submissionList errors:", json.errors);
        break;
      }

      const page = json.data?.submissionList;
      if (!page) break;

      const accepted = (page.submissions || []).filter((s: any) => s.statusDisplay === "Accepted");
      allAccepted.push(...accepted);

      if (!page.hasNext) break;
      offset += pageSize;
      await sleep(400);
    }
  } catch (err) {
    console.error("fetchAllAcceptedSubmissionsForProblem error", err);
  }

  return allAccepted;
}

async function fetchSubmissionDetail(submissionId: number, csrfToken: string): Promise<any> {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        id code runtime memory statusDisplay timestamp lang { name }
      }
    }
  `;
  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: leetcodeHeaders(csrfToken),
      body: JSON.stringify({ query, operationName: "submissionDetails", variables: { submissionId } }),
      credentials: "include"
    });
    if (!res.ok) {
      const responseText = await res.text();
      console.error("[DSA-Uploader] fetchSubmissionDetail HTTP fail:", res.status, "for id", submissionId, "ResponseText:", responseText);
      return null;
    }
    const json = await res.json();
    if (json.errors) console.error("[DSA-Uploader] submissionDetails errors:", json.errors);
    return json.data?.submissionDetails || null;
  } catch (err) {
    console.error("fetchSubmissionDetail error", err);
    return null;
  }
}

async function fetchQuestionMetadata(titleSlug: string, csrfToken: string): Promise<any> {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title difficulty content
        topicTags { name slug }
      }
    }
  `;
  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: leetcodeHeaders(csrfToken),
      body: JSON.stringify({ query, operationName: "questionData", variables: { titleSlug } }),
      credentials: "include"
    });
    if (!res.ok) { console.error("[DSA-Uploader] fetchQuestionMetadata HTTP fail:", res.status); return null; }
    const json = await res.json();
    if (json.errors) console.error("[DSA-Uploader] questionData errors:", json.errors);
    return json.data?.question || null;
  } catch (err) {
    console.error("fetchQuestionMetadata error", err);
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, "\n![]($1)\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

