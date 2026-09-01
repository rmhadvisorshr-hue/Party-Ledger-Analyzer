# Party Ledger Analyzer

Full-stack bank statement / party-ledger analysis app: React UI and API run together on one dev server.

## Project Structure

-   `frontend/`: React UI, TanStack Start SSR, and integrated API (`frontend/server/` — PDF/OCR parsing, analysis, Excel export).

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later recommended)
-   [npm](https://www.npmjs.com/) (comes with Node.js)
-   Chrome or Edge (for master PDF export)

## Getting Started

### 1. Install Dependencies

From the repository root:

```bash
npm install
```

### 2. Running the Application

One command starts the UI and API on the same port:

```bash
npm run dev
```

Open `http://localhost:5173/upload` (Vite may use the next free port, e.g. `5174`, if `5173` is busy). API routes are same-origin: `/api/*` and `/health`.

Production build and preview:

```bash
npm run build
npm run start
```

### 3. Running Frontend and Backend Separately

The API (`frontend/server/`) can also run as its own process, independent of Vite — useful for deploying the backend on its own or testing it in isolation.

Backend, on its own port:

```bash
cd frontend
npm run server          # http://localhost:3001, hot-reloads on change
```

Frontend, pointed at that backend instead of the integrated same-origin API:

```bash
cd frontend
VITE_API_BASE_URL=http://localhost:3001 npm run dev
```

Set `FRONTEND_ORIGIN` on the backend if the frontend runs on a non-default port, so CORS allows it (`http://localhost:5173`/`5174` are allowed by default).

### PowerShell Execution Policy

If you are using PowerShell and encounter an error message like "running scripts is disabled on this system," you'll need to set the execution policy for the current process. Run this command in your PowerShell terminal before running `npm run dev`:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
```

## Available Scripts

### Frontend (`frontend/`)

-   `npm run dev`: Starts the Vite development server (also serves the integrated `/api/*` routes).
-   `npm run build`: Builds the application for production.
-   `npm run preview`: Serves the production build locally.
-   `npm run server`: Starts the API standalone (`server/standalone.ts`), independent of Vite.
-   `npm run server:start`: Same, without watch mode.
-   `npm run lint`: Lints the codebase using ESLint.
-   `npm run format`: Formats the code using Prettier.

# Party-Ledger-Analyzer
