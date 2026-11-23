#!/bin/sh
set -eu

# The release action copies the checkout, including .git, before creating its PR.
git config --local user.name 'github-actions[bot]'
git config --local user.email '41898282+github-actions[bot]@users.noreply.github.com'
git config --local core.hooksPath .git/release-hooks
mkdir -p .git/info .git/release-hooks

# Format when git stages the generated Markdown so retries also see the canonical blob.
printf '\n%s\n' '/CHANGELOG.md filter=release-changelog' >> .git/info/attributes
git config --local filter.release-changelog.clean \
  'node "$GITHUB_WORKSPACE/node_modules/prettier/bin/prettier.cjs" --stdin-filepath "$GITHUB_WORKSPACE/CHANGELOG.md" --ignore-path "$GITHUB_WORKSPACE/.prettierignore"'
git config --local filter.release-changelog.smudge cat
git config --local filter.release-changelog.required true

cat > .git/release-hooks/commit-msg <<'HOOK'
#!/bin/sh
set -eu
git interpret-trailers --in-place --if-exists addIfDifferent \
  --trailer "Signed-off-by: $(git config user.name) <$(git config user.email)>" "$1"
HOOK

chmod +x .git/release-hooks/commit-msg
