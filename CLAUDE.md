# Clawfield — Project Instructions

## Git Worktree Workflow (MANDATORY)

**Multiple Claude instances run in parallel on this repo. To prevent conflicts, EVERY new feature or bugfix MUST use a git worktree.**

### When to create a worktree

Create a worktree whenever:
- The user says to implement a new feature, fix a bug, or make any code changes
- You are starting work that will result in a branch and/or PR
- The user says "work on X" or "implement Y" or similar

Do NOT create a worktree for:
- Read-only tasks (research, code review, answering questions)
- Editing CLAUDE.md, docs, or task files on main

### How to create a worktree

```bash
# 1. Generate a short kebab-case branch name from the task
BRANCH="claude/<short-description>-$(openssl rand -hex 2)"

# 2. Create the worktree in ../.worktrees/clawfield/<branch-name>
#    This keeps worktrees outside the main repo directory
WORKTREE_DIR="../.worktrees/clawfield/$BRANCH"
git worktree add -b "$BRANCH" "$WORKTREE_DIR" main

# 3. cd into the worktree for ALL subsequent work
cd "$WORKTREE_DIR"
```

### Rules

1. **Never commit feature work directly to main.** Main is the integration branch.
2. **All file edits happen inside the worktree directory.** After `cd`-ing into the worktree, use absolute paths based on the worktree root, not the original repo root.
3. **Install dependencies in the worktree** if needed (`npm install` / package manager).
4. **Push and create PRs from the worktree:**
   ```bash
   git push -u origin "$BRANCH"
   gh pr create --title "..." --body "..."
   ```
5. **Clean up after merge:** Once a PR is merged, remove the worktree:
   ```bash
   # From the main repo directory
   git worktree remove "../.worktrees/clawfield/$BRANCH"
   git branch -d "$BRANCH"
   ```
6. **If the worktree already exists** (e.g. resuming work), just `cd` into it instead of creating a new one. Check with `git worktree list`.

### Worktree directory structure

```
Documents/
  clawfield/                    # Main repo (main branch) — don't touch for features
  .worktrees/clawfield/         # All worktrees live here
    claude/add-weapon-system-a1b2/
    claude/fix-minimap-bug-c3d4/
    ...
```

## Project Overview

Browser-based voxel battlefield game (24v24), Ravenfield-inspired, with AI Game Master.

- **Tech:** Three.js, TypeScript, Node.js server, WebSocket networking
- **Monorepo:** apps/client, apps/server, packages/shared
- **Build:** Vite (client), tsx (server + tools)

## Key Paths

- PRD: `docs/PRD.md`
- Tasks: `tasks/todo.md`
- Lessons: `tasks/lessons.md`
- Assets: `assets/` (vox models, maps, components)
- Tools: `tools/` (map-compose, vox-parse, registry-build, vox-extract)

## Code Conventions

- TypeScript strict mode
- Shared constants/types in `packages/shared/`
- Client entry: `apps/client/src/main.ts`, Editor: `apps/client/src/editor/editor-main.ts`
- Server entry: `apps/server/src/index.ts`

## Testing & Verification

- Type-check: `apps/client/node_modules/.bin/tsc --noEmit --project apps/client/tsconfig.json`
- Dev server: `npm run dev` (from apps/client)
- Map compile: `npx tsx tools/map-compose.ts assets/maps/<name>.mapdef.json`
