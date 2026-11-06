SHELL := /bin/bash
.DEFAULT_GOAL := help
BUN ?= bun

.PHONY: help install dev dev-api dev-web build start seed test test-ui typecheck clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install workspace dependencies
	$(BUN) install

dev: ## Run API (:8787) and web dev server (:5173) together
	$(BUN) run dev:api & $(BUN) run dev:web; wait

dev-api: ## Run the API with hot reload
	$(BUN) run dev:api

dev-web: ## Run the Vite dev server
	$(BUN) run dev:web

build: ## Build the web client into web/dist
	$(BUN) run build

start: build ## Build the web client and serve API + UI from one process
	$(BUN) run --cwd server start

seed: ## Seed a demo admin, folders and sample images
	$(BUN) run seed

test: ## Run the end-to-end API test suite (server must be running)
	$(BUN) run --cwd server test

test-ui: ## Run the browser smoke suite (server must be running)
	PLAYWRIGHT_BROWSERS_PATH=$$PWD/.pw-browsers $(BUN) run --cwd server test:ui

typecheck: ## Type-check API and web workspaces
	$(BUN) run typecheck

clean: ## Remove build output, caches and runtime data
	rm -rf web/dist data .bun-cache .ui-shots
