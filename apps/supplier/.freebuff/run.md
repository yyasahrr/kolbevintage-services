# Local preview

## Reproduce uncommitted artifacts

1. Install dependencies with `npm install`.
2. No environment files or other uncommitted runtime artifacts are required for this Vite frontend.

## Run the server

1. Check whether Vite's default port `5173` is free. If it is in use, select an unused port.
2. Run `npm run dev -- --host 127.0.0.1 --port <port>` from the project root.
3. For Freebuff Preview on Windows, start it detached with `Start-Process` using `npm.cmd`, redirect stdout and stderr to separate files, then register `http://127.0.0.1:<port>`.
