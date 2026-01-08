.PHONY: help proto clean dev run install db-up db-down db-reset db-logs

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies
	@echo "Installing Python dependencies..."
	uv sync
	@echo "Installing UI dependencies..."
	cd src/ui && pnpm install
	@echo "Done!"

proto: ## Generate all protobuf code (backend + UI)
	@echo "Generating protobuf code..."
	rm -rf src/uwos/gen src/ui/src/gen
	PATH="$(PWD)/src/ui/node_modules/.bin:$(PATH)" buf generate
	touch src/uwos/gen/__init__.py
	touch src/uwos/gen/auth/__init__.py 
	touch src/uwos/gen/auth/v1/__init__.py
	touch src/uwos/gen/notes/v1/__init__.py
	touch src/uwos/gen/notes/__init__.py
	@echo "Protobuf code generated for backend and UI!"

clean: ## Clean generated files
	@echo "Cleaning generated files..."
	rm -rf src/uwos/gen src/ui/src/gen
	rm -rf src/uwos/__pycache__ src/uwos/**/__pycache__
	rm -rf src/ui/dist src/ui/node_modules/.vite
	@echo "Cleaned!"

db-up: ## Start PostgreSQL database
	@echo "Starting PostgreSQL 18..."
	docker-compose up -d postgres
	@echo "Waiting for database to be ready..."
	@sleep 3
	docker-compose ps postgres
	@echo "Database ready at localhost:5432"

db-down: ## Stop PostgreSQL database
	@echo "Stopping PostgreSQL..."
	docker-compose down

db-reset: ## Reset database (removes all data!)
	@echo "⚠️  This will delete all database data!"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker-compose down -v; \
		docker-compose up -d postgres; \
		echo "Database reset complete"; \
	else \
		echo "Cancelled"; \
	fi

db-logs: ## Show database logs
	docker-compose logs -f postgres

db-shell: ## Connect to database shell
	docker-compose exec postgres psql -U uwos -d uwos

db-migrate: ## Run migrations
	uv run alembic -c src/uwos/alembic.ini upgrade head

dev: ## Run both backend and frontend in development mode
	@echo "Starting development servers..."
	@echo "Backend: http://0.0.0.0:8000"
	@echo "Frontend: http://0.0.0.0:5173"
	@trap 'kill 0' EXIT; \
	uv run -m uwos.main & \
	cd src/ui && pnpm dev

run: ## Run backend server only
	uv run -m uwos.main

ui: ## Run frontend dev server only
	cd src/ui && pnpm dev

build-ui: ## Build frontend for production
	cd src/ui && pnpm build

lint: ## Run linters
	uv run ruff check src/uwos/
	cd src/ui && pnpm run lint

format: ## Format code
	uv run ruff format src/uwos/

test: ## Run tests
	uv run pytest

.DEFAULT_GOAL := help
