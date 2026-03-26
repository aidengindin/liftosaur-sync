# Docker Image via Nix + GHCR Push Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Docker image using `pkgs.dockerTools.buildLayeredImage` in the Nix flake and publish it to GHCR via GitHub Actions on every push to `main`.

**Architecture:** Add a `dockerImage` output to `flake.nix` using Nixpkgs' `dockerTools.buildLayeredImage`, which wraps the existing `liftosaur-sync` package. GitHub Actions installs Nix, builds the image derivation, loads it into Docker, and pushes to `ghcr.io/aidengindin/liftosaur-sync`.

**Tech Stack:** Nix (`pkgs.dockerTools.buildLayeredImage`), GitHub Actions, GHCR (`ghcr.io`), `DeterminateSystems/nix-installer-action`, `docker/login-action`, `docker/metadata-action`.

---

### Task 1: Create the feature branch

**Files:** none

**Step 1: Create and switch to branch**

```bash
git checkout -b feature/docker-nix-ghcr
```

**Step 2: Verify**

```bash
git branch --show-current
```
Expected: `feature/docker-nix-ghcr`

---

### Task 2: Add `dockerImage` output to `flake.nix`

**Files:**
- Modify: `flake.nix` (inside the `eachDefaultSystem` block, after the `apps` output)

Add a `dockerImage` package using `buildLayeredImage`. It wraps the existing `liftosaur-sync` package so there's no duplication.

**Step 1: Add the dockerImage output**

In `flake.nix`, inside the `eachDefaultSystem` lambda, add to the returned attrset:

```nix
packages = {
  default = liftosaur-sync;
  dockerImage = pkgs.dockerTools.buildLayeredImage {
    name = "ghcr.io/aidengindin/liftosaur-sync";
    tag = "latest";
    contents = [ liftosaur-sync pkgs.cacert ];
    config = {
      Cmd = [ "${liftosaur-sync}/bin/liftosaur-sync" ];
      ExposedPorts = { "3000/tcp" = {}; };
      WorkingDir = "/data";
      Env = [ "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt" ];
    };
  };
};
```

Note: `packages.default` replaces the current top-level `packages.default = liftosaur-sync` line.
`pkgs.cacert` is needed so HTTPS calls to Liftosaur/Intervals/Strava work inside the container.
`WorkingDir = "/data"` is where SQLite (`sync-state.db`) will be written at runtime (mounted as a volume).

**Step 2: Verify the flake evaluates**

```bash
nix flake check --no-build
```
Expected: exits 0 with no errors (warnings about `dockerImage` only building on Linux are OK on macOS).

**Step 3: Commit**

```bash
git add flake.nix
git commit -m "feat: add dockerImage output using pkgs.dockerTools.buildLayeredImage"
```

---

### Task 3: Create GitHub Actions workflow

**Files:**
- Create: `.github/workflows/docker.yml`

**Step 1: Create the workflow directory**

```bash
mkdir -p .github/workflows
```

**Step 2: Write the workflow file**

```yaml
name: Build and push Docker image

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Nix
        uses: DeterminateSystems/nix-installer-action@v14

      - name: Set up Nix cache
        uses: DeterminateSystems/magic-nix-cache-action@v8

      - name: Build Docker image
        run: nix build .#dockerImage --out-link docker-image

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=sha-
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Load and push image
        run: |
          IMAGE=$(docker load < docker-image | awk '{print $NF}')
          echo "Loaded image: $IMAGE"
          for TAG in ${{ join(fromJSON(steps.meta.outputs.json).tags, ' ') }}; do
            docker tag "$IMAGE" "$TAG"
            docker push "$TAG"
          done
```

Key points:
- `GITHUB_TOKEN` is auto-provided by Actions — no secrets setup needed for GHCR.
- `docker/metadata-action` generates two tags: `sha-<short-sha>` and `latest` (on `main`).
- The `docker load < docker-image` command loads the Nix-built `.tar.gz` stream; `awk '{print $NF}'` extracts the `name:tag` from the "Loaded image: ..." output line.
- `magic-nix-cache-action` caches Nix store paths in GitHub Actions cache for faster rebuilds.

**Step 3: Verify YAML syntax locally (optional)**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/docker.yml'))" && echo "OK"
```
Expected: `OK`

**Step 4: Commit**

```bash
git add .github/workflows/docker.yml
git commit -m "ci: add GitHub Actions workflow to build and push Docker image to GHCR"
```

---

### Task 4: Push and verify

**Step 1: Push the branch**

```bash
git push -u origin feature/docker-nix-ghcr
```

**Step 2: Open a PR or merge to main**

The workflow only fires on pushes to `main`. Merge the PR (or push directly) to trigger the first build.

**Step 3: Verify on GitHub**

- Actions tab → "Build and push Docker image" → should pass
- `github.com/aidengindin/liftosaur-sync/pkgs/container/liftosaur-sync` → image should appear

---

## Runtime usage

```bash
docker run -d \
  -p 3000:3000 \
  -v /path/to/data:/data \
  --env-file .env \
  ghcr.io/aidengindin/liftosaur-sync:latest
```

The SQLite database is written to `/data/sync-state.db` inside the container (mount a volume at `/data`).
