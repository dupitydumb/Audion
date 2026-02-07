# Developer Guide: GitHub Management

This guide establishes standards for contributing to the Audion project via GitHub. Following these conventions ensures consistency and clarity in our version control history.

---

## Table of Contents

1. [Commit Message Standards](#commit-message-standards)
2. [Branch Naming Conventions](#branch-naming-conventions)
3. [Pull Request Guidelines](#pull-request-guidelines)

---

## Commit Message Standards

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for all commit messages.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Components

- **Type** (required): The kind of change being made
- **Scope** (optional): The area of the codebase affected
- **Subject** (required): A short description of the change
- **Body** (optional): Detailed explanation of the change
- **Footer** (optional): Breaking changes, issue references

### Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(lyrics): add LRC parsing support` |
| `fix` | Bug fix | `fix(player): resolve shuffle queue duplication` |
| `docs` | Documentation changes | `docs(readme): update installation instructions` |
| `style` | Code style changes (formatting, whitespace) | `style(ui): improve button spacing` |
| `refactor` | Code refactoring (no functional changes) | `refactor(store): extract player state logic` |
| `perf` | Performance improvements | `perf(library): implement pagination for large libraries` |
| `test` | Adding or updating tests | `test(lyrics): add unit tests for getCurrentLyric` |
| `build` | Build system or dependency changes | `build(deps): update tauri to v2.1.0` |
| `ci` | CI/CD configuration changes | `ci(workflow): add beta deployment pipeline` |
| `chore` | Maintenance tasks | `chore(cleanup): remove unused imports` |
| `revert` | Revert a previous commit | `revert: revert "feat(lyrics): add LRC parsing"` |

### Common Scopes

- `player` - Audio player functionality
- `lyrics` - Lyrics-related features
- `ui` - User interface components
- `plugin` - Plugin system
- `library` - Music library management
- `playlist` - Playlist functionality
- `theme` - Theme and styling
- `api` - API endpoints and commands
- `store` - State management

### Rules

1. **Use imperative mood** in the subject line (e.g., "add" not "added" or "adds")
2. **Do not end the subject line with a period**
3. **Keep the subject line under 72 characters**
4. **Separate subject from body with a blank line**
5. **Use the body to explain what and why, not how**

---

## Branch Naming Conventions

### Format

```
<type>/<scope>-<short-description>
```

### Examples

- `feat/lyrics-api-endpoints`
- `fix/shuffle-queue-logic`
- `refactor/plugin-architecture`

### Rules

1. **Use lowercase with hyphens** for readability
2. **Keep branch names concise** but descriptive
3. **Delete branches** after merging to keep the repository clean

---

## Pull Request Guidelines

### Title Format

Follow the same format as commit messages:

```
<type>(<scope>): <description>
```

**Example:** `feat(lyrics): implement LRC parsing and getCurrentLyric API`

### Description Template

```markdown
## Description
Brief summary of the changes and their purpose.

## Changes Made
- List of specific changes

## Related Issues
Closes #123

## Testing
- [ ] Manual testing performed
- [ ] Automated tests added/updated

## Screenshots (if applicable)
Add before/after screenshots for UI changes
```

### PR Checklist

Before submitting a pull request, ensure:

- [ ] All tests pass
- [ ] Commit messages follow the conventional commits format
- [ ] No unnecessary files are included
- [ ] Breaking changes are clearly documented
