# CamWallet — Commandes de développement local
# Usage : make <cible>   (ex: make install, make dev)

BACKEND := backend
COMPOSE := docker compose

# Couleurs
CYAN  := \033[36m
GREEN := \033[32m
RESET := \033[0m

.DEFAULT_GOAL := help
.PHONY: help install db dev migrate seed reset studio down logs clean

help: ## Affiche cette aide
	@echo ""
	@echo "$(CYAN)CamWallet — commandes disponibles :$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-12s$(RESET) %s\n", $$1, $$2}'
	@echo ""

install: ## Installe les dépendances backend + génère le client Prisma
	@command -v docker >/dev/null 2>&1 || { echo "❌ Docker requis : https://docs.docker.com/get-docker/"; exit 1; }
	@cd $(BACKEND) && [ -f .env ] || cp .env.example .env
	@echo "$(CYAN)📦 Installation des dépendances backend...$(RESET)"
	cd $(BACKEND) && npm install
	@echo "$(CYAN)⚙️  Génération du client Prisma...$(RESET)"
	cd $(BACKEND) && npx prisma generate
	@echo "$(GREEN)✅ Installation terminée. Lancez : make dev$(RESET)"

db: ## Démarre PostgreSQL + pgAdmin (Docker) et attend que la base soit prête
	@echo "$(CYAN)🐘 Démarrage de PostgreSQL + pgAdmin...$(RESET)"
	$(COMPOSE) up -d
	@echo "$(CYAN)⏳ Attente de la disponibilité de PostgreSQL...$(RESET)"
	@until $(COMPOSE) exec -T postgres pg_isready -U camwallet -d camwallet_dev >/dev/null 2>&1; do \
		printf "."; sleep 1; \
	done; echo ""
	@echo "$(GREEN)✅ PostgreSQL prêt sur localhost:5433 — pgAdmin sur http://localhost:5050$(RESET)"

migrate: ## Applique les migrations Prisma (crée la migration initiale si besoin)
	cd $(BACKEND) && npx prisma migrate dev --name init

dev: db migrate ## Lance la base, applique les migrations, puis démarre l'API en watch
	@echo "$(CYAN)🚀 Démarrage de l'API CamWallet (http://localhost:3000 — Swagger /api/docs)$(RESET)"
	cd $(BACKEND) && npm run start:dev

seed: ## Insère les données de test (utilisateurs, marchand, admin)
	cd $(BACKEND) && npm run prisma:seed

reset: ## Réinitialise complètement la base (drop + migrations + seed)
	@echo "$(CYAN)♻️  Réinitialisation de la base de données...$(RESET)"
	cd $(BACKEND) && npx prisma migrate reset --force
	@echo "$(GREEN)✅ Base réinitialisée et re-seedée$(RESET)"

studio: ## Ouvre Prisma Studio (explorateur de données)
	cd $(BACKEND) && npx prisma studio

down: ## Arrête les conteneurs Docker (conserve les données)
	$(COMPOSE) down

logs: ## Affiche les logs des conteneurs Docker
	$(COMPOSE) logs -f

clean: ## Arrête et SUPPRIME les volumes Docker (efface toutes les données)
	$(COMPOSE) down -v
	@echo "$(GREEN)✅ Conteneurs et volumes supprimés$(RESET)"
