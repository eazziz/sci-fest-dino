# Dino Jump — local setup

A body-controlled Chrome Dino-style game built with React, Vite, and MediaPipe Pose Landmarker. The pose model, WebAssembly runtime, and pixel font are included locally, so the game does not need a Gemini API key or an internet connection after setup.

## Run Locally

**Prerequisite:** Node.js 18 or newer.


1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the local server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000) in Chrome.
4. Click **Enable Camera** and allow camera access.

Use physical jumps to clear cacti. Lower your shoulders into a crouch and hold the position to duck beneath flying pterodactyls.

## Three-zone shoulder controls

Stand upright, face the camera, and stay still for one second after enabling it.
The camera preview shows a red jump line, green standing baseline, and amber
duck line. Gameplay cannot start until calibration finishes.

- Raise shoulders above the red line to trigger one jump (25% of calibrated shoulder width).
- Lower shoulders below the amber line to duck (35% of calibrated shoulder width).
- Return to the middle to stand and rearm jumping. There is no timed standing delay.
- Small release margins prevent flickering at a threshold.
- Click **NEW PLAYER / RECALIBRATE** for each new player or after changing camera distance.
  This ends the current round and captures a new standing baseline.
- No velocity-based jump trigger or keyboard jump controls are used.

The lines use calibrated shoulder width in image-pixel proportions. Keep the camera
stationary and face forward. The baseline does not drift while playing.

Run the synthetic control tests with `node --test components/poseControls.test.mjs`.
Live webcam responsiveness and child/adult sensitivity still need physical testing.

## Vertical TV layout

The app fills the browser with two equal-height panels:

- **Top half:** Dino game, sound control, and full-screen button.
- **Bottom half:** Large mirrored live camera, shoulder tracking and threshold lines,
  movement indicators, and **NEW PLAYER / RECALIBRATE**.

The camera stays visible during play, calibration, and game over. Both the game
and camera preserve their proportions; space around the image is intentional so
no obstacles or parts of the camera view get cropped. Jump and duck thresholds,
calibration, collision geometry, and game speed are unchanged.

For the TV:

1. Set the external TV to portrait orientation in your computer's display settings.
2. Use it as an extended display and move the Chrome window onto the TV.
3. Open `http://localhost:3000` and click **FULL SCREEN** in the app.
4. Enable the camera and stand upright and still to calibrate.
5. Jump to start. Use **NEW PLAYER / RECALIBRATE** when players change.

Press **Esc** or **EXIT FULL SCREEN** to leave full screen. If your browser blocks
that button, use its View menu to enter full screen. No OBS or second camera app
is needed. The app requests a sharper 1280 × 960 camera feed when supported;
video and tracking lines scale together without cropping or stretching.

## Science Fest setup

- Run `npm install` before the event while online.
- Start the app with `npm run dev -- --host`.
- Use Chrome and grant camera permission when prompted.
- Keep the laptop connected to power and prevent it from sleeping.
- Test the camera position and jumping distance before students arrive.

## Production check

```bash
npm run build
npm run preview -- --host
```
