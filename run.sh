#!/usr/bin/env bash

set -euo pipefail

# Colors
CYAN='\033[36m'
NC='\033[0m'

help() {
  echo "
    ▗▖ ▗▖▗▖  ▗▖▗▄▄▄▖▗▄▄▄▖▗▄▄▄▖▗▖  ▗▖
    ▐▌ ▐▌▐▛▚▖▐▌  █  ▐▌   ▐▌    ▝▚▞▘
    ▐▌ ▐▌▐▌ ▝▜▌  █  ▐▛▀▀▘▐▛▀▀▘  ▐▌
    ▝▚▄▞▘▐▌  ▐▌▗▄█▄▖▐▌   ▐▌     ▐▌      ./run.sh
  "
  echo ""
  echo "Available commands:"
  echo ""
  echo -e "  ${CYAN}Setup${NC}"
  echo ""
  echo -e "  ${CYAN}install${NC}         Install all dependencies (uv + pnpm workspace)"
  echo -e "  ${CYAN}proto${NC}           Generate all protobuf code (python, typescript, go)"
  echo -e "  ${CYAN}clean${NC}           Clean generated files and caches"
  echo ""
  echo -e "  ${CYAN}Development${NC}"
  echo -e "  ${CYAN}dev${NC}             Containerized dev stack: backend + workers + ui + infra (default)"
  echo -e "  ${CYAN}dev-down${NC}        Stop the dev stack"
  echo -e "  ${CYAN}dev-logs [svc]${NC}  Tail dev stack logs (all services or one)"
  echo -e "  ${CYAN}dev-rebuild${NC}     Rebuild dev images from scratch (after Dockerfile change)"
  echo -e "  ${CYAN}dev-native${NC}      Native processes on host (infra still in containers) - legacy"
  echo -e "  ${CYAN}backend${NC}         Run backend natively with hot reload"
  echo -e "  ${CYAN}ui [cmd]${NC}        Run pnpm command in ui workspace (default: dev)"
  echo -e "  ${CYAN}mobile [cmd]${NC}    Run pnpm command in mobile workspace (default: start)"
  echo -e "  ${CYAN}mobile-dev${NC}      Run backend + mobile app in web view (native)"
  echo -e "  ${CYAN}worker-core${NC}     Run the core background worker natively"
  echo -e "  ${CYAN}worker-core-dev${NC} Run the core worker natively with hot reload"
  echo -e "  ${CYAN}worker-egress${NC}   Run the egress background worker natively"
  echo -e "  ${CYAN}worker-egress-dev${NC} Run the egress worker natively with hot reload"
  echo ""
  echo -e "  ${CYAN}Quality${NC}"
  echo -e "  ${CYAN}lint${NC}            Run all linters (backend + frontend)"
  echo -e "  ${CYAN}lint-backend${NC}    Run backend linter (ruff)"
  echo -e "  ${CYAN}lint-frontend${NC}   Run frontend linter (eslint)"
  echo -e "  ${CYAN}lint-mobile${NC}     Run mobile linter + format check"
  echo -e "  ${CYAN}format${NC}          Format backend code (ruff)"
  echo -e "  ${CYAN}test${NC}            Run backend tests"
  echo -e "  ${CYAN}test-frontend${NC}   Run frontend tests"
  echo -e "  ${CYAN}bench${NC}           Run performance benchmarks"
  echo ""
  echo -e "  ${CYAN}Database${NC}"
  echo -e "  ${CYAN}db-shell${NC}        Connect to database shell"
  echo -e "  ${CYAN}db-migrate${NC}      Run database migrations"
  echo ""
  echo -e "  ${CYAN}CLI${NC}"
  echo -e "  ${CYAN}cli-build${NC}       Build the unictl CLI binary"
  echo -e "  ${CYAN}cli-install${NC}     Build and install unictl to GOPATH/bin"
  echo -e "  ${CYAN}cli-run [args]${NC}  Run unictl without installing"
  echo -e "  ${CYAN}cli-lint${NC}        Run Go linters on unictl"
  echo -e "  ${CYAN}cli-test${NC}        Run unictl tests"
  echo ""
  echo -e "  ${CYAN}Calls${NC}"
  echo -e "  ${CYAN}livekit-logs${NC}    Tail LiveKit server logs"
  echo ""
  echo -e "  ${CYAN}Data${NC}"
  echo -e "  ${CYAN}data-reset${NC}      Wipe postgres + valkey + meilisearch + rustfs volumes; restart backend"
  echo ""
  echo -e "  ${CYAN}Ops${NC}"
  echo -e "  ${CYAN}licenses${NC}        Generate third-party license files"
  echo -e "  ${CYAN}docker-staging${NC}  Build and push Docker images for staging"
  echo -e "  ${CYAN}drop-staging-db${NC} Drop and recreate the staging db"
  echo ""
  echo -e "  ${CYAN}Landing${NC}"
  echo -e "  ${CYAN}landing-dev${NC}     Run the marketing landing page locally (Astro dev)"
  echo -e "  ${CYAN}landing-build${NC}   Build the marketing landing page (static + Pages Functions)"
  echo -e "  ${CYAN}landing-preview${NC} Preview production build via Wrangler Pages (BG geo-block active)"
  echo -e "  ${CYAN}landing-deploy${NC}  Build and deploy to Cloudflare Pages (project: uniffy-landing)"
}

install() {
  echo "Installing Python dependencies..."
  uv sync
  echo "Installing TypeScript dependencies (pnpm workspace)..."
  pnpm install
  echo "Tidying Go modules..."
  (cd src/gen/go && go mod tidy)
  (cd src/unictl && go mod tidy)
  echo "Done!"
}

docker_build_staging() {
  echo "Building Docker images for staging..."
  echo "building backend"
  docker build -f src/uniffy/Dockerfile \
    -t registry.uniffy.io/uniffy/backend:local-latest .
  docker push registry.uniffy.io/uniffy/backend:local-latest
  echo "building frontend"
  docker build -f src/ui/Dockerfile \
    --build-arg VITE_API_URL=https://staging.uniffy.io/api \
    --build-arg VITE_ENV=staging \
    -t registry.uniffy.io/uniffy/frontend:local-latest \
    .
  docker push registry.uniffy.io/uniffy/frontend:local-latest
}

proto() {
  echo "Generating protobuf code..."

  # Clean generated code (preserve package config files)
  rm -rf src/gen/python/src/uniffy_proto
  for pkg in src/proto/*/; do
    pkg_name=$(basename "$pkg")
    rm -rf "src/gen/typescript/$pkg_name"
  done
  find src/gen/go -name '*.go' -delete 2>/dev/null || true

  # Single generate pass (TS codegen binaries from ui workspace)
  PATH="$(pwd)/src/ui/node_modules/.bin:$PATH" buf generate

  # Python __init__.py files
  printf "import os\nimport sys\n\nsys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))\n" > src/gen/python/src/uniffy_proto/__init__.py
  for pkg in src/proto/*/; do
    pkg_name=$(basename "$pkg")
    mkdir -p "src/gen/python/src/uniffy_proto/$pkg_name/v1"
    touch "src/gen/python/src/uniffy_proto/$pkg_name/__init__.py"
    touch "src/gen/python/src/uniffy_proto/$pkg_name/v1/__init__.py"
  done

  # Go mod tidy (resolve deps)
  (cd src/gen/go && go mod tidy 2>/dev/null) || true
  (cd src/unictl && go mod tidy 2>/dev/null) || true

  echo "Protobuf code generated (python, typescript, go)!"
}

clean() {
  echo "Cleaning generated files..."
  rm -rf src/gen/python/src/uniffy_proto
  for pkg in src/proto/*/; do
    rm -rf "src/gen/typescript/$(basename "$pkg")"
  done
  find src/gen/go -name '*.go' -delete 2>/dev/null || true
  rm -rf src/uniffy/__pycache__ src/uniffy/**/__pycache__
  rm -rf src/ui/dist src/ui/node_modules/.vite
  echo "Cleaned!"
}

dev() {
  echo "Starting containerized dev stack..."
  echo "  App:      http://localhost (edge: UI + API + LiveKit signaling)"
  echo "  Landing:  http://localhost:4321"
  echo "  Workers:  core + egress (metrics 9091, 9092)"
  echo "  Direct:   backend :8000, vite :5173, livekit :7880 (tooling only)"
  echo ""
  echo "First start: builds dev images + runs uv sync + pnpm install (~3-5 min)."
  echo "Subsequent starts skip install when lockfiles are unchanged."
  echo ""
  docker compose --profile dev up
}

dev_down() {
  docker compose --profile dev down
}

dev_logs() {
  docker compose --profile dev logs -f "${1:-}"
}

dev_rebuild() {
  echo "Rebuilding dev images (no cache)..."
  docker compose --profile dev build --no-cache backend ui
}

dev_native() {
  echo "Starting native dev (host processes, infra still in containers)..."
  echo "  Backend:  http://0.0.0.0:8000"
  echo "  Frontend: http://0.0.0.0:5173"
  echo "  Workers:  core + egress"
  trap 'kill 0' EXIT
  uv run watchfiles --filter python "python -m uniffy --backend" src/uniffy/ src/gen/python/ &
  uv run watchfiles --filter python "python -m uniffy --worker-core" src/uniffy/ src/gen/python/ &
  uv run watchfiles --filter python "python -m uniffy --worker-egress" src/uniffy/ src/gen/python/ &
  pnpm --filter uniffy-ui dev
}

mobile_dev() {
  echo "Starting backend + mobile (web view)..."
  echo "Backend:     http://0.0.0.0:8000"
  echo "Mobile web:  http://0.0.0.0:8081"
  trap 'kill 0' EXIT
  uv run watchfiles --filter python "python -m uniffy --backend" src/uniffy/ src/gen/python/ &
  pnpm --filter uniffy-mobile exec npx expo start --web --port 8081
}

backend() {
  uv run watchfiles --filter python "python -m uniffy --backend" src/uniffy/ src/gen/python/
}

ui() {
  local cmd="${1:-dev}"
  pnpm --filter uniffy-ui "$cmd"
}

mobile() {
  local cmd="${1:-start}"
  pnpm --filter uniffy-mobile "$cmd"
}

lint() {
  lint_backend
  lint_frontend
  cli_lint
}

lint_backend() {
  uv run ruff check src/uniffy/ --exclude src/gen --fix
}

lint_frontend() {
  pnpm --filter uniffy-ui lint
}

lint_mobile() {
  pnpm --filter uniffy-mobile lint
  pnpm --filter uniffy-mobile format:check
}

format() {
  uv run ruff format src/uniffy/ --exclude src/gen
}

run_test() {
  uv run pytest src/uniffy/tests/ --ignore=src/uniffy/tests/benchmarks/
}

run_test_frontend() {
  pnpm --filter uniffy-ui test
}

run_bench() {
  echo "Running performance benchmarks..."
  uv run pytest src/uniffy/tests/benchmarks/ \
    --benchmark-only \
    --benchmark-group-by=func \
    --benchmark-sort=mean \
    --benchmark-columns=min,max,mean,stddev,rounds
}

db_shell() {
  docker compose exec postgres psql -U uniffy -d uniffy
}

db_migrate() {
  uv run alembic -c src/uniffy/alembic.ini upgrade head
}

db_drop_staging() {
  kubectl exec -it uniffy-db-1 -n uniffy -- psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'uniffy' AND pid <> pg_backend_pid();" -c "DROP DATABASE uniffy;"
  kubectl exec -it uniffy-db-1 -n uniffy -- psql -U postgres -c "CREATE DATABASE uniffy OWNER uniffy;"
}

livekit_logs() {
  docker compose logs -f livekit
}

data_reset() {
  cat <<'EOF'
This will WIPE the following docker volumes (data is gone):
  uniffy-local_postgres_data
  uniffy-local_valkey_data
  uniffy-local_meilisearch_data
  uniffy-local_rustfs_data
  uniffy-local_rustfs_logs

UI and landing containers stay running.
Backend + workers restart to re-run migrations against the empty Postgres.

EOF
  read -r -p "Continue? [y/N] " ans
  case "${ans:-N}" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; return 1 ;;
  esac
  set -x
  docker compose stop postgres valkey meilisearch rustfs
  docker compose rm -f postgres valkey meilisearch rustfs
  docker volume rm \
    uniffy-local_postgres_data \
    uniffy-local_valkey_data \
    uniffy-local_meilisearch_data \
    uniffy-local_rustfs_data \
    uniffy-local_rustfs_logs
  docker compose up -d postgres valkey meilisearch rustfs
  docker compose restart backend worker-core worker-egress
  set +x
  echo ""
  echo "Done. Tail backend logs to watch migrations:"
  echo "  docker compose logs -f backend"
}

worker_core() {
  echo "Starting core background worker..."
  uv run python -m uniffy --worker-core
}

worker_core_dev() {
  echo "Starting core background worker with hot reload..."
  uv run watchfiles --filter python "python -m uniffy --worker-core" src/uniffy/ src/gen/python/
}

worker_egress() {
  echo "Starting egress background worker..."
  uv run python -m uniffy --worker-egress
}

worker_egress_dev() {
  echo "Starting egress background worker with hot reload..."
  uv run watchfiles --filter python "python -m uniffy --worker-egress" src/uniffy/ src/gen/python/
}

licenses() {
  echo "Generating third-party licenses..."
  cat >docs/LICENSES.md <<'EOF'
# Third-Party Licenses

This file lists all third-party dependencies used in Uniffy and their licenses.

This file is auto-generated by running `./run.sh licenses`.

## Python Dependencies

EOF
  uv run pip-licenses --format=markdown --with-urls --ignore-packages uniffy >>docs/LICENSES.md
  echo -e "\n## Node.js Dependencies\n" >>docs/LICENSES.md
  echo "| Package | License | Homepage |" >>docs/LICENSES.md
  echo "|---------|---------|----------|" >>docs/LICENSES.md
  (cd src/ui && pnpm licenses list --prod --json 2>/dev/null | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);const rows=[];Object.entries(j).forEach(([lic,pkgs])=>pkgs.forEach(p=>rows.push([p.name+'@'+p.versions[0],lic,p.homepage||''])));rows.sort((a,b)=>a[0].localeCompare(b[0])).forEach(r=>console.log('| '+r[0]+' | '+r[1]+' | '+r[2]+' |'));" >>../../docs/LICENSES.md)
  echo "Third-party licenses generated in docs/LICENSES.md"
}

cli_build() {
  echo "Building unictl..."
  (cd src/unictl && go build -o unictl .)
  echo "Built: src/unictl/unictl"
}

cli_install() {
  echo "Installing unictl to GOPATH/bin..."
  (cd src/unictl && go install .)
  echo "Installed: $(which unictl || echo 'unictl (check GOPATH/bin is in PATH)')"
}

cli_run() {
  (cd src/unictl && go run . "$@")
}

cli_lint() {
  echo "Linting unictl..."
  (cd src/unictl && go vet ./...)
  echo "Lint passed!"
}

cli_test() {
  echo "Running unictl tests..."
  (cd src/unictl && go test ./...)
}

landing_dev() {
  echo "Starting landing page dev server..."
  pnpm --filter uniffy-landing dev
}

landing_build() {
  echo "Building landing page..."
  pnpm --filter uniffy-landing build
}

landing_preview() {
  landing_build
  echo "Previewing via Wrangler Pages (geo-block active when CF_PAGES env present)..."
  (cd src/landing && pnpm exec wrangler pages dev dist)
}

landing_deploy() {
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ ! -f "$HOME/.wrangler/config/default.toml" ]; then
    echo "Warning: CLOUDFLARE_API_TOKEN not set and no Wrangler login detected."
    echo "Run 'pnpm --filter uniffy-landing exec wrangler login' first, or export CLOUDFLARE_API_TOKEN."
  fi
  landing_build
  echo "Deploying to Cloudflare Pages (project: uniffy-landing, branch: main = production)..."
  (cd src/landing && pnpm exec wrangler pages deploy dist --project-name uniffy-landing --branch main --commit-dirty=true)
  echo "Deploy complete. Geo-block active: only requests with cf-ipcountry=BG are served."
}

# Main dispatch
case "${1:-help}" in
install) install ;;
proto) proto ;;
clean) clean ;;
dev) dev ;;
dev-down) dev_down ;;
dev-logs) shift; dev_logs "${1:-}" ;;
dev-rebuild) dev_rebuild ;;
dev-native) dev_native ;;
mobile-dev) mobile_dev ;;
backend) backend ;;
ui) ui "${2:-}" ;;
mobile) mobile "${2:-}" ;;
lint) lint ;;
lint-frontend) lint_frontend ;;
lint-backend) lint_backend ;;
lint-mobile) lint_mobile ;;
format) format ;;
test) run_test ;;
test-frontend) run_test_frontend ;;
bench) run_bench ;;
db-shell) db_shell ;;
db-migrate) db_migrate ;;
worker-core) worker_core ;;
worker-core-dev) worker_core_dev ;;
worker-egress) worker_egress ;;
worker-egress-dev) worker_egress_dev ;;
licenses) licenses ;;
cli-build) cli_build ;;
cli-install) cli_install ;;
cli-run) shift; cli_run "$@" ;;
cli-lint) cli_lint ;;
cli-test) cli_test ;;
docker-staging) docker_build_staging ;;
drop-staging-db) db_drop_staging ;;
landing-dev) landing_dev ;;
landing-build) landing_build ;;
landing-preview) landing_preview ;;
landing-deploy) landing_deploy ;;
livekit-logs) livekit_logs ;;
data-reset) data_reset ;;
help | *) help ;;
esac
