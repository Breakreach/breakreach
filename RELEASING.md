# Releasing the kit

The source lives in the Breakreach monorepo under `devkit/`. The public repo, npm and PyPI get copies of it. Run everything from the monorepo root unless a step says otherwise.

Names used below (change them everywhere with one search and replace if you pick others):

| | Name |
| --- | --- |
| npm package (SDK + `breakreach` command) | `breakreach` |
| PyPI package | `breakreach` |
| Public GitHub repo (SDKs, skill, Claude Code plugin) | `breakreach/breakreach` |

## 0. Before each release

```bash
cd devkit && npx tsx scripts/generate.mts --check && cd ..   # generated code matches the API spec
cd devkit/typescript && npm install && npm run typecheck && npm run build && cd ../..
devkit/scripts/e2e.sh                                        # local Mongo + Redis; --r2 also uploads a 1×1 PNG to R2
```

Bump the version in `devkit/typescript/package.json` and `src/core.ts` (VERSION), and in `devkit/python/pyproject.toml` and `src/breakreach/_client.py` (`__version__`), when it isn't the first release.

## 1. The public GitHub repo

First time: create the GitHub organization `breakreach` (github.com → your avatar → Your organizations → New organization, Free plan, name `breakreach`), then the repo:

```bash
gh repo create breakreach/breakreach --public --description "Breakreach SDKs (TypeScript, Python), CLI and agent skill: schedule social media posts on 15 networks"
```

Every release (copies `devkit/` with its history to the repo's main branch):

```bash
git subtree split --prefix=devkit -b devkit-public
git push https://github.com/breakreach/breakreach.git devkit-public:main
git branch -D devkit-public
```

Once it's public, these work: `npx skills add breakreach/breakreach`, `claude plugin marketplace add breakreach/breakreach`.

## 2. npm

Needs an npm account with 2FA (`npm login` once).

```bash
cd devkit/typescript
npm install
npm publish --dry-run      # check the file list: dist/, README.md, LICENSE, package.json
npm publish --access public
```

Check: `npx breakreach@latest --version`.

## 3. PyPI

Needs a PyPI account and an API token (pypi.org → Account settings → API tokens; scope it to the project after the first upload).

```bash
cd devkit/python
rm -rf dist && uv build
uvx twine check dist/*
UV_PUBLISH_TOKEN=pypi-... uv publish
```

Check: `uv run --no-project --with breakreach python -c "import breakreach; print(breakreach.__version__)"`.

## 4. The site

Once the three are live, turn on the matching flags in `apps/web/src/lib/devkit.ts` (SDK and CLI sections on /developers and the agent pages, the skill download and install commands), copy the skill to the site, and push:

```bash
cp devkit/skills/breakreach/SKILL.md apps/web/public/skills/breakreach/SKILL.md
cp devkit/skills/breakreach/references/rest-and-cli.md apps/web/public/skills/breakreach/references/rest-and-cli.md
```
