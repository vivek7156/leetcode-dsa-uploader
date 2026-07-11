# 🚀 DSA Uploader

> A Chrome / Edge extension that **automatically pushes your LeetCode accepted submissions to a GitHub repository** — including problem descriptions, images, difficulty, tags, and your code.

---

## ✨ Features

- **🤖 Auto-Upload on Submit** — as soon as LeetCode marks your solution Accepted, it's pushed to GitHub with zero clicks.
- **📦 Bulk Historical Sync** — import all your past accepted submissions (latest 20 / 50 / 100 / 500 / all) in one click.
- **📝 Rich READMEs** — each problem folder gets a `README.md` with title, difficulty, tags, full description, and embedded images.
- **🗂️ Clean Folder Structure** — repos are organized as `problems/<slug>/submissions/<id>.<ext>`.
- **🌐 Multi-Language Support** — C++, Python, Java, JavaScript, TypeScript, C#, and more.
- **🔒 Secure** — your GitHub token is stored locally in `chrome.storage.local`, never transmitted anywhere other than the GitHub API.

---

## 📁 Repository Structure (Output)

```
your-github-repo/
└── problems/
    ├── two-sum/
    │   ├── README.md          ← problem description + images
    │   └── submissions/
    │       ├── 2063701733.cpp
    │       └── 2063812345.py
    └── longest-substring-without-repeating-characters/
        ├── README.md
        └── submissions/
            └── 2071234567.java
```

---

## 🛠️ Installation

### 1. Clone & Build

```bash
git clone https://github.com/vivek7156/leetcode-dsa-uploader.git
cd leetcode-dsa-uploader
npm install
npm run build
```

### 2. Load into Chrome / Edge

1. Open `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode** (toggle, top right).
3. Click **Load unpacked**.
4. Select the root folder of this project (the one containing `manifest.json`).

---

## ⚙️ Setup

### Step 1 — Create a GitHub Fine-Grained Token

1. Go to **github.com → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens**.
2. Click **Generate new token**.
3. Set **Repository access** to your DSA solutions repo.
4. Under **Permissions → Repository**, grant **Contents: Read & Write**.
5. Copy the token.

### Step 2 — Configure the Extension

1. Click the DSA Uploader icon in your browser toolbar.
2. Click the **⚙ gear icon** (top right of the popup).
3. Fill in:
   - **GitHub Token** — paste the token from Step 1
   - **GitHub Username** — your GitHub handle
   - **Repository Name** — the repo where solutions should be pushed
   - **Branch** — default is `main`
4. Click **Save Settings**.

### Step 3 — Start Solving!

Submit any problem on LeetCode. DSA Uploader listens for the Accepted verdict and pushes your solution automatically.

---

## 🕰️ Syncing Historical Submissions

1. Open the extension popup.
2. Select a limit (20 / 50 / 100 / 500 / All).
3. Click **Sync Now**.

A progress bar shows real-time status. All fetched submissions are uploaded to GitHub with full metadata.

> ⚠️ LeetCode rate-limits bulk fetches. The extension adds small delays between requests to be respectful. Syncing 100+ solutions may take a few minutes.

---

## 🏗️ Project Structure (Source)

```
src/
├── background/
│   ├── service-worker.ts   ← message handler, bulk sync, GraphQL API calls
│   └── uploader.ts         ← GitHub REST API file uploader
├── content/
│   └── leetcode/
│       └── page.ts         ← DOM scraper + network hook bridge
├── injected/
│   └── network-hook.ts     ← main-world fetch/XHR interceptor
├── lib/
│   └── storage.ts          ← shared config helpers
└── ui/
    ├── popup.html / .ts    ← extension popup
    └── options.html / .ts  ← settings page
```

---

## 🔧 Development

```bash
# Build once
npm run build

# After any source change, rebuild and then reload the extension in Chrome
npm run build
```

> There is no watch mode; run `npm run build` after each change and click **Reload** in `chrome://extensions/`.

---

## 🔒 Permissions Used

| Permission | Reason |
|---|---|
| `storage` | Save GitHub config and submission queue locally |
| `scripting` | Inject the network hook script into LeetCode pages |
| `activeTab` / `tabs` | Detect when a LeetCode problem page is active |
| `cookies` | Read `csrftoken` for authenticated LeetCode API calls used in bulk sync |
| `downloads` | Reserved for future export features |
| `https://leetcode.com/*` | Intercept submission and check responses |
| `https://api.github.com/*` | Create/update files in your repository |

---

## 📜 License

MIT — use, fork, and modify freely.
