# Contributing to RecruitAI

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/candidate-export` |
| Bug fix | `fix/<short-description>` | `fix/auth-token-expiry` |
| Docs | `docs/<short-description>` | `docs/api-reference` |
| Chore | `chore/<short-description>` | `chore/update-dependencies` |

Always branch from `master`, not `main`.

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add candidate export to CSV
fix: resolve JWT refresh on session restore
chore: update express to v4.19
docs: add setup instructions to README
```

## Pull Requests

- Open PRs against `master`
- Title must follow the same `type: description` format as commits
- Description must explain what was built and how to verify it
- No AI tool names in commit messages or PR descriptions

## Local Setup

```bash
# Backend
cd backend && npm install && cp .env.example .env
# Fill in .env with your keys, then:
npm run dev

# Frontend
cd frontend && npm install && cp .env.example .env
npm run dev
```

## Code Style

- Backend: ES Modules (`import`/`export`), async/await throughout
- Frontend: React functional components, Zustand for state, Tailwind for styling
- No inline styles, no class components (except ErrorBoundary)
