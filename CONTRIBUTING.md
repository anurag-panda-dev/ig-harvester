# Contributing to ig-harvester

Thank you for your interest in contributing! This document explains how to get started.

## Code of Conduct

- Be respectful and inclusive
- No harassment or discrimination
- Focus on constructive feedback
- Follow ethical OSINT practices

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists
2. Open a new issue with:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (Node version, Chrome version, OS)
   - Log output (with `--log-level debug`)

### Suggesting Features

1. Open an issue with the `enhancement` label
2. Describe the use case
3. Explain why it fits the project

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

## Development Setup

```bash
git clone https://github.com/anurag-panda-dev/ig-harvester.git
cd ig-harvester
npm install
npm test
```

## Project Structure

```
src/
  extractors/     — data extraction (JSON, DOM, parsers)
  scraper/        — scraping logic (profile, posts, users)
  storage/        — caching and output
  utils/          — logging, retry, rate limiting
  cli.mjs         — main orchestration
  config.mjs      — config loading
  browser.mjs     — browser management
```

## Coding Style

- **Language:** JavaScript (ESM, `"type": "module"`)
- **Node:** >= 20
- **Style:** 2-space indent, semicolons, single quotes
- **Naming:** camelCase for functions/variables, PascalCase for classes
- **Comments:** JSDoc for exported functions
- **Error handling:** Always catch and log, never swallow silently

## Testing

```bash
npm test
```

Add tests for any new parser functions in `tests/`.

## Commit Messages

```
feat: add carousel media extraction
fix: handle escaped slashes in URLs
docs: update README with new flags
test: add parser unit tests
refactor: simplify comment thread extraction
```

## Questions?

Open a [GitHub Discussion](https://github.com/anurag-panda-dev/ig-harvester/discussions) or reach out to [@anurag-panda-dev](https://github.com/anurag-panda-dev).

---

**Author:** [Anurag Panda](https://github.com/anurag-panda-dev)
