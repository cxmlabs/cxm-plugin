# Release helpers. package.json holds the version. A release runs in CI: prepare-release.yml
# bumps it on a branch and opens the PR (main is protected); merging it runs tag-release.yml,
# which tags the version and starts release.yml.
.PHONY: help test validate patch minor major version

help:
	@echo "make patch|minor|major   start prepare-release in CI: it opens the version-bump PR"
	@echo "make validate            validate the plugin + marketplace manifests"
	@echo "make test                run the test suite"
	@echo "make version             show the current version"

version:
	@node -p "require('./package.json').version"

test:
	node --test

# validate-manifests.mjs is the gate, and it checks both harnesses' manifests with no
# agent installed. `claude plugin validate` is an extra opinion when that CLI happens to
# be there; Codex ships no equivalent, so nothing here may depend on either.
validate:
	npm run --silent validate:plugin
	@command -v claude >/dev/null 2>&1 && claude plugin validate . --strict || echo "claude CLI absent - the manifests were still validated above"

patch minor major:
	gh workflow run prepare-release.yml -f level=$@
	@echo "prepare-release started: review and merge its PR to publish."
