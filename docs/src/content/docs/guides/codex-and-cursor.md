---

title: Codex, Cursor and other agents
description: Give any coding agent the rules, and a command to check its work.
---

## Codex and AGENTS.md agents

Paste the section from [`integrations/codex/AGENTS.md`](https://github.com/aryan-tah/pgdeadbolt/blob/main/integrations/codex/AGENTS.md) into your repository's `AGENTS.md`. It gives the agent the safe patterns and tells it to run `npx pgdeadbolt check` on every migration it writes.

## Agent Skills

[`skills/pgdeadbolt`](https://github.com/aryan-tah/pgdeadbolt/tree/main/skills/pgdeadbolt) is a standard `SKILL.md` folder. Copy it into any agent that loads Agent Skills.

## Cursor

Copy [`integrations/cursor/pgdeadbolt.mdc`](https://github.com/aryan-tah/pgdeadbolt/blob/main/integrations/cursor/pgdeadbolt.mdc) to `.cursor/rules/` in your project. It applies automatically to files in common migration folders.

## Any agent

The checker is a plain CLI with exit codes, so any agent that can run a command can verify its own migration:

```bash
npx pgdeadbolt check path/to/migration.sql --format json
```
