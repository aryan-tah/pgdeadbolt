# Contributing to pgdeadbolt

Thanks for helping. pgdeadbolt is small on purpose, and every rule in it has to earn its place with a measurement, so the most useful contributions are often reports, not code.

## Ways to help

- **Report a false positive or a missed lock.** Use the issue forms. Include the migration, your Postgres version and, if you can, the table size. Lock behaviour changes between versions, so the version matters.
- **Propose a rule.** Open a "New rule" issue with the statement, the lock it takes, and how you measured it.
- **Improve an agent integration.** If Claude Code, Codex, Cursor or another agent still slips a dangerous migration past pgdeadbolt, that's a bug. Tell us what it wrote.
- **Fix something.** Issues labelled `good first issue` are scoped for a first PR.

## Development

You need Node 20 or newer. Docker is only needed for rehearsal tests.

```bash
git clone https://github.com/aryan-tah/pgdeadbolt
cd pgdeadbolt
npm install
npm run check      # lint, typecheck and tests
npm run build
```

## Pull requests

- Keep each PR to one change. Small PRs get reviewed fast.
- Add or update tests. A new rule needs a test that it fires and a test that its safe rewrite doesn't.
- Run `npm run check` before pushing; CI runs the same thing.
- Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) style (`feat:`, `fix:`, `docs:`). The changelog is generated from them.

## Adding a rule

Every rule documents three things: which lock the statement takes, why that's a problem, and the safe way to do the same change. If the cost depends on table size or Postgres version, say so in the rule and its docs. Claims about lock behaviour should be backed by a rehearsal or a link to the Postgres docs.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By taking part you agree to it.
