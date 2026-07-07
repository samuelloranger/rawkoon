# Rawkoon Web App

React TypeScript frontend for Rawkoon — a self-hosted command center for homelab enthusiasts.

## Tech Stack

- **React 19** - UI library
- **TypeScript** - Type safety
- **TanStack Router** - Client-side routing
- **TanStack Query** - Server state management
- **Tailwind CSS 4** - Styling
- **Vitest** - Testing framework
- **Vite** - Build tool

## Development

```bash
# Install dependencies (from root)
bun install

# Run dev server
bun run dev

# Run tests
bun run test

# Build for production
bun run build
```

The dev server runs on `http://localhost:5173` and proxies API requests to the Elysia backend at `http://localhost:3000`.

## Project Structure

```
apps/web/
├── src/
│   ├── features/      # Feature-based modules (dashboard, medias, etc.)
│   ├── components/    # Reusable React components
│   ├── routes/        # Route components (pages)
│   ├── lib/           # API client and utilities
│   ├── hooks/         # Custom React hooks
│   ├── locales/       # i18n translations (en, fr)
│   └── sw/            # Service Worker for PWA support
├── public/            # Static assets
└── dist/              # Production build output
```

## Testing

All components have corresponding test files in `__tests__` directories. Run tests with:

```bash
bun run test
```

## Production Build

The build output goes to `apps/web/dist/` which is served by the production Docker container.
