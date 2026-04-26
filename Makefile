.PHONY: help up down build logs shell-api shell-frontend migrate init-dirs push push-prod

help:
	@echo "WhatsForTea — common commands"
	@echo ""
	@echo "  make init-dirs      Create local data directories (run once)"
	@echo "  make up             Start all services (local dev)"
	@echo "  make down           Stop all services"
	@echo "  make build          Rebuild images"
	@echo "  make logs           Tail all service logs"
	@echo "  make shell-api      Bash shell in the api container"
	@echo "  make shell-frontend Bash shell in the frontend container"
	@echo "  make migrate        Run pending Alembic migrations"
	@echo "  make push           Build + push development images (linux/amd64)"
	@echo "  make push-prod      Build + push production images (linux/amd64)"
	@echo "  make test-mock      Run backend tests against AIMock fixtures"
	@echo "  make record-fixtures Start AIMock in record mode to refresh fixtures"

init-dirs:
	mkdir -p data/db data/redis data/recipes data/backups

up:
	docker-compose up

down:
	docker-compose down

build:
	docker-compose build

logs:
	docker-compose logs -f

shell-api:
	docker-compose exec api bash

shell-frontend:
	docker-compose exec frontend sh

migrate:
	docker-compose exec api poetry run alembic upgrade head

push:
	./scripts/push-images.sh

push-prod:
	./scripts/push-images.sh --prod

test-mock:
	docker-compose exec api poetry run pytest backend/tests

record-fixtures:
	docker-compose exec aimock node frontend/node_modules/@copilotkit/aimock/dist/aimock-cli.js --record --config aimock.json --host 0.0.0.0 --port 5001
