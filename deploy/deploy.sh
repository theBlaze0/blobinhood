#!/usr/bin/env bash
# Deploy Blobin Hood to the droplet.
#   ./deploy/deploy.sh [user@ip]
# Requires the ChipIn ("the-pot") stack to be running there — its Caddy owns
# 443 and proxies blobinhood.online to this container (vhost lives in
# Chip-In/deploy/Caddyfile).
set -euo pipefail

SSH_TARGET="${1:-root@147.182.206.111}"
REMOTE_DIR=/opt/blobinhood
COMMIT=$(git rev-parse --short HEAD)

echo "==> Syncing repo to $SSH_TARGET:$REMOTE_DIR"
ssh "$SSH_TARGET" "mkdir -p $REMOTE_DIR"
rsync -az --delete --exclude node_modules --exclude .git ./ "$SSH_TARGET:$REMOTE_DIR/"

echo "==> Building & starting (commit $COMMIT, token '${TOKEN_ADDRESS:-none}')"
ssh "$SSH_TARGET" "cd $REMOTE_DIR && COMMIT=$COMMIT TOKEN_ADDRESS='${TOKEN_ADDRESS:-}' docker compose -f deploy/docker-compose.prod.yml up -d --build"

echo "==> Done — served as https://blobinhood.online once DNS points at the droplet"
