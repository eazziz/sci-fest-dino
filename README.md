# Science Fest Dino Jump

Body-controlled Dino game for a portrait TV: game above, mirrored camera below.

## Run

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. Click **Enable Camera** once at booth setup to
grant camera access and unlock sound. Visitors do not need to touch the computer.
Use **Full Screen** for the TV.

For a production build, run `npm run build`, then `npm run preview`. The repository
includes the local model, WASM, and font assets under `public/`. Keep these assets
alongside the app when deploying. A non-localhost deployment needs HTTPS for camera
access.

## Walk-up play

1. Walk into the dashed middle area and face the screen.
2. The game automatically measures a stable, natural standing pose for about one
   second (at least 15 fresh pose detections). The area turns green when ready.
3. Jump to start; that same movement also makes the dinosaur jump. Duck for birds.
4. After game over, standing naturally recalibrates in the background; jump to retry.
5. Walking away clears the session after 1.8 seconds. The next visitor gets a new
   calibration automatically. **Reset Player** remains available as an operator fallback.

Place a floor marker at a distance where both shoulders and hips are visible and
there is room above the player's head to jump. Feet are optional, but visible legs
help reject crouched calibration poses. Aim the camera so waiting spectators stand
outside the central play area. No hands-up gesture is required.

## Practice round

Each new player's first round starts with a short trainer: "JUMP OVER THE CACTUS!",
then one slow, small cactus; then "DUCK UNDER THE BIRD!", then one slow bird. A miss
shakes the screen and the same obstacle comes again instead of ending the game, and
a bird only counts if the player ducked under it (jumping over it retries). Then
"YOU'RE READY!" and the real game starts. Restarts after a game over skip the trainer.
Timings and speed are in `TUTORIAL` in `components/DinoGame.tsx`.

## Tracking behavior

- Detect up to three poses; choose a centered player, with a preference for larger
  apparent body scale. If two candidates are too similar, ask for one player in the middle.
- Match the selected player across frames by shoulder and hip position plus body
  scale, not the order of the detector's output. Ignore other candidates while tracking them.
- Ducking-tolerant, passer-by-strict: once calibrated, the player may look bigger
  (bending/leaning toward the camera) but not smaller, since anyone behind them is
  farther away. Hip width is used instead of torso length, which shrinks when bending.
- Require stable horizontal position, shoulder height, hip height, and shoulder
  width before calibration. Visible bent knees, raised hands, and leaning delay it.
- Freeze calibration during a round, including while jumping and ducking.
- Jumps fire when the shoulders pass standing height while still rising fast
  (`RISE` in `poseControls.mjs`), typically ~50–70 ms before they clear the jump line.
  Standing up out of a squat has slowed to a stop by then, so it never counts; neither
  does rising out of a duck, and the landing bounce is ignored. The line remains a
  fallback for slow jumpers.
- If the player briefly vanishes from detection mid-round, hold their last state
  (e.g. still ducking) for up to 0.5 s; nobody else gets control during the hold.
  Then pause. No hold when two people overlap or the player visibly walks out.
  After a loss, a neutral pose is required before triggering another jump.
- A frozen camera or suspended tab cannot complete calibration using stale frames.

This uses pose geometry, not face recognition or persistent identity. Overlapping
people or an immediate swap between similarly sized people at the same location can
still be ambiguous. Frontal crouches with hidden legs can also resemble standing.
Test with the actual webcam, lighting, and player sizes before opening the booth;
three-person inference may reduce frame rate on slower laptops.

The acquisition area and timing constants live in `components/playerSession.mjs`.
Jump/duck sensitivity is in `components/poseControls.mjs` (`ZONES`).

## Verify

The **DEBUG ON / OFF** button opens a live diagnostic panel above the camera.
It is on by default for troubleshooting. Look for red **FAIL** rows and the **Last
reset** reason. Each row shows the measured value and the limit used by the actual
calibration check. **WAIT** means an earlier check has not passed yet; **SKIP** is
an optional body part that is out of view.

The panel includes raw pose count, which pose is being inspected, visibility
confidence, entry-area selection, player matching, posture checks, stability,
fresh sample count, dwell time, inference duration, detection interval, and frame
age. Expand **Inspect all detected poses** to inspect spectators as well. The
display updates at most five times per second (except errors and departures).
It also shows inference errors. If the update gap exceeds 300 ms, the failing gap
row and last-reset reason expose the calibration reset directly. During a round,
setup checks are informational because calibration is locked.

Send a screenshot of the panel while standing in position to diagnose a blocked
calibration. Hide it with **DEBUG ON** when visitors are playing.

```sh
npm test
npm run typecheck
npm run build
```

The tests use synthetic landmarks to cover adult/child sizing, approach motion,
crowds, detector reordering, jump/duck calibration lock, short tracking loss,
departure, camera gaps, and automatic calibration between rounds.

On the booth hardware, also try: an adult followed by a child; a spectator beside
the player; a deep duck; stepping out and back; walking away after game over; and
unplugging/reconnecting the camera. Verify that the indicated shoulder lines match
each new player. Automated tests do not measure real-camera tracking accuracy.
