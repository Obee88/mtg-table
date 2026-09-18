# Deploying to vps.codes.hr — Guide for Managed Projects

This document is for agents (or developers) working on a project that will be deployed and managed by the VPS deploy-manager at `vps.codes.hr`. Read it before writing any Dockerfile, CI workflow, or infrastructure code.

---

## How the platform works

The VPS runs a single Docker host on Hetzner with three always-on platform services:

- **Caddy** (via `caddy-docker-proxy`) — the reverse proxy. It auto-routes HTTPS traffic to any container that carries the right labels and is joined to the `codes-vps_edge` network. TLS (Let's Encrypt) is handled automatically; you don't manage certs.
- **Postgres 16** — a shared cluster. Each managed project gets its own dedicated database and role, provisioned automatically by the dashboard when the project is created. You never touch the superuser credentials.
- **Dashboard** at `https://vps.codes.hr` — the control plane. It receives signed webhooks from GitHub Actions, pulls the new image from GHCR, writes a `compose.yml` for your project under `/opt/vps/projects/<slug>/`, and runs `docker compose up -d`. It also manages env vars, secrets, deploy history, rollbacks, and logs.

---

## What your project must provide

### 1. A Docker image published to GHCR

Your image must be built and pushed to GitHub Container Registry on every push to `main`. The image name must follow this convention:

```
ghcr.io/<github-org-or-user>/<project-slug>:<git-sha>
```

Where `<project-slug>` is the short identifier you registered in the dashboard (lowercase, hyphens only). The dashboard rejects any image whose name doesn't start with the configured `imageName` prefix.

A minimal GH Actions workflow for this:

```yaml
# .github/workflows/deploy.yml
name: Build & Deploy

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - id: meta
        run: |
          echo "sha=${GITHUB_SHA::12}" >> "$GITHUB_OUTPUT"
          echo "owner=$(echo '${{ github.repository_owner }}' | tr '[:upper:]' '[:lower:]')" >> "$GITHUB_OUTPUT"

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ steps.meta.outputs.owner }}/<project-slug>:${{ steps.meta.outputs.sha }}
            ghcr.io/${{ steps.meta.outputs.owner }}/<project-slug>:latest

      - name: Notify VPS dashboard
        run: |
          URL=$(printf '%s' "${{ secrets.WEBHOOK_URL }}" | tr -d '[:space:]')
          TS=$(date +%s)
          BODY=$(jq -nc \
            --arg image "ghcr.io/${{ steps.meta.outputs.owner }}/<project-slug>:${{ steps.meta.outputs.sha }}" \
            --arg sha "${{ steps.meta.outputs.sha }}" \
            --argjson ts "$TS" \
            '{ image: $image, sha: $sha, ts: $ts }')
          SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "${{ secrets.WEBHOOK_SECRET }}" | awk '{print $2}')"
          curl -sf -X POST "$URL" \
            -H "Content-Type: application/json" \
            -H "X-Signature: $SIG" \
            -d "$BODY"
```

Set two repository secrets in GitHub: `WEBHOOK_URL` and `WEBHOOK_SECRET`. Both are displayed in the dashboard after you register the project. The exact workflow snippet (already filled in with your slug and URL) is also shown in the dashboard's setup checklist.

### 2. A Dockerfile

Write a standard multi-stage Dockerfile. The final stage should run as a non-root user. There are no other constraints on the base image or build approach.

Key requirements:
- The app must listen on a **single TCP port** (you configure this in the dashboard when adding the project).
- If the app has a health endpoint (recommended — `GET /healthz` returning 200 is enough), configure it as the `HEALTHCHECK` in your Dockerfile. The deployer will wait up to 60 seconds for the container to become healthy before marking the deployment successful.

```dockerfile
# Example for a Node.js backend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "dist/server.js"]
```

**How `localhost` and port numbers work in a HEALTHCHECK**

The `HEALTHCHECK CMD` runs _inside the container_, so `localhost:<port>` refers to the container's own loopback — not the host machine. Two things must be true for the check to succeed:

1. **The port in the `HEALTHCHECK` must be the container-internal port** — the port your app actually listens on inside the container. If you run locally with `docker run -p 8080:3000 …`, Docker maps host port 8080 → container port 3000, but the health check always uses `localhost:3000`, not `8080`.

2. **Your app must bind to `0.0.0.0` (or at least `127.0.0.1`) on that port.** Some frameworks default to binding only on `127.0.0.1`, which works fine for the health check (it still resolves inside the container). What will break the health check is binding to a specific non-loopback interface, or binding to a _different_ port than the one in the `HEALTHCHECK` line.

The port you configure in the dashboard must also match this same container-internal port — it's what the dashboard tells Caddy to forward traffic to.

### 3. DNS

Add a CNAME (or A record) for your project's domain pointing at the VPS IP (`vps.codes.hr` resolves to it). The dashboard's setup checklist shows the exact DNS record to create. Caddy picks up the domain automatically via the container labels it writes — you don't write any Caddyfile.

---

## Infrastructure the platform provides

| Resource | What you get | How |
|---|---|---|
| **HTTPS** | Auto-TLS via Let's Encrypt for any domain you register | Done by Caddy — no action needed |
| **PostgreSQL database** | Dedicated DB + role (`app_<slug>`) with a random password | Toggle "Provision database" when creating the project in the dashboard |
| **DATABASE_URL** | Auto-injected into your container's environment | Dashboard writes it to the project's `.env`; treat it as always available |
| **Reverse proxy** | Traffic on 80/443 routed to your container | Done via Caddy labels the dashboard writes — no action needed |
| **Docker networks** | Your container joins `codes-vps_edge` (internet-facing) and `codes-vps_data` (Postgres access) | Done by the dashboard's generated `compose.yml` |

---

## Environment variables and secrets

Manage all env vars in the dashboard under your project's settings page. The dashboard encrypts values you mark as secrets (AES-256-GCM at rest). They are written to a `.env` file alongside your `compose.yml` at deploy time.

**`DATABASE_URL` is always auto-managed** — don't set it manually. It's injected automatically when the database flag is on. Your app should read it from the environment with no defaults; the platform guarantees its presence when the container starts.

For a typical webapp:

```
# Set these in the dashboard, not in your repo
SECRET_KEY=…
SMTP_HOST=…
REDIS_URL=…          # if you bring your own Redis container later
```

Do **not** commit `.env` files or hardcoded secrets to your repo.

---

## For a FE + BE + database webapp

The platform deploys containers, not Compose stacks. Run your frontend and backend as **separate projects** registered in the dashboard, each with its own slug, image, and domain. There is no shared `docker-compose.yml` in your repo for production.

Typical setup:

| Project slug | Domain | Port | DB? |
|---|---|---|---|
| `myapp-api` | `api.myapp.com` | 8080 | ✅ yes |
| `myapp-web` | `myapp.com` | 3000 | ❌ no |

If you ship a single container that serves both FE and BE (e.g. a Next.js app with an API route), that's one project, one slug, and simpler to manage.

### ⚠️ No inter-container networking between projects

This is the most common cause of a crash-loop on first deploy. **Different projects cannot reach each other by container name.** Each project runs in its own Compose stack and its own Docker network. A hostname like `scanner-api` or `myapp-api` does not resolve inside another project's container.

If your **nginx config** proxies to a backend by container name, nginx will fail to start with `host not found in upstream` and the container will crash-loop immediately:

```nginx
# ❌ Works locally, CRASH-LOOPS on this platform:
upstream backend {
    server scanner-api:8080;   # "scanner-api" doesn't resolve here
}
```

**Fix:** deploy the backend first, give it a domain, and reference it by that public URL:

```nginx
# ✅ Correct for this platform:
location /api/ {
    proxy_pass https://api.myapp.com;
    proxy_set_header Host api.myapp.com;
}
```

The same rule applies to any code that calls a sibling service — a Next.js `fetch`, a Python `requests.get`, anything. Use the public HTTPS URL, not the container name.

**Deploy order matters:** register and deploy the backend project first so its domain is live before the frontend tries to reach it. For the initial deploy you can point at a placeholder or add a startup retry, but the domain must resolve.

---

## Common deployment pitfalls

These are real issues that came up during the first deploy of a project on this platform. Save yourself the same debug cycles.

### 1. GHCR image names must be fully lowercase

`github.repository_owner` can contain uppercase letters (e.g. `DavorO`), and GHCR silently rejects image pushes or tags that aren't all-lowercase. The GitHub Actions expression syntax does **not** support `| lower` filters — that's Liquid, not Actions expressions, and it will render literally.

**Fix:** compute the lowercase owner in a dedicated step and store it as a step output:

```yaml
- id: meta
  run: |
    echo "sha=${GITHUB_SHA::12}" >> "$GITHUB_OUTPUT"
    echo "owner=$(echo '${{ github.repository_owner }}' | tr '[:upper:]' '[:lower:]')" >> "$GITHUB_OUTPUT"
```

Then reference `${{ steps.meta.outputs.owner }}` everywhere — in the image tag AND in the webhook payload. Inconsistency between the two will cause the dashboard to reject the deploy even if the image push succeeded.

### 2. Webhook URL secrets can carry hidden whitespace

When you copy-paste the `WEBHOOK_URL` from the dashboard into the GitHub secret field, it's easy to accidentally include a trailing newline or space. This causes `curl` to fail with a "Could not resolve host" error that looks like a network problem rather than a secret misconfiguration.

**Fix:** strip whitespace from the secret before using it:

```bash
URL=$(printf '%s' "$URL" | tr -d '[:space:]')
```

Add this as the very first line of your `run:` block before the `curl` call.

### 3. Unquoted shell substitutions inside jq args break silently

Using `--argjson ts $(date +%s)` inline inside a `jq` call works in most shells locally, but in GitHub Actions the word-splitting can behave differently and produce subtle failures.

**Fix:** always assign the value to a variable first:

```bash
TS=$(date +%s)
BODY=$(jq -nc --argjson ts "$TS" ...)
```

### 4. Image name in the webhook payload must exactly match the pushed tag

The dashboard validates that the `image` field in the webhook body starts with the `imageName` prefix configured for your project. If your push step uses one form (e.g. `ghcr.io/owner/slug:sha`) and your webhook payload hardcodes a different form (e.g. `ghcr.io/davor/slug:sha`), the deploy will be rejected even though the image exists in GHCR.

**Fix:** derive the image name once (ideally in the `meta` step) and reuse the same variable in both the `tags:` input and the `BODY` payload. Never hardcode the org name in more than one place.

### 5. The example workflow in this guide uses an outdated action version

The template above uses `docker/build-push-action@v5`. The current stable version is **v6** and includes Buildx caching improvements. Use `@v6` from the start and add `docker/setup-buildx-action@v3` as a step before the build:

```yaml
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: |
      ghcr.io/${{ steps.meta.outputs.owner }}/<slug>:${{ steps.meta.outputs.sha }}
      ghcr.io/${{ steps.meta.outputs.owner }}/<slug>:latest
```

### 6. Frontend nginx configs must use public URLs, not container names

A very common pattern in local development is to run frontend + backend with Docker Compose and have nginx proxy `/api/` to the backend by container name:

```nginx
# Works locally — BREAKS on this platform:
upstream backend {
    server scanner-api:8080;
}
```

On this platform every project is its own Compose stack in its own network. `scanner-api` (or whatever your backend container is named) is invisible to the frontend container. **Nginx will refuse to start** if it can't resolve an upstream host at boot time — the container crashes immediately, Docker restarts it, and you get a crash loop with `host not found in upstream` in the logs.

**Fix:** deploy the backend as a separate project first, give it a domain, then reference it by that public URL in the nginx config:

```nginx
# Works on this platform:
location /api/ {
    proxy_pass https://api.yourdomain.com;
    proxy_set_header Host api.yourdomain.com;
}
```

If you want to avoid the extra HTTPS round-trip, use nginx's `resolver` directive with a TTL and `resolve` flag so nginx doesn't resolve upstreams at startup:

```nginx
resolver 127.0.0.11 valid=30s;  # Docker's embedded DNS
location /api/ {
    set $backend http://scanner-api:8080;
    proxy_pass $backend;
}
```

But the simplest and most robust approach for this platform is public HTTPS between services.

### 7. Don't use `bash` in your HEALTHCHECK — use `sh` or `wget`

Many minimal images (Alpine, slim variants, distroless) ship only `/bin/sh`, not `bash`. If your `HEALTHCHECK` line reads:

```dockerfile
HEALTHCHECK CMD bash -c "curl http://localhost:3000/healthz"
```

…then on any Alpine-based image the probe immediately exits 127 ("bash: not found"), Docker marks the container unhealthy, and the deploy fails — even if your app is working perfectly.

**Fix:** use `wget` (always present on Alpine) or `sh -c` instead:

```dockerfile
# Preferred for Alpine/BusyBox images:
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=30s \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# For Debian/Ubuntu images that have curl:
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -fs http://localhost:3000/healthz || exit 1
```

The same applies to the probe generated by the dashboard from your `healthcheckPath` setting — it now uses `CMD-SHELL` (sh) for the same reason.

**--start-period matters.** Docker doesn't count healthcheck failures against the retry limit during the `start_period`. If your app takes longer than the default to boot (Next.js, JVM apps), set `--start-period` to at least 30s. A container that fails 3 probes before the app has finished booting will be marked unhealthy even if the app would have been fine.

### 7. HEALTHCHECK port must match the container-internal port, not a host mapping

A common mistake when testing locally: you run `docker run -p 8080:3000 myimage` (mapping host port 8080 to container port 3000), verify `curl localhost:8080/healthz` works from your terminal, then assume everything is fine — but the `HEALTHCHECK CMD` inside the container is still probing `localhost:3000`. If those don't match, Docker marks the container unhealthy and the deployer times out waiting.

**The rule:** the port in `HEALTHCHECK CMD wget -qO- http://localhost:<port>/healthz` must be the port your app listens on _inside_ the container. This is the same number in `EXPOSE <port>` and the same number you enter in the dashboard. Host-side port mappings (`-p host:container`) are irrelevant to the health check.

**To verify locally before pushing:**

```bash
docker run -d --name test -p 8080:3000 myimage
# Wait a few seconds, then check Docker's own health status:
docker inspect --format='{{.State.Health.Status}}' test
# Should print: healthy
# NOT: starting (still waiting) or unhealthy
```

If `docker inspect` shows `unhealthy`, run `docker inspect --format='{{json .State.Health}}' test | jq .Checks` to see the actual error from the probe command.

---

## Checklist before your first push

- [ ] If this project calls another service: that service is deployed first and reachable via its public domain — no container names in nginx configs or `fetch()` calls
- [ ] Dockerfile builds and the image runs locally with `docker run -e DATABASE_URL=… -p <port>:<port> <image>`
- [ ] Health endpoint returns 200 (`/healthz` or similar)
- [ ] `HEALTHCHECK` in Dockerfile uses `wget` or `sh -c curl`, **not** `bash -c` (bash may not be present in minimal images)
- [ ] `HEALTHCHECK --start-period` is long enough for your app to boot (≥ 30s for Node/Next.js)
- [ ] Verify locally: `docker run -d --name test <image> && sleep 15 && docker inspect --format='{{.State.Health.Status}}' test` → should print `healthy`
- [ ] `WEBHOOK_URL` and `WEBHOOK_SECRET` set as GitHub repo secrets (paste carefully — no trailing whitespace)
- [ ] Project registered in the dashboard (slug, image name, port, domain, DB flag)
- [ ] Image name in the workflow (`tags:`) and in the webhook `BODY` use the **same** variable — not hardcoded strings
- [ ] `github.repository_owner` is lowercased before being used in image tags (see pitfalls above)
- [ ] DNS record created and propagated
- [ ] Push to `main` — watch the deployment row go `pending → running → success` in the dashboard

---

## Limitations (v1)

- **Single host** — no horizontal scaling. The CPX22 (2 vCPU, 4 GB RAM) is the ceiling.
- **One Postgres cluster** — all projects share the same Postgres instance. Schema migrations are your responsibility; the platform provisions the role/DB but does not run migrations for you. Run them at container startup (recommended) or as a one-off task.
- **No inter-project private networking** — services talk to each other over HTTPS, not over a Docker internal network.
- **No built-in object storage** — bring your own (Cloudflare R2, S3, etc.) and inject credentials via the dashboard env vars.
