# Third-party notices

The project's Apache License 2.0 does not replace the licenses of bundled dependencies or assets. Preserve their applicable notices when redistributing them.

## MediaPipe

- Package: `@mediapipe/tasks-vision` (locked to version 0.10.8).
- Bundled runtime: `public/wasm/vision_wasm*`.
- Bundled model: `public/models/pose_landmarker_lite.task`.
- Upstream: https://github.com/google-ai-edge/mediapipe
- Pose Landmarker documentation and model download: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- Model license reference: [BlazePose GHUM model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), page 2.
- License: Apache License 2.0; upstream license text is included in `public/wasm/LICENSE` and `public/models/LICENSE`.

MediaPipe is developed by Google and its contributors. The model and runtime are distributed here to allow local inference without CDN requests.

## Press Start 2P

- Asset: `public/fonts/press-start-2p.ttf`.
- Upstream: https://github.com/google/fonts/tree/main/ofl/pressstart2p
- Copyright 2012 The Press Start 2P Project Authors (cody@zone38.net), with Reserved Font Name "Press Start 2P".
- License: SIL Open Font License 1.1, included in `public/fonts/OFL.txt`.

## JavaScript dependencies

React and React DOM use the MIT license. Three.js uses the MIT license. MediaPipe Tasks Vision uses Apache License 2.0. Other build dependencies retain their respective licenses. Dependency versions and upstream package sources are recorded in `package-lock.json`; installed packages provide their applicable notices. Copies of the React, React DOM, and Three.js licenses are included in `public/licenses/` and copied into production builds. Production JavaScript also retains the legal comments emitted by the build tools.
