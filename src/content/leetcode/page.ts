const HOOK_ID = "dsa-uploader-network-hook";

function isLeetCodeProblemPage(): boolean {
  return location.hostname === "leetcode.com" && location.pathname.startsWith("/problems/");
}

function injectNetworkHook(): void {
  if (document.getElementById(HOOK_ID)) {
    return;
  }

  const script = document.createElement("script");
  script.id = HOOK_ID;
  script.src = chrome.runtime.getURL("dist/injected/network-hook.js");
  script.async = false;
  script.onload = () => script.remove();
  (document.head ?? document.documentElement).appendChild(script);
}

function scrapeDOMMetadata() {
  const slug = location.pathname.split("/").filter(Boolean)[1] || null;

  let title = "";
  if (document.title) {
    const docTitleMatch = document.title.match(/^(.*?)\s*-\s*(?:Description|Submissions|Solutions|Solutions\s*v2|Editorial|Discussion)?\s*-\s*LeetCode$/i)
      || document.title.match(/^(.*?)\s*-\s*LeetCode$/i);
    if (docTitleMatch && docTitleMatch[1]) {
      title = docTitleMatch[1].trim();
    }
  }

  if (!title) {
    const titleEl = document.querySelector('[data-cy="question-title"]') || document.querySelector(".css-v3d350") || document.querySelector(".question-title") || document.querySelector(".title");
    title = titleEl?.textContent?.trim() || "";
  }

  if (!title && slug) {
    title = slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  if (!title) title = "Unknown Problem";

  // Difficulty: Find leaf element with exact Easy, Medium, or Hard text
  const diffEl = Array.from(document.querySelectorAll("*"))
    .find(e => e.children.length === 0 && /^(easy|medium|hard)$/i.test(e.textContent?.trim() || ""));
  const difficulty = diffEl?.textContent?.trim() || undefined;

  // Tags: find all /tag/ links on the page
  const tagEls = Array.from(document.querySelectorAll("a[href*='/tag/']"));
  const tags = Array.from(new Set(tagEls.map(e => e.textContent?.trim()).filter(Boolean))) as string[];

  // Description
  const descEl = document.querySelector('[data-track-load="description_content"]') || document.querySelector('.question-content__JfgR') || document.querySelector('.content__u3I1') || document.querySelector('.question-description');
  const descriptionHtml = descEl ? descEl.innerHTML : undefined;
  const description = descEl ? (descEl.textContent?.trim() || "") : "";

  return { slug, title, difficulty, tags, description, descriptionHtml };
}

function safeSendMessage(message: any): void {
  try {
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(message);
    }
  } catch (e) {
    // Context invalidated, ignore
  }
}

function sendDOMMetadata(): void {
  const meta = scrapeDOMMetadata();
  if (meta.slug) {
    safeSendMessage({
      type: "leetcode:metadata",
      payload: meta
    });
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "dsa-uploader") {
    return;
  }

  const payload = event.data.payload || {};
  const kind = payload.kind as string;
  const url = payload.url as string;
  const responseBody = normalizeRequestBody(payload.response);
  const requestBody = normalizeRequestBody(payload.body);

  console.log("[DSA-Uploader] Content script received hook message:", kind, url);

  if (kind === "graphql-fetch" || kind === "graphql-xhr") {
    const question = extractQuestion(responseBody);
    if (question) {
      const meta = parseProblemMetadata(responseBody);
      if (meta.slug && meta.title) {
        console.log("[DSA-Uploader] Parsed problem metadata from GraphQL:", meta.slug, meta.title);
        safeSendMessage({
          type: "leetcode:metadata",
          payload: meta
        });
      }
    }
  } else if (kind === "submit-fetch" || kind === "submit-xhr") {
    // 1. Scrape DOM metadata right away to match this submission
    sendDOMMetadata();

    // 2. Extract submission information
    const problemSlug = location.pathname.split("/").filter(Boolean)[1] || null;
    const submissionId = responseBody?.submission_id || responseBody?.submissionId;
    const lang = requestBody?.lang || requestBody?.language;
    const inferredCode = getEditorCode();
    const code = (requestBody?.typed_code || requestBody?.code || inferredCode) as string | undefined;

    console.log("[DSA-Uploader] Solution submit initiated! Extracted body info:", {
      submissionId,
      problemSlug,
      lang,
      codePreview: code ? code.substring(0, 50) + "..." : "empty",
      inferredCodePreview: inferredCode ? inferredCode.substring(0, 50) + "..." : "empty"
    });

    if (submissionId && problemSlug) {
      safeSendMessage({
        type: "leetcode:submit_sent",
        payload: {
          submissionId,
          problemSlug,
          language: lang || "txt",
          sourceCode: code || ""
        }
      });
    }
  } else if (kind === "check-fetch" || kind === "check-xhr") {
    // Extract submission ID from check detail URL (handles /v2/check/ or direct check/)
    const match = url?.match(/\/submissions\/detail\/([^/]+)/);
    const submissionId = match ? match[1] : undefined;

    console.log("[DSA-Uploader] Solution check status:", {
      submissionId,
      parsedFromUrl: url,
      matchResult: match,
      state: responseBody?.state,
      statusCode: responseBody?.status_code
    });

    if (submissionId && responseBody) {
      safeSendMessage({
        type: "leetcode:check_response",
        payload: {
          submissionId,
          state: responseBody.state,
          statusCode: responseBody.status_code,
          statusMsg: responseBody.status_msg,
          runtime: responseBody.status_runtime,
          memory: responseBody.status_memory
        }
      });
    }
  }
});

if (isLeetCodeProblemPage()) {
  injectNetworkHook();

  // Wait a small bit to let DOM render, then scrape fallback metadata
  setTimeout(() => {
    sendDOMMetadata();
  }, 1500);
}

// Track SPA navigation
let lastPathname = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPathname) {
    lastPathname = location.pathname;
    if (isLeetCodeProblemPage()) {
      setTimeout(() => {
        sendDOMMetadata();
      }, 1500);
    }
  }
}, 1000);

function parseProblemMetadata(responseBody?: Record<string, unknown> | undefined) {
  const slug = location.pathname.split("/").filter(Boolean)[1] || null;
  const question = extractQuestion(responseBody);
  if (!question) {
    return { slug, title: undefined, difficulty: undefined, tags: undefined, description: undefined, descriptionHtml: undefined };
  }

  const title = typeof question.title === "string" ? question.title : undefined;
  const difficulty = typeof question.difficulty === "string" ? question.difficulty : undefined;
  const tags = Array.isArray(question.topicTags)
    ? question.topicTags.map((tag: any) => tag?.name || tag?.slug).filter(Boolean)
    : undefined;
  const descriptionHtml = typeof question.content === "string" ? question.content : undefined;
  const description = descriptionHtml ? htmlToText(descriptionHtml) : undefined;

  return { slug, title, difficulty, tags, description, descriptionHtml };
}

function getEditorCode(): string | undefined {
  try {
    // Monaco editor text extraction
    const monacoView = document.querySelector('.monaco-editor .view-lines');
    if (monacoView) {
      return Array.from(monacoView.querySelectorAll('.view-line')).map(n => n.textContent || '').join('\n');
    }

    const cm = document.querySelector('.CodeMirror');
    if (cm) {
      return (cm.textContent || '').trim();
    }

    const ta = document.querySelector('textarea[data-codemirror]') as HTMLTextAreaElement | null;
    if (ta) return ta.value;

    const anyWin = window as any;
    if (anyWin.__monacoEditor || anyWin.editor) {
      const ed = anyWin.__monacoEditor || anyWin.editor;
      if (typeof ed.getValue === 'function') return ed.getValue();
    }
  } catch (e) {
    // ignore
  }
  return undefined;
}

function normalizeRequestBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return isPlainObject(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isPlainObject(body) ? body : undefined;
}

function extractQuestion(responseBody?: Record<string, unknown>): Record<string, unknown> | undefined {
  const candidates = [responseBody?.data, responseBody];
  for (const candidate of candidates) {
    if (!isPlainObject(candidate)) continue;
    if (isPlainObject(candidate.question)) return candidate.question;
    if (isPlainObject(candidate.data) && isPlainObject(candidate.data.question)) return candidate.data.question;
  }
  return undefined;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
