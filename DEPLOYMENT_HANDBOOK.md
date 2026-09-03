# Deployment Handbook — Party Ledger Analyzer (backend)

Target: **backend on the same Hostinger VPS as the ITR and Trial-Balance-Converter projects** (`200.234.40.130`), fully isolated in its own folder; GitHub Actions auto-deploys the backend on every push to `backend/**` in `github.com/rmhadvisorshr-hue/Party-Ledger-Analyzer`. Frontend hosting is **out of scope for this handbook** — wherever it ends up, point it at the backend's HTTPS URL from step 4 and set `FRONTEND_ORIGIN` in step 2 accordingly.

This doc follows the same log format as the Trial-Balance-Converter handbook — command, why, outcome — so it can be picked back up without re-deriving context. Nothing below has been run yet; check items off (⬜ → ✅) as you go.

Status legend: ✅ done and verified · ⏳ in progress / unconfirmed · ⬜ not started yet

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

**Before using it, confirm a free port** — `8097` is already `tbconverter-backend`; check what ITR uses too:
```bash
ss -tlnp | grep -E ':(8097|8098|8099)\b'
```
This handbook assumes **`8098`** is free. If it isn't, swap it everywhere below (`.env`, the systemd health-check, the nginx `proxy_pass`).

**Outcome:** ⬜ Not started.

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

**Outcome:** ⬜ Not started.

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

**Outcome:** ⬜ Not started.

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

**The backend's live HTTPS URL will be `https://partyledger.200-234-40-130.sslip.io`.**

**Outcome:** ⬜ Not started.

---

## 5. GitHub Actions — deploy SSH key

**What:** a dedicated keypair (separate from ITR's and the Trial-Balance-Converter's) so GitHub Actions can log into the VPS as `root` without your real password.

**Where:** Local Computer — **generate it outside any git working tree** (e.g. your home directory or a scratch folder, *not* inside `D:\CA-RMHStaffPortal\one-page-party-analysis`). The Trial-Balance-Converter deploy generated a key while `cd`'d into a git-tracked folder and got lucky that `.gitignore` never caught it in time — don't repeat that.

```powershell
cd $HOME
ssh-keygen -t ed25519 -f partyledger_deploy_key
```
Empty passphrase (Enter twice).

Install the public key on the VPS (append, don't overwrite — `~/.ssh/authorized_keys` already has ITR's and the Trial-Balance-Converter's keys in it):
```bash
nano ~/.ssh/authorized_keys
```

**Verify:**
```powershell
ssh -i partyledger_deploy_key root@200.234.40.130 "echo connected ok"
```

**Repo secrets** — GitHub → `rmhadvisorshr-hue/Party-Ledger-Analyzer` → **Settings → Secrets and variables → Actions**:

| Secret name | Value |
|---|---|
| `VPS_HOST` | `200.234.40.130` |
| `VPS_USER` | `root` |
| `VPS_APP_DIR` | `/opt/partyledger-backend/app` |
| `VPS_SSH_KEY` | full contents of `partyledger_deploy_key` |

Delete the local key files (`partyledger_deploy_key`, `partyledger_deploy_key.pub`) once the secret is saved.

**Outcome:** ⬜ Not started.

---

## 6. GitHub Actions — the workflow file

**What:** on every push to `backend/**` on `main`, rsync the backend to the VPS, install dependencies with the isolated Node, restart the service.

**Where:** already added to this repo at [.github/workflows/deploy-backend.yml](.github/workflows/deploy-backend.yml) — nothing to write by hand, just commit and push it, then trigger the first run manually (GitHub → **Actions** tab → **Deploy Backend** → **Run workflow**), since adding the workflow file itself doesn't touch `backend/**` and won't auto-trigger.

**Why `--exclude data --exclude server/uploads` matters** (see step 0): both are gitignored and hold state that only ever exists on the VPS — `rsync --delete` without excluding them would delete saved party overrides and the OCR cache on every single deploy.

**Outcome:** ⬜ Not started.

---

## 7. Point the frontend at this backend

Once the frontend has a real home, set two things:
1. Wherever the frontend's env vars live, point its API base URL at `https://partyledger.200-234-40-130.sslip.io`.
2. Update `FRONTEND_ORIGIN` in `/opt/partyledger-backend/app/.env` on the VPS to that frontend's real origin, then `systemctl restart partyledger-backend`.

Until then, CORS has nothing to allow, so only same-origin/no-origin requests (e.g. `curl`) will get through — expected, not a bug.

**Outcome:** ⬜ Not started — frontend hosting not yet decided.
