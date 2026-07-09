.PHONY: help install build typecheck dev dev-api dev-services dev-web down rebuild test lint clean migrate-dev migrate-deploy migrate-push migrate-studio db-refresh-collation library-refresh-titles-dry library-refresh-titles-apply cc

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies (Bun workspaces)
	cd "$(CURDIR)" && bun install
	@echo "✓ Dependencies installed!"
	@echo "  Start services: make dev-services"
	@echo "  Start API:      make dev-api"
	@echo "  Start frontend: make dev-web"

build: ## Build frontend for production
	cd apps/web && bun run build

typecheck: ## Typecheck all workspaces that define typecheck (web, api, shared)
	bun run typecheck

dev-services: ## Start only database and Redis services
	docker compose -p rawkoon-dev -f docker-compose.yml up db redis -d

dev-api: ## Start TypeScript/Bun API locally with hot reload
	cd apps/api && bun run dev

dev-web: ## Start React frontend with live reload
	cd apps/web && bun run dev

dev: ## Show development setup instructions
	@echo "Development setup:"
	@echo ""
	@echo "  Repo docker-compose.yml: PostgreSQL + Redis only."
	@echo "  Run API and web on the host:"
	@echo "    1. make dev-services  # Start PostgreSQL + Redis"
	@echo "    2. make dev-api       # Bun API with hot reload"
	@echo "    3. make dev-web       # Vite frontend"
	@echo ""
	@echo "Production-like Docker (API + frontend + DB + Redis): copy"
	@echo "  docker-compose.prod-example.yml → docker-compose.prod.yml and use that file."

down: ## Stop Docker containers
	docker compose -p rawkoon-dev -f docker-compose.yml down

rebuild: ## Rebuild Docker containers (fixes dependency issues)
	@echo "Rebuilding Docker containers..."
	docker compose -p rawkoon-dev -f docker-compose.yml build --no-cache
	@echo "✓ Containers rebuilt. Start with: make dev-api"

test: ## Run all tests (web, api, shared)
	cd "$(CURDIR)" && bun run test

lint: ## Lint web and API (Biome — same command as CI)
	cd "$(CURDIR)" && bun run lint

clean: ## Clean all build artifacts and caches
	@echo "Cleaning build artifacts..."
	rm -rf apps/web/dist
	rm -rf node_modules apps/*/node_modules
	docker compose -p rawkoon-dev -f docker-compose.yml down -v

cc: ## Run Claude headless: make cc "your message"
	@claude -p "$(filter-out $@,$(MAKECMDGOALS))" --allowedTools "Edit,Read,Bash,Grep"

%:
	@:

# ===== Database Migrations (Prisma) =====

migrate-dev: ## Create a new migration during development
	@echo "Creating migration..."
	cd apps/api && bun run db:migrate:dev

migrate-deploy: ## Apply pending migrations (production)
	@echo "Applying migrations..."
	cd apps/api && bun run db:migrate

migrate-push: ## Push schema changes to database (development only, bypasses migrations)
	@echo "Pushing schema changes..."
	cd apps/api && bun run db:push

migrate-studio: ## Open Prisma Studio for database exploration
	@echo "Opening Prisma Studio..."
	cd apps/api && bun run db:studio

library-refresh-titles-dry: ## Preview en-US TMDB refresh for library titles (dry-run, no DB writes)
	cd apps/api && bun --env-file=../../.env src/scripts/refreshLibraryTitlesFromTmdb.ts

library-refresh-titles-apply: ## Apply en-US TMDB metadata to all library_media (run dry-run first)
	cd apps/api && bun --env-file=../../.env src/scripts/refreshLibraryTitlesFromTmdb.ts --apply

db-refresh-collation: ## Refresh PostgreSQL collation version for template1 and app DB (use DB_NAME/DB_USER overrides)
	@DB_NAME=$${DB_NAME:-rawkoon}; \
	DB_USER=$${DB_USER:-rawkoon}; \
	echo "Refreshing template1 collation version..."; \
	docker compose -p rawkoon-dev -f docker-compose.yml exec -T db psql -U $$DB_USER -d postgres -c "ALTER DATABASE template1 REFRESH COLLATION VERSION;"; \
	echo "Refreshing database collation version for database: $$DB_NAME..."; \
	docker compose -p rawkoon-dev -f docker-compose.yml exec -T db psql -U $$DB_USER -d postgres -c "ALTER DATABASE $$DB_NAME REFRESH COLLATION VERSION;"
	@echo "✓ Collation versions refreshed successfully"
