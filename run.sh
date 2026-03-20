#!/usr/bin/env bash
set -euo pipefail

# Colors
CYAN='\033[36m'
NC='\033[0m'

help() {
  echo "Usage: ./run.sh <command>"
  echo ""
  echo "Available commands:"
  echo ""
  echo -e "  ${CYAN}Setup${NC}"
  echo -e "  ${CYAN}install${NC}         Install all dependencies (uv + pnpm workspace)"
  echo -e "  ${CYAN}proto${NC}           Generate all protobuf code (python, typescript, go)"
  echo -e "  ${CYAN}clean${NC}           Clean generated files and caches"
  echo ""
  echo -e "  ${CYAN}Development${NC}"
  echo -e "  ${CYAN}dev${NC}             Run backend + frontend + worker (all-in-one)"
  echo -e "  ${CYAN}backend${NC}         Run backend with hot reload"
  echo -e "  ${CYAN}ui [cmd]${NC}        Run pnpm command in ui workspace (default: dev)"
  echo -e "  ${CYAN}mobile [cmd]${NC}    Run pnpm command in mobile workspace (default: start)"
  echo -e "  ${CYAN}mobile-dev${NC}      Run backend + mobile app in web view"
  echo -e "  ${CYAN}worker${NC}          Run background worker"
  echo -e "  ${CYAN}worker-dev${NC}      Run worker with hot reload"
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
  echo -e "  ${CYAN}Ops${NC}"
  echo -e "  ${CYAN}licenses${NC}        Generate third-party license files"
  echo -e "  ${CYAN}docker-staging${NC}  Build and push Docker images for staging"
  echo -e "  ${CYAN}drop-staging-db${NC} Drop and recreate the staging db"
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
  echo "Starting development servers..."
  echo "Backend: http://0.0.0.0:8000"
  echo "Frontend: http://0.0.0.0:5173"
  echo "Worker: background tasks"
  trap 'kill 0' EXIT
  uv run watchfiles --filter python "python -m uniffy.main" src/uniffy/ src/gen/python/ &
  uv run watchfiles --filter python "python -m uniffy.worker" src/uniffy/ src/gen/python/ &
  pnpm --filter uniffy-ui dev
}

mobile_dev() {
  echo "Starting backend + mobile (web view)..."
  echo "Backend:     http://0.0.0.0:8000"
  echo "Mobile web:  http://0.0.0.0:8081"
  trap 'kill 0' EXIT
  uv run watchfiles --filter python "python -m uniffy.main" src/uniffy/ src/gen/python/ &
  pnpm --filter uniffy-mobile exec npx expo start --web --port 8081
}

backend() {
  uv run watchfiles --filter python "python -m uniffy.main" src/uniffy/ src/gen/python/
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

worker() {
  echo "Starting background worker..."
  uv run python -m uniffy.worker
}

worker_dev() {
  echo "Starting background worker with hot reload..."
  uv run watchfiles --filter python "python -m uniffy.worker" src/uniffy/ src/gen/python/
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

# Main dispatch
case "${1:-help}" in
install) install ;;
proto) proto ;;
clean) clean ;;
dev) dev ;;
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
worker) worker ;;
worker-dev) worker_dev ;;
licenses) licenses ;;
cli-build) cli_build ;;
cli-install) cli_install ;;
cli-run) shift; cli_run "$@" ;;
cli-lint) cli_lint ;;
cli-test) cli_test ;;
docker-staging) docker_build_staging ;;
drop-staging-db) db_drop_staging ;;
help | *) help ;;
esac
