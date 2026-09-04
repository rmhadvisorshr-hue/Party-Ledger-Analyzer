# Deployment Handbook — Party Ledger Analyzer (backend)

Target: **backend on the same Hostinger VPS as the ITR and Trial-Balance-Converter projects** (`200.234.40.130`), fully isolated in its own folder; GitHub Actions auto-deploys the backend on every push to `backend/**` in `github.com/rmhadvisorshr-hue/Party-Ledger-Analyzer`. Frontend hosting is **out of scope for this handbook** — wherever it ends up, point it at the backend's HTTPS URL from step 4 and set `FRONTEND_ORIGIN` in step 2 accordingly.

This doc follows the same log format as the Trial-Balance-Converter handbook — command, why, outcome — so it can be picked back up without re-deriving context.

Status legend: ✅ done and verified · ⏳ in progress / unconfirmed · ⬜ not started yet

**The whole pipeline is live end to end** as of 2026-09-04. Steps 1–7 below are all ✅. Frontend: `https://party-ledger-analyzer-frontend.vercel.app` (Vercel). Backend: `https://partyledger.200-234-40-130.sslip.io` (this VPS).

---

## 0. Why this follows the Trial-Balance-Converter pattern, and what's different

Same shape as that deploy: pure Node/TypeScript, no Python, no build step — `npm start` runs `tsx standalone.ts` directly, so `tsx` (a devDependency) means the VPS install step must be a full install, not `--omit=dev`.

**One real difference from the Trial-Balance-Converter repo: this one is an npm *workspace* monorepo** (`backend` and `frontend` are both members of one root `package.json`/`package-lock.json`; see root [package.json](package.json)). That means `backend/` has no `package-lock.json` of its own to copy — it only exists at the repo root, covering both workspaces together. Copying just `backend/` to an isolated VPS folder (the whole point of this handbook) means there's nothing for `npm ci` to lock against there. Rather than hand-generate and maintain a second, parallel lockfile that can silently drift from the root one, the VPS/CI install step below uses **`npm install`** (not `npm ci`) inside the isolated folder — it still resolves against the same `^`-pinned ranges in `backend/package.json`, just without a lockfile to pin exact transitive versions. Fine for a small single-service backend; revisit only if a transitive-dependency version drift ever actually causes a problem.

Two things that were extra work on the Trial-Balance-Converter deploy are **already done here** — nothing to change before starting VPS work:

- **CORS is already implemented**, gated on `FRONTEND_ORIGIN` ([createApp.ts](backend/createApp.ts)) — off by default, only activates once that env var is set.
- **`/health` already exists** — `GET /health` → `{"ok":true,"service":"ai-bank-statement-analyzer"}`.

One thing that's genuinely different and matters for the GitHub Actions workflow: this backend writes **persistent state to disk that must survive every deploy**:

- `backend/data/` — party-override JSON files and the Tesseract OCR model cache. Both directories are created automatically by the app on first run (`fs.mkdirSync(..., { recursive: true })` in [partyOverrideStore.ts](backend/src/services/partyOverrideStore.ts) and [tesseractExtractor.js](backend/src/converter/tesseractExtractor.js)) — nothing to pre-create on the VPS.
- `backend/server/uploads/` — transient temp files for an in-flight upload/convert request. Also self-created ([convert.routes.ts](backend/src/routes/convert.routes.ts)).

Both are gitignored, so a fresh `actions/checkout` never contains them — meaning the deploy workflow's `rsync --delete` **must exclude both**, exactly like it already excludes `.env`, or every push-to-`main` deploy would delete saved party overrides and the OCR cache out from under a running service. This is the one place a copy-paste of the Trial-Balance-Converter workflow would silently break something.

---

## 1. VPS one-time setup — isolated runtime, own folder

**What:** a self-contained runtime under `/opt/partyledger-backend/`, with its own Linux user (`plaapp`) and its own copy of Node — separate from `itr-backend` and `tbconverter-backend`. Removable later with zero effect on either: `rm -rf /opt/partyledger-backend && userdel plaapp`.

**Where:** VPS/SSH terminal (`ssh root@200.234.40.130`).

```bash
useradd -r -m -d /opt/partyledger-backend plaapp
mkdir -p /opt/partyledger-backend/app
cd /opt/partyledger-backend

NODE_TARBALL=$(curl -s https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -oP 'node-v22\.\d+\.\d+-linux-x64\.tar\.xz' | head -1)
curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE_TARBALL" -o node.tar.xz
tar -xf node.tar.xz
mv "${NODE_TARBALL%.tar.xz}" node
rm node.tar.xz

chown -R plaapp:plaapp /opt/partyledger-backend
```

**Checked ports in use before picking one:** `ss -tlnp` showed `itr-backend` on `8080` and `tbconverter-backend` on `8097` — **`8098`** confirmed free, used throughout below.

**Outcome:** ✅ Done. `node --version` on the isolated install → `v22.23.2`.

---

## 2. Get the code onto the VPS + create `.env`

**What:** a first copy of `backend/` on the VPS (GitHub Actions rsyncs future updates, but there's nothing to rsync *into* yet, and `.env` never comes from git).

**Where:** Local Computer (a command), then VPS/SSH terminal (a file edit).

From the local machine (no `package-lock.json` in this list — see step 0, there isn't one scoped to `backend/`):
```powershell
cd D:\CA-RMHStaffPortal\one-page-party-analysis
scp -r backend/src backend/standalone.ts backend/createApp.ts backend/apiFetch.ts backend/requestOrigin.ts backend/package.json backend/tsconfig.json root@200.234.40.130:/opt/partyledger-backend/app/
```

On the VPS:
```bash
nano /opt/partyledger-backend/app/.env
```
```
PORT=8098
FRONTEND_ORIGIN=https://<wherever-the-frontend-ends-up>
```
**Watch for a trailing slash on `FRONTEND_ORIGIN`** — browsers never send one in the `Origin` header, so a trailing slash here silently breaks every CORS check. Leave it off.

Then installed dependencies and fix ownership:
```bash
cd /opt/partyledger-backend/app
export PATH="/opt/partyledger-backend/node/bin:$PATH"
npm install
chown -R plaapp:plaapp /opt/partyledger-backend
```

**Outcome:** ✅ Done — `npm install` → `added 219 packages`. Same pre-existing deprecation warnings and `npm audit` findings (3 vulnerabilities, 2 moderate/1 high, inherited via `pdfjs-dist`) as the Trial-Balance-Converter deploy — not addressed here, not blocking. `FRONTEND_ORIGIN` left commented out in `.env` for now (see step 7) — CORS has nothing to allow yet, but `/health` and same-origin/no-origin requests work fine without it.

---

## 3. systemd service

**What:** run the backend as a managed process that starts on boot and restarts itself if it crashes.

**Where:** VPS/SSH terminal.

```bash
cat > /etc/systemd/system/partyledger-backend.service <<'EOF'
[Unit]
Description=Party Ledger Analyzer backend
After=network.target

[Service]
Type=simple
User=plaapp
WorkingDirectory=/opt/partyledger-backend/app
EnvironmentFile=/opt/partyledger-backend/app/.env
Environment=PATH=/opt/partyledger-backend/node/bin:/usr/bin:/bin
ExecStart=/opt/partyledger-backend/node/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now partyledger-backend
```

**Why the `PATH` line matters:** `npm` is a script starting with `#!/usr/bin/env node` — calling it by full path isn't enough on its own, `node/bin` also needs to be on `PATH` so npm's own internal lookup for `node` resolves.

**Verify:**
```bash
systemctl status partyledger-backend
curl -s http://127.0.0.1:8098/health
# {"ok":true,"service":"ai-bank-statement-analyzer"}
```

**Outcome:** ✅ Done, first try, no crash-loop. `systemctl status` showed `Active: active (running)`, log line `Party Ledger Analyzer API running standalone at http://localhost:8098`.

---

## 4. Domain + HTTPS (nginx + certbot + sslip.io)

**Why required:** whatever serves the frontend over HTTPS, a browser will block it from calling a plain-HTTP API. sslip.io gives a free, real, resolvable hostname for the bare VPS IP with zero signup/DNS setup. Own prefix here (`partyledger.200-234-40-130.sslip.io`) so nginx can tell this server block apart from ITR's and the Trial-Balance-Converter's on the same IP.

**Where:** VPS/SSH terminal.

```bash
nslookup partyledger.200-234-40-130.sslip.io   # should resolve -> 200.234.40.130

cat > /etc/nginx/sites-available/partyledger-backend <<'EOF'
server {
    listen 80;
    server_name partyledger.200-234-40-130.sslip.io;
    client_max_body_size 30M;
    location / {
        proxy_pass http://127.0.0.1:8098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/partyledger-backend /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d partyledger.200-234-40-130.sslip.io --non-interactive --agree-tos -m rmh.advisors.hr@gmail.com --redirect
```

**Verify:**
```bash
curl -s https://partyledger.200-234-40-130.sslip.io/health
```

**The backend's live HTTPS URL is `https://partyledger.200-234-40-130.sslip.io`.**

**Outcome:** ✅ Done — certbot issued and deployed the certificate on the first try. Certificate expires **2026-12-02**, auto-renews.

---

## 5. GitHub Actions — deploy SSH key

**What:** a dedicated keypair (separate from ITR's and the Trial-Balance-Converter's) so GitHub Actions can log into the VPS as `root` without your real password.

**Two keys exist for this project, not one — worth keeping straight:**
- A separate **operator key**, generated outside this git working tree (in a scratch/session-local folder), used to do all the interactive setup in steps 1–4 above. It is not stored anywhere in this repo or in GitHub — it only ever lived in a local scratch folder.
- The **CI deploy key** below, whose *public* half lives in the VPS's `authorized_keys` and whose *private* half lives only in the `VPS_SSH_KEY` GitHub secret.

Both were generated **outside any git working tree** (a scratch folder, never `D:\CA-RMHStaffPortal\one-page-party-analysis`) — the Trial-Balance-Converter deploy generated its key while `cd`'d into a git-tracked folder and got lucky that `.gitignore` never caught it in time; not worth repeating that risk.

```powershell
ssh-keygen -t ed25519 -f partyledger_deploy_key
```
Empty passphrase.

Public key appended to `~/.ssh/authorized_keys` on the VPS (alongside ITR's and the Trial-Balance-Converter's keys, not overwriting them). Verified it logs in without a password.

**Repo secrets** — GitHub → `rmhadvisorshr-hue/Party-Ledger-Analyzer` → **Settings → Secrets and variables → Actions**:

| Secret name | Value |
|---|---|
| `VPS_HOST` | `200.234.40.130` |
| `VPS_USER` | `root` |
| `VPS_APP_DIR` | `/opt/partyledger-backend/app` |
| `VPS_SSH_KEY` | full contents of `partyledger_deploy_key` |

Set via the GitHub API (fetch the repo's Actions public key, `libsodium` seal each value, `PUT .../actions/secrets/<name>`) rather than pasted into the UI by hand — same end result, four secrets visible under **Settings → Secrets and variables → Actions**. Local key files deleted from the scratch folder once confirmed set.

**Outcome:** ✅ Done — all four secrets set and confirmed listed under "Repository secrets."

---

## 6. GitHub Actions — the workflow file

**What:** on every push to `backend/**` on `main`, rsync the backend to the VPS, install dependencies with the isolated Node, restart the service.

**Where:** committed to this repo at [.github/workflows/deploy-backend.yml](.github/workflows/deploy-backend.yml) and pushed to `main`. Since that push only added the workflow file itself (not a `backend/**` change), it didn't auto-trigger — dispatched manually instead (GitHub → **Actions** tab → **Deploy Backend** → **Run workflow**, or `POST .../actions/workflows/deploy-backend.yml/dispatches`).

**Why `--exclude data --exclude server/uploads` matters** (see step 0): both are gitignored and hold state that only ever exists on the VPS — `rsync --delete` without excluding them would delete saved party overrides and the OCR cache on every single deploy.

**Outcome:** ✅ Done — first run, manually dispatched, completed with conclusion `success`. Post-deploy `curl https://partyledger.200-234-40-130.sslip.io/health` still returned `{"ok":true,...}` and `.env`/`data/`/`server/uploads/` were all still intact on the VPS afterward.

---

## 7. Point the frontend at this backend

The frontend turned out to already be deployed on Vercel (`https://party-ledger-analyzer-frontend.vercel.app`), separately from this backend work — see the note below on the Vercel build fix that was needed first.

1. `VITE_API_BASE_URL=https://partyledger.200-234-40-130.sslip.io` set in the Vercel project's env vars (Production), pointing the client at this backend.
2. `FRONTEND_ORIGIN=https://party-ledger-analyzer-frontend.vercel.app` set in `/opt/partyledger-backend/app/.env` on the VPS, `systemctl restart partyledger-backend`.

**Verified:** CORS preflight (`OPTIONS /api/analysis` with `Origin: https://party-ledger-analyzer-frontend.vercel.app`) returns `204` with `Access-Control-Allow-Origin` echoing that exact origin.

**Outcome:** ✅ Done. Still worth one real manual test — upload an actual bank statement through the live site — since curl only proves the plumbing, not the analysis pipeline end-to-end.

### Aside: the frontend's own Vercel deploy needed a fix first

Separately from this backend's deploy, the already-existing Vercel frontend was 404ing on every route. Root cause: `vite.config.ts` statically imports `vite-plugin-api.ts` for the integrated dev/preview mode, and Vite's config loader bundles that whole module graph eagerly — even the parts behind a runtime-only dynamic import — pulling in the entire backend (Express, tesseract.js, pdfjs-dist, `exceljs`) just to evaluate the config. That broke the build on Vercel, where only the `frontend` workspace gets installed.

Fixed with a standalone build path that never references the backend (`vite.config.standalone.ts` + `server.standalone.ts` + `frontend/vercel.json` pointing Vercel's `buildCommand` at it) — the default `npm run build` (Render, local dev) is untouched. That got the *build* passing, but the *site* still 404'd: TanStack Start needs the `nitro` Vite plugin to package the SSR server for Vercel's runtime (Build Output API v3 — a `__server.func` Node function + static assets); without it Vercel has no adapter and returns its own platform-level 404 for every route regardless of build success. Added `nitro()` to `vite.config.standalone.ts`, verified locally with `VERCEL=1 npm run build:standalone` that it produces `.vercel/output/functions/__server.func/`, pushed, confirmed `https://party-ledger-analyzer-frontend.vercel.app/` returns real HTML.
