# Contributing to O2 CMS

Thank you for your interest in contributing to O2 CMS! This document provides guidelines and information to help you get started.

## Development Setup

### Prerequisites

- Node.js v20+
- npm
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project (free Spark plan works for development)

### Getting Started

1. Fork the repository and clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/o2-cms.git
cd o2-cms
```

2. Install dependencies:

```bash
npm install
cd functions && npm install && cd ..
```

3. Set up environment variables:

```bash
cp .env.example .env.local
```

Fill in your Firebase project credentials in `.env.local`.

4. Start the development server:

```bash
npm run dev
```

## Code Style

### General

- **TypeScript** is used throughout the project. Avoid `any` types where possible.
- **ESLint** is configured for the project. Run `npm run lint` to check for issues.

### Frontend

- Use **Tailwind CSS** for styling. Avoid inline styles.
- Use CSS variables from `app/globals.css` for colors:
  - `var(--text-primary)` for main text (#1a1a1a)
  - `var(--text-secondary)` for secondary text (#4a4a4a)
  - `var(--text-tertiary)` for muted text (#858481)
  - `var(--background-gray-main)` for page backgrounds (#f8f8f7)
  - `var(--border-main)` for borders
- Keep the design **minimal and monochromatic** (black/white/gray). Do not use blue, purple, or gradient colors for primary UI elements.
- Use the custom `Dropdown` component from `@/components/Dropdown` instead of native `<select>` elements.
- Use `rounded-[6px]` for buttons and `rounded-[12px]` for cards.

### Components

- Place reusable components in `components/`.
- Page-specific components can live in the relevant `app/` directory.
- Use the `O2Loader` component for full-page loading states and `Loader2` from `lucide-react` with `animate-spin` for inline loading.

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-webhook-retries`
- `fix/asset-upload-timeout`
- `docs/update-api-examples`

### Commit Messages

Write clear, concise commit messages:

- Use the imperative mood ("Add feature" not "Added feature")
- Keep the first line under 72 characters
- Reference issues when applicable (e.g., "Fix #42: handle empty content types")

### Pull Request Process

1. Create a branch from `main` for your changes.
2. Make your changes, ensuring they follow the code style guidelines above.
3. Test your changes locally.
4. Push your branch and open a pull request against `main`.
5. Fill in the PR description with:
   - What the change does
   - Why it's needed
   - How to test it
6. Wait for review. Address any feedback promptly.

## Reporting Issues

When reporting a bug, please include:

- A clear description of the problem
- Steps to reproduce
- Expected behavior vs actual behavior
- Browser/OS information if relevant
- Screenshots or error logs if applicable

For feature requests, describe:

- The use case or problem you're trying to solve
- Your proposed solution (if any)
- Any alternatives you've considered

## Project Architecture

- **`app/`** -- Next.js App Router pages and layouts
- **`components/`** -- Shared React components
- **`lib/`** -- Utilities, Firebase client, Firestore helpers, API functions
- **`functions/`** -- Firebase Cloud Functions (Express REST API, Apollo GraphQL, Firestore triggers)
- **`types/`** -- Shared TypeScript type definitions
- **`contexts/`** -- React context providers (Auth, Tenant)
- **`hooks/`** -- Custom React hooks

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
