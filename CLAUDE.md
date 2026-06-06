# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vivid To-Do is a single-file PWA (Progressive Web App) with zero dependencies — no build step, no npm, no framework. The entire application lives in `vivid-todo.html`, with `manifest.json` for PWA installation support.

To run: open `vivid-todo.html` directly in a browser.

## Architecture

Everything is self-contained in `vivid-todo.html`:
- **CSS** (~370 lines): Design tokens via CSS custom properties on `:root`, then component styles. All colors, timing, and shadows are centralized there.
- **JavaScript** (~150 lines): Three sections — date/time display, core task management, event listeners.

### State

In-memory array `tasks` (array of objects) persisted to `localStorage` under key `'vivid-todo-tasks'` as `{ tasks, nextId }`.

Task object shape:
```js
{ id: number, text: string, important: boolean, completed: boolean, createdAt: number }
```

Initialization flow: `DOMContentLoaded → loadTasks() → renderTasks() → attach event listeners`

### Key DOM IDs

`#taskInput`, `#importantCheck`, `#addBtn`, `#tasksContainer`, `#taskCount`, `#dayName`, `#dateStr`

## Conventions

- Task IDs use `Date.now()` (not the `nextId` counter, which is stored but unused in adds).
- `escapeHtml()` is used to sanitize task text before rendering to prevent XSS.
- localStorage access is wrapped in try/catch for graceful degradation.
- Animations use staggered delays via nth-child CSS logic and `vanish`/`appear` keyframes toggled by class.
- Tasks render in insertion order; no sorting or filtering UI exists.
