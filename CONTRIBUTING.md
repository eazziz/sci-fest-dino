# Contributing

Thanks for helping make Lane Runner easier to play, teach with, and adapt.

## Local setup

Use Node.js 22 or newer. Fork the repository, clone your fork, and create a branch for your change. If you use nvm, run `nvm use` in the repository.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. See the [README](README.md) for camera setup.

## Before opening a pull request

```sh
npm test
npm run typecheck
npm run build
```

Describe the problem, the resulting behavior, and how you checked it. Add a regression test when changing game rules or pose-control behavior. For camera or layout changes, also try the affected flow in a browser and state which hardware you used. A keyboard check does not verify body controls.

Keep generated `dist/` output and `node_modules/` out of commits. Keep `package-lock.json` updated when changing dependencies. Preserve third-party license notices, and document new assets and their sources in `THIRD_PARTY_NOTICES.md`.

## Reporting a problem

[Open an issue](https://github.com/eazziz/sci-fest-dino/issues/new/choose) with:

- Which input mode you used (camera or keyboard).
- Your browser, operating system, webcam, and display orientation.
- Steps to reproduce, what you expected, and what happened.
- Any browser-console errors. For tracking issues, include the Debug panel's failing check if available.

Do not include private camera footage or images of visitors without their permission. A text description of diagnostics is often enough.

By submitting a contribution, you agree to license your contribution under the project's Apache License 2.0.
