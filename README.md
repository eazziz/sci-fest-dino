# Science Fest Games

Body-controlled Dino Jump and Lane Runner for a portrait TV: game above, mirrored camera below.

## Run

```sh
npm ci
npm run dev
```

Open the local URL Vite prints for Dino Jump. For Lane Runner, add `?game=runner`
(e.g. `http://localhost:3000/?game=runner`). Click **Enable Camera** once at booth setup to
grant camera access and unlock sound. Visitors do not need to touch the computer.
Use **Full Screen** for the TV.

For a production build, run `npm run build`, then `npm run preview`. The repository
includes the local model, WASM, and font assets under `public/`. Keep these assets
alongside the app when deploying. A non-localhost deployment needs HTTPS for camera
access.
