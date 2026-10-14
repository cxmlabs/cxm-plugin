# Release helpers. package.json holds the version; `npm version` bumps it, runs
# scripts/sync-version.mjs through its "version" lifecycle hook to update the Claude
# and Codex manifests, then commits and tags. CI publishes on the pushed tag.
.PHONY: help test validate patch minor major release version

help:
	@echo "make patch|minor|major   bump the version, sync manifests, commit, tag"
	@echo "make release             push the commit and tag (CI publishes)"
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

# npm version refuses to run on a dirty tree, which is the guard we want.
patch minor major: validate test
	npm version $@ -m "release: cxm-agent-plugin v%s"
	@echo "Tagged. Run: make release"

release:
	git push --follow-tags
