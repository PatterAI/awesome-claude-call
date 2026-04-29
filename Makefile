.PHONY: install-dev test test-unit test-integration lint server-install server-build server-test server-typecheck ci clean

install-dev:
	@command -v bats >/dev/null 2>&1 || { echo "bats not found — brew install bats-core"; exit 1; }
	@command -v jq >/dev/null 2>&1 || { echo "jq not found — brew install jq"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "node not found"; exit 1; }
	@command -v shellcheck >/dev/null 2>&1 || echo "(optional) shellcheck not found"

server-install:
	cd server && npm ci

server-build:
	cd server && npm run build

server-typecheck:
	cd server && npm run typecheck

server-test:
	cd server && npm test

test: test-unit test-integration

test-unit:
	@bats tests/unit

test-integration:
	@bats tests/integration

lint:
	@find scripts -name '*.sh' -print0 | xargs -0 -I{} sh -c 'shellcheck {} || true'

ci: install-dev server-install server-build server-typecheck server-test test
	@echo "All CI checks passed."

clean:
	rm -rf server/dist server/node_modules server/.test-build server/coverage tests/.tmp
