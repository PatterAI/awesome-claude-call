.PHONY: test test-unit test-integration lint clean install-dev

test: test-unit test-integration

test-unit:
	@bats tests/unit

test-integration:
	@bats tests/integration

lint:
	@find scripts -name '*.sh' -print0 | xargs -0 -I{} sh -c 'shellcheck {} || true'

clean:
	@rm -rf tests/.tmp

install-dev:
	@command -v bats >/dev/null || (echo "Install bats-core: brew install bats-core" && exit 1)
	@command -v jq >/dev/null || (echo "Install jq: brew install jq" && exit 1)
	@echo "Dev tools OK"
