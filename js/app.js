import { RunnerGame } from './game.js';
import { MotionTracker, calibrationTarget, effortLevel } from './movement.js';
import { Renderer } from './renderer.js';
import { CameraController } from './camera.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['settings','duration','sensitivity','sensitivity-value','sensitivity-group','difficulty-help','movement-help','status','start-camera','start-demo','stage-message','message-title','message-copy','mode-badge','timer','energy-value','energy-meter','energy-fill','energy-note','distance','active-time','best-distance','best-mode','pause','end','scene-caption','game-hint','demo-controls','demo-move','camera-panel','camera-status','pose-overlay'].map(id => [id, $(id)]));
const renderer = new Renderer($('game-canvas'));
let phase = 'idle', mode = 'camera', game = null, tracker = null;
let motion = 0, target = 60, lastPose = -Infinity, validPose = false;
let calibrationElapsed = 0, calibrationSamples = [], countdown = 0;
let manualPause = false, lastFrame = performance.now(), demoHeld = false, keyHeld = false;
let sessionToken = 0, assetsReady = false;
let posePoints = [], cameraSampleTime = null;
const prefsKey = 'questathon.preferences.v1';
const bestKey = 'questathon.best.v1';
const connectionPairs = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
const difficultyCopy = { gentle:'Less movement needed to maintain speed.', moderate:'Steady movement to keep running.', active:'More movement needed to maintain speed.', custom:'Adjust how much movement powers the runner.' };

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ }
}
function choice(name) { return document.querySelector(`input[name="${name}"]:checked`).value; }
function preferences() { return { duration: ui.duration.value, difficulty: choice('difficulty'), movement: choice('movement'), sensitivity: ui.sensitivity.value }; }
function restorePreferences() {
  const saved = readStorage(prefsKey, {});
  if (['0','60','120','300'].includes(saved.duration)) ui.duration.value = saved.duration;
  for (const name of ['difficulty','movement']) {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) if (input.value === saved[name]) input.checked = true;
  }
  if (Number(saved.sensitivity) >= 0.5 && Number(saved.sensitivity) <= 2) ui.sensitivity.value = saved.sensitivity;
}
function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2,'0')}`;
}
function status(text, error = false) { ui.status.textContent = text; ui.status.classList.toggle('error', error); }
function message(title, copy, mark = 'II') {
  ui['stage-message'].hidden = false;
  ui['message-title'].textContent = title;
  ui['message-copy'].textContent = copy;
  document.querySelector('.message-mark').textContent = mark;
}
function updatePreferences() {
  ui['sensitivity-group'].hidden = choice('difficulty') !== 'custom';
  ui['sensitivity-value'].value = `${Number(ui.sensitivity.value).toFixed(1)}×`;
  ui['difficulty-help'].textContent = difficultyCopy[choice('difficulty')];
  ui['movement-help'].textContent = choice('movement') === 'seated' ? 'Move your arms comfortably. Keep shoulders, elbows and wrists in view.' : 'March, step side to side, or move your arms.';
  if (phase === 'idle' || phase === 'finished') {
    ui.timer.textContent = ui.duration.value === '0' ? '∞' : formatTime(Number(ui.duration.value));
    ui.timer.setAttribute('aria-label', ui.duration.value === '0' ? 'Elapsed time' : 'Time remaining');
  }
  writeStorage(prefsKey, preferences());
}
function showBest() {
  const best = readStorage(bestKey, {});
  ui['best-distance'].textContent = Math.floor(Number(best[mode]) || 0);
  ui['best-mode'].textContent = mode === 'demo' ? 'demo' : 'camera';
}
function lockSetup(locked) {
  ui.settings.disabled = locked;
  ui.end.disabled = !locked;
  ui.end.textContent = phase === 'loading' || phase === 'calibrating' || phase === 'countdown' ? 'Cancel' : 'Finish';
}
function resetInput() { demoHeld = false; keyHeld = false; motion = 0; cameraSampleTime = null; }

function drawPose() {
  const canvas = ui['pose-overlay'];
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,320,240);
  const isVisible = p => p && p.visibility >= 0.6;
  ctx.strokeStyle = '#baff9d';ctx.lineWidth = 2;
  for (const [a,b] of connectionPairs) {
    const p = posePoints[a], q = posePoints[b];
    if (!isVisible(p) || !isVisible(q)) continue;
    if (choice('movement') === 'seated' && (a > 24 || b > 24)) continue;
    ctx.beginPath();ctx.moveTo(p.x*320,p.y*240);ctx.lineTo(q.x*320,q.y*240);ctx.stroke();
  }
  ctx.fillStyle = '#fffefa';
  posePoints.forEach((p,i) => {
    if (i < 11 || !isVisible(p) || (choice('movement') === 'seated' && i > 24)) return;
    ctx.beginPath();ctx.arc(p.x*320,p.y*240,2.5,0,Math.PI*2);ctx.fill();
  });
}

function receivePose(points, timestamp) {
  if (!tracker || document.hidden || phase === 'finished' || phase === 'idle') return;
  const value = tracker.sample(points, timestamp);
  posePoints = points;
  drawPose();
  validPose = value !== null;
  if (!validPose) { motion = 0; cameraSampleTime = null; ui['camera-status'].textContent = 'Step into view so your joints are visible.'; return; }
  lastPose = performance.now();
  const dt = cameraSampleTime === null ? 0.1 : Math.max(0, Math.min(0.5, (timestamp-cameraSampleTime)/1000));
  cameraSampleTime = timestamp;
  motion += (value-motion) * (1-Math.exp(-dt/0.25));
  if (phase === 'calibrating') calibrationSamples.push(value);
  ui['camera-status'].textContent = phase === 'calibrating' ? 'Move at a comfortable pace.' : 'Movement tracking is on';
}

function fail(error) {
  const errors = {
    NotAllowedError:'Camera access was not allowed. Enable it in your browser’s site settings and try again, or use the keyboard demo.',
    NotFoundError:'No camera was found. Connect a webcam and try again, or use the keyboard demo.',
    NotReadableError:'The camera is busy or unavailable. Close other apps using it and try again.',
    OverconstrainedError:'This camera could not use the requested settings. Try another camera or the keyboard demo.',
  };
  sessionToken++;
  camera.stop();
  phase = 'idle';
  game = null;
  resetInput();
  ui['camera-panel'].hidden = true;
  ui['demo-controls'].hidden = true;
  ui.pause.disabled = true;
  lockSetup(false);
  status(errors[error.name] || error.message || 'Something went wrong. Start again or try the keyboard demo.', true);
  message('Camera unavailable', 'You can retry the camera or explore with the keyboard demo.', '↗');
  ui['mode-badge'].textContent = 'Ready to play';
}
const camera = new CameraController($('webcam'), receivePose, fail);

async function start(requestedMode) {
  if (!assetsReady || !['idle','finished'].includes(phase)) return;
  const token = ++sessionToken;
  camera.stop();
  mode = requestedMode;
  game = null;
  manualPause = false;
  resetInput();
  validPose = false;
  lastPose = -Infinity;
  target = 60;
  showBest();
  ui['demo-controls'].hidden = mode !== 'demo';
  ui['camera-panel'].hidden = mode !== 'camera';
  ui.pause.disabled = true;
  ui.pause.textContent = 'Pause';
  phase = mode === 'camera' ? 'loading' : 'countdown';
  lockSetup(true);
  ui['mode-badge'].textContent = mode === 'demo' ? 'Keyboard demo' : 'Camera break';
  ui['scene-caption'].textContent = mode === 'demo' ? 'Demo mode · keyboard or touch' : 'Camera break · your movement powers the run';
  if (mode === 'demo') {
    countdown = 0;
    status('Keyboard demo: hold Space or the Hold to move button. Camera is off.');
    message('Try the demo', 'Hold Space or the button below the game to build energy.', '3');
    return;
  }
  tracker = new MotionTracker(choice('movement'));
  calibrationSamples = [];
  calibrationElapsed = 0;
  message('Setting up your camera', 'Allow camera access. Movement tracking may take a moment to load.', '↗');
  status('Waiting for camera permission and loading movement tracking. You can cancel below the game.');
  try {
    const started = await camera.start();
    if (token !== sessionToken || !started) return;
    phase = 'calibrating';
    lockSetup(true);
    message('Calibrate your movement', 'Move comfortably for 8 seconds. We’ll tune the game to your range.', '8');
    status('Calibration: move your arms or march gently. Keep your chosen body area in view.');
  } catch (error) { if (token === sessionToken) fail(error); }
}

function beginRun() {
  phase = 'running';
  game = new RunnerGame({ duration: Number(ui.duration.value) || Infinity });
  ui.timer.setAttribute('aria-label', game.duration === Infinity ? 'Elapsed time' : 'Time remaining');
  motion = 0;
  tracker?.reset();
  ui['stage-message'].hidden = true;
  ui.pause.disabled = false;
  lockSetup(true);
  status(mode === 'demo' ? 'Demo running. Hold Space or Hold to move. This is not an exercise measurement.' : 'Your break is running. Move comfortably to build energy; pause whenever you need.');
}

function finish(reason = 'finished') {
  const wasSetup = ['loading','calibrating','countdown'].includes(phase);
  sessionToken++;
  camera.stop();
  phase = 'finished';
  resetInput();
  validPose = false;
  posePoints = [];
  ui['camera-panel'].hidden = true;
  ui['demo-controls'].hidden = true;
  ui.pause.disabled = true;
  ui.pause.textContent = 'Pause';
  lockSetup(false);
  ui['start-camera'].textContent = 'Start another break';
  if (game && !wasSetup) {
    if (game.status === 'running') game.status = 'finished';
    const best = readStorage(bestKey, {});
    best[mode] = Math.max(Number(best[mode]) || 0, Math.floor(game.distance));
    writeStorage(bestKey, best);
    showBest();
    const title = reason === 'caught' ? 'The creature caught up' : mode === 'demo' ? 'Demo finished' : 'Break complete';
    const copy = mode === 'demo' ? `You explored ${Math.floor(game.distance)} m. Try a camera break to power the game with your movement.` : `${formatTime(game.activeTime)} of movement · ${Math.floor(game.distance)} m explored. Take a breath, and come back whenever you’re ready.`;
    message(title, copy, reason === 'caught' ? 'II' : '✓');
    status(mode === 'camera' ? 'Break ended. Your camera is off. Choose your settings for another break.' : 'Demo ended. Your camera was never used.');
  } else {
    game = null;
    message('Ready when you are.', 'Your setup was cancelled. Change your settings or try the keyboard demo.', '↗');
    status('Setup cancelled. Your camera is off.');
  }
}

function pause() {
  if (phase !== 'running') return;
  manualPause = !manualPause;
  resetInput();
  tracker?.reset();
  ui.pause.textContent = manualPause ? 'Resume' : 'Pause';
  status(manualPause ? 'Paused. The timer and chase are stopped. Press Resume when ready.' : 'Your break is running again.');
}

function renderStats() {
  const energy = Math.round(game?.energy ?? 0);
  ui['energy-value'].textContent = `${energy}%`;
  ui['energy-fill'].style.width = `${energy}%`;
  ui['energy-meter'].setAttribute('aria-valuenow', energy);
  ui.distance.textContent = Math.floor(game?.distance ?? 0);
  ui['active-time'].textContent = formatTime(game?.activeTime ?? 0);
  if (game) {
    ui.timer.textContent = game.duration === Infinity ? formatTime(game.elapsed) : formatTime(Math.ceil(Math.max(0,game.duration-game.elapsed)));
    ui['energy-note'].textContent = phase === 'finished' ? 'Break finished' : energy > 65 ? 'You’ve found your momentum' : energy > 25 ? 'Keep your movement going' : 'Move to fill your meter';
  }
}

function frame(now) {
  const dt = Math.max(0, Math.min(0.1,(now-lastFrame)/1000));
  lastFrame = now;
  const tracked = mode === 'demo' || (validPose && now-lastPose < 800);
  if (phase === 'calibrating' && !document.hidden) {
    if (tracked) calibrationElapsed += dt;
    if (calibrationElapsed >= 8 && calibrationSamples.filter(n => n > 8).length >= 8) {
      target = calibrationTarget(calibrationSamples);
      phase = 'countdown';
      countdown = 0;
      status('Calibration complete. Get ready to move.');
    } else if (calibrationElapsed >= 8) {
      message('Keep moving to calibrate', 'Move your arms a few more times so we can find your comfortable range.', '↗');
    } else {
      message(tracked ? 'Calibrate your movement' : 'Step into view', tracked ? 'Keep moving comfortably. We’re learning your range.' : 'Keep your shoulders, elbows and wrists visible. Legs help in standing mode.', String(Math.max(1,Math.ceil(8-calibrationElapsed))));
    }
  }
  if (phase === 'countdown' && !document.hidden) {
    if (tracked) countdown += dt;
    message(tracked ? 'Starting in…' : 'Step back into view', mode === 'demo' ? 'Hold Space or the button below the game to run.' : tracked ? 'Move comfortably to stay ahead. Pause any time.' : 'Step into camera view to continue the countdown.', tracked ? String(Math.max(1,Math.ceil(3-countdown))) : 'II');
    if (countdown >= 3) beginRun();
  }
  if (phase === 'running') {
    game.paused = manualPause || !tracked || document.hidden;
    if (manualPause) message('Paused', 'The timer and chase are stopped. Press Resume to continue.', 'II');
    else if (!tracked) message('Let’s find you again.', 'The timer and chase are paused. Step into view to continue.', 'II');
    else ui['stage-message'].hidden = true;
    const effort = mode === 'demo' ? (demoHeld || keyHeld ? 1 : 0) : effortLevel(motion,target,choice('difficulty'),Number(ui.sensitivity.value));
    game.step(dt, effort);
    if (game.status !== 'running') finish(game.status);
  }
  renderer.draw(game);
  renderStats();
  requestAnimationFrame(frame);
}

$('setup-form').addEventListener('submit', event => { event.preventDefault(); start('camera'); });
ui['start-demo'].addEventListener('click', () => start('demo'));
ui.pause.addEventListener('click', pause);
ui.end.addEventListener('click', () => finish());
ui.settings.addEventListener('input', updatePreferences);
ui['demo-move'].addEventListener('pointerdown', event => {
  if (mode !== 'demo' || !['countdown','running'].includes(phase) || manualPause) return;
  event.preventDefault();
  ui['demo-move'].setPointerCapture(event.pointerId);
  demoHeld = true;
});
for (const name of ['pointerup','pointercancel','lostpointercapture']) ui['demo-move'].addEventListener(name, () => { demoHeld = false; });
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || mode !== 'demo' || !['countdown','running'].includes(phase) || manualPause) return;
  if (['INPUT','SELECT','TEXTAREA','A'].includes(event.target.tagName)) return;
  if (event.target.tagName === 'BUTTON' && event.target.id !== 'demo-move' && !event.target.disabled) return;
  event.preventDefault();keyHeld = true;
});
// Native Space activation on the demo button supports keyboard-only players.
ui['demo-move'].addEventListener('keydown', event => { if (event.code === 'Space' && ['countdown','running'].includes(phase) && !manualPause) { event.preventDefault(); keyHeld = true; } });
document.addEventListener('keyup', event => { if (event.code === 'Space') keyHeld = false; });
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => {
  resetInput();tracker?.reset();
  if (document.hidden && phase === 'running') { manualPause = true; ui.pause.textContent = 'Resume'; status('Paused because you left the tab. Press Resume when you return.'); }
});
window.addEventListener('pagehide', () => camera.stop());
restorePreferences();updatePreferences();showBest();
try { await renderer.load(); assetsReady = true; }
catch (error) { ui.settings.disabled = true; status(error.message,true); message('The city couldn’t load.', 'Reload the page. On a hosted copy, check that the assets folder is included.', '↗'); }
requestAnimationFrame(frame);
