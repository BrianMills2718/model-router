# Releasing

Versions follow [SemVer](https://semver.org). The version lives in `.claude-plugin/plugin.json`; the tag (`vX.Y.Z`) and release must match it.

## Which number

| Change | Before 1.0 | From 1.0 |
| --- | --- | --- |
| Removes or renames an agent, setting or command; changes a default | MINOR | MAJOR |
| Adds an agent, setting, command or routing rule | MINOR | MINOR |
| Fix, price or model id update, wording, docs | PATCH | PATCH |

A model id update that moves a tier to another model family is MINOR. Pre-releases: `0.8.0-rc.1`.

## Steps

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` and bump `plugin.json`.
2. Run `claude plugin validate .` and `claude plugin test .`.
3. Merge the PR, then tag the merge commit:
   ```
   git checkout main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
   ```
4. Publish a GitHub release from the tag, using the changelog section as notes.

Never move a pushed tag; ship a patch instead.
