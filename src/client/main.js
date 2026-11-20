import { createSimulation, TICKS_PER_SECOND } from '../sim/engine.js';
import { distance } from '../sim/player.js';
import { lanternCost, nearestLantern } from '../sim/lanterns.js';
import { createAudio } from './audio.js';
import { createRenderer, createScene } from './scene.js';
import { bindingIndex, bindingLabel, createBindingEditor, loadBindings } from './controls.js';
import { loadLeaderboard, showScoreForm } from './leaderboard.js';
import { createCues } from './cues.js';

const response = await fetch(new URL('../../game.contract.json', import.meta.url));
if (!response.ok) throw new Error(`HTTP ${response.status} while loading game.contract.json`);
const { tuning } = await response.json();

const $ = id => document.getElementById(id);
const canvas = $('world');
const panels = {
  menu: $('menu'), intro: $('intro'), pause: $('pause-menu'), settings: $('settings'), summary: $('summary'), dawn: $('dawn'),
  leaderboard: $('leaderboard'),
};
const hud = $('hud');
const number = new Intl.NumberFormat('vi-VN');
const STEP = 1 / TICKS_PER_SECOND;
const INITIAL_YAW = Math.PI;
const PULSE_LENGTH = 0.57;
const SETTING_KEY = 'lantern-island.settings';
const NIGHTS = [
  ['Đảo Bến', 'Mây à, đèn sẽ cạn dầu dần. Hãy gom đom đóm để thắp và châm dầu, giữ đủ đèn sáng tới bình minh.'],
  ['Đảo Cau', 'Cầu tre nối hai bờ, còn bục nhảy đưa con qua biển mây. Nếu Gió Lạc cướp đom đóm, hãy tỏa sáng để lấy lại.'],
  ['Đảo Chuông', 'Theo đường dốc và bục nhảy để lên tháp chuông. Khi nghe báo gió mạnh, nhớ tránh mép đảo.'],
];
const TOGGLES = { colorblind: 'colorblind', 'reduce-motion': 'reduceMotion', 'large-text': 'largeText' };

function loadSettings() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(SETTING_KEY));
  } catch { /* Start with defaults when storage is unavailable. */ }
  const safe = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    volume: safe(stored?.volume, 0, 100, 65), sensitivity: safe(stored?.sensitivity, 25, 200, 100),
    colorblind: stored?.colorblind === true, largeText: stored?.largeText === true,
    reduceMotion: typeof stored?.reduceMotion === 'boolean' ? stored.reduceMotion : matchMedia('(prefers-reduced-motion: reduce)').matches,
    bindings: loadBindings(stored?.bindings),
  };
}

const settings = loadSettings();
const audio = createAudio(settings.volume / 100);
const renderer = createRenderer(canvas);
const cues = createCues(canvas, $('visual-cues'), $('cue-arrows'));
const keys = new Set();
const queued = new Set();
const lastButtons = { jump: false, dash: false, interact: false, pulse: false, pause: false };
const query = new URLSearchParams(location.search);
const requestedNight = Number(query.get('night'));
const requestedSeed = Number(query.get('seed'));
const seed = Number.isSafeInteger(requestedSeed) ? requestedSeed : 0;
const firstNight = [1, 2, 3].includes(requestedNight) ? requestedNight : 1;
let bindingsByCode = bindingIndex(settings.bindings);
const keyEditor = createBindingEditor($('keybindings'), $('binding-status'), () => settings.bindings, bindings => {
  settings.bindings = bindings;
  bindingsByCode = bindingIndex(bindings);
  clearInput();
  updateBindingHints();
  saveSettings();
});
let night = firstNight;
let screen;
let settingsReturn = 'menu';
let simulation;
let state;
let scene;
let sceneNight;
let campaignScore = 0;
let nightsWon = 0;
let previousFoot;
let yaw;
let facing;
let walk;
let previousFrame;
let accumulator;
let elapsed;
let hitAt;
let dashAt;
let windWarningAt;
let pulse;
let dragging;
let mouseDash = false;
let pauseRequested = false;

function createSlots(parent, className, count) {
  return Array.from({ length: count }, () => {
    const slot = document.createElement('span');
    slot.className = className;
    parent.append(slot);
    return slot;
  });
}

const flameIcons = createSlots($('flame-icons'), 'flame', tuning.flames);
const moteSlots = createSlots($('mote-slots'), 'mote-slot', tuning.capacity_max);
const hudFields = Object.fromEntries(['flames', 'lit', 'lantern-total', 'score', 'time', 'carried', 'notice', 'interact-text',
  'interact-prompt', 'dash-status', 'dash-cooldown', 'pulse-status', 'pulse-cooldown', 'wayfinder', 'wayfinder-arrow',
  'wayfinder-distance'].map(id => [id, $(id)]));

function text(element, content) {
  if (element.textContent !== content) element.textContent = content;
}

function clearInput() {
  keys.clear();
  queued.clear();
  mouseDash = false;
  if (dragging && canvas.hasPointerCapture(dragging.id)) canvas.releasePointerCapture(dragging.id);
  dragging = undefined;
}

function resetNight(nextNight) {
  night = nextNight;
  simulation = createSimulation({ tuning, night, seed });
  state = simulation.snapshot();
  if (sceneNight !== night) {
    scene?.dispose();
    scene = createScene(renderer, state, tuning, simulation.layout);
    sceneNight = night;
  }
  previousFoot = state.player;
  yaw = facing = INITIAL_YAW;
  walk = accumulator = elapsed = 0;
  hitAt = dashAt = windWarningAt = -Infinity;
  cues.reset();
  $('summary-score-slot').replaceChildren();
  $('dawn-score-slot').replaceChildren();
  pulse = undefined;
  pauseRequested = false;
  for (const action of Object.keys(lastButtons)) lastButtons[action] = false;
  clearInput();
  $('night-label').textContent = `Đêm ${night}`;
}

function show(next, focusId) {
  screen = next;
  $('game').dataset.screen = next;
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== next;
  hud.hidden = next !== 'play';
  canvas.inert = next !== 'play';
  clearInput();
  audio.music(['menu', 'intro', 'play'].includes(next), night);
  const focus = next === 'play' ? canvas : focusId ? $(focusId) : panels[next].querySelector('button:not([hidden])');
  focus?.focus({ preventScroll: true });
}

function openIntro(nextNight) {
  resetNight(nextNight);
  const [title, dialogue] = NIGHTS[night - 1];
  $('intro-night').textContent = `Đêm ${night}`;
  $('intro-title').textContent = title;
  $('intro-dialogue').textContent = dialogue;
  const minutes = Math.floor(state.time_left_s / 60);
  const seconds = String(state.time_left_s % 60).padStart(2, '0');
  const needed = Math.ceil(state.lanterns.length * tuning.win_ratio);
  $('intro-objective').textContent = `Giữ ít nhất ${needed}/${state.lanterns.length} đèn sáng đến hết ${minutes}:${seconds}.`;
  show('intro');
}

function openMenu() {
  resetNight(firstNight);
  campaignScore = 0;
  nightsWon = 0;
  show('menu');
}

function startPlay() {
  void audio.unlock();
  show('play');
}

function replay() {
  resetNight(night);
  startPlay();
}

function displaySettings() {
  for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = settings[key];
  for (const setting of ['volume', 'sensitivity']) {
    $(setting).value = settings[setting];
    $(`${setting}-value`).value = `${settings[setting]}%`;
  }
  keyEditor.cancel();
}

function saveSettings() {
  try { localStorage.setItem(SETTING_KEY, JSON.stringify(settings)); } catch { /* Keep settings for this session. */ }
}

function applyAppearance() {
  $('game').classList.toggle('colorblind', settings.colorblind);
  $('game').classList.toggle('reduce-motion', settings.reduceMotion);
  document.documentElement.classList.toggle('large-text', settings.largeText);
}

function updateBindingHints() {
  const label = action => bindingLabel(settings.bindings[action]);
  $('move-keys').textContent = ['forward', 'left', 'backward', 'right'].map(action => bindingLabel(settings.bindings[action].slice(0, 1))).join(' / ');
  $('jump-key').textContent = label('jump');
  $('dash-key').textContent = `${label('dash')} / Chuột phải`;
  $('pulse-key').textContent = label('pulse');
  $('interact-key').textContent = label('interact');
  $('pause-button').title = `Tạm dừng (${label('pause')})`;
  $('pause-button').setAttribute('aria-label', $('pause-button').title);
}

function openSettings(from) {
  settingsReturn = from;
  displaySettings();
  show('settings', 'volume');
}

function closeSettings() {
  keyEditor.cancel();
  show(settingsReturn, settingsReturn === 'pause' ? 'pause-settings' : 'menu-settings');
}

function showSummary() {
  const won = state.state === 'won';
  const lit = state.lanterns.filter(lantern => lantern.lit).length;
  if (won) {
    campaignScore += state.score;
    nightsWon++;
  } else {
    showScoreForm($('summary-score-slot'), { score: campaignScore + state.score, nights_won: nightsWon, seed });
  }
  $('summary-night').textContent = `Tổng kết · Đêm ${night}`;
  $('summary-title').textContent = won ? 'Đảo đã bừng sáng' : state.reason === 'no_flames' ? 'Mây đã hết lửa' : 'Đêm đã kết thúc';
  $('summary-detail').textContent = won ? 'Mây giữ đủ đèn sáng đến bình minh.' :
    state.reason === 'no_flames' ? 'Mây cần thêm ngọn lửa để đi tiếp.' : 'Khi bình minh đến, số đèn đang sáng dưới mức cần thiết.';
  $('summary-lanterns').textContent = `${lit}/${state.lanterns.length}`;
  $('summary-flames').textContent = state.player.flames;
  $('summary-score').textContent = number.format(state.score);
  $('next-night').textContent = night === 3 ? 'Đón Bình Minh' : `Sang Đêm ${night + 1}`;
  $('next-night').hidden = !won;
  $('summary-retry').hidden = won;
  audio.play(won ? 'won' : 'lost');
  show('summary', won ? 'next-night' : 'leaderboard-name');
}

$('begin').addEventListener('click', () => {
  void audio.unlock();
  openIntro(night);
});
$('play').addEventListener('click', startPlay);
$('pause-button').addEventListener('click', () => { pauseRequested = true; });
$('resume').addEventListener('click', () => { pauseRequested = true; });
$('pause-retry').addEventListener('click', replay);
$('summary-retry').addEventListener('click', replay);
for (const id of ['intro-menu', 'pause-exit', 'summary-menu', 'dawn-menu']) $(id).addEventListener('click', openMenu);
$('menu-settings').addEventListener('click', () => openSettings('menu'));
$('pause-settings').addEventListener('click', () => openSettings('pause'));
$('settings-back').addEventListener('click', closeSettings);
$('reset-bindings').addEventListener('click', () => keyEditor.reset());
$('menu-leaderboard').addEventListener('click', () => {
  show('leaderboard');
  void loadLeaderboard();
});
$('leaderboard-back').addEventListener('click', openMenu);
$('next-night').addEventListener('click', () => {
  if (night < 3) openIntro(night + 1);
  else {
    $('dawn-score').textContent = number.format(campaignScore);
    showScoreForm($('dawn-score-slot'), { score: campaignScore, nights_won: nightsWon, seed });
    show('dawn', 'leaderboard-name');
  }
});
for (const setting of ['volume', 'sensitivity']) {
  $(setting).addEventListener('input', event => {
    settings[setting] = Number(event.target.value);
    $(`${setting}-value`).value = `${settings[setting]}%`;
    if (setting === 'volume') audio.setVolume(settings.volume / 100);
    saveSettings();
  });
}
for (const [id, key] of Object.entries(TOGGLES)) {
  $(id).addEventListener('change', event => {
    settings[key] = event.target.checked;
    applyAppearance();
    saveSettings();
  });
}

window.addEventListener('keydown', event => {
  if (screen === 'settings' && keyEditor.capture(event)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const { code } = event;
  const action = bindingsByCode.get(code);
  if (code === 'Tab' && screen !== 'play') {
    const controls = [...panels[screen].querySelectorAll('button:not([disabled]):not([hidden]), input')];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0]).focus();
    }
    return;
  }
  if (action === 'pause' || (screen === 'settings' && code === 'Escape')) {
    if (screen === 'play' || screen === 'pause') {
      event.preventDefault();
      if (!event.repeat) pauseRequested = true;
    } else if (screen === 'settings' && (code === 'Escape' || settingsReturn === 'pause')) {
      event.preventDefault();
      if (!event.repeat) closeSettings();
    }
    return;
  }
  if (screen !== 'play' || (!action && code !== 'KeyQ')) return;
  if (event.target === $('pause-button') && code === 'Space') return;
  event.preventDefault();
  if (event.repeat) return;
  keys.add(code);
  if (Object.hasOwn(lastButtons, action)) queued.add(action);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInput();
  previousFrame = undefined;
  accumulator = 0;
  audio.music(!document.hidden && ['menu', 'intro', 'play'].includes(screen), night);
});

canvas.addEventListener('pointerdown', event => {
  if (screen !== 'play' || event.button !== 0 || dragging) return;
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  dragging = { id: event.pointerId, x: event.clientX };
});
canvas.addEventListener('pointermove', event => {
  if (dragging?.id !== event.pointerId) return;
  yaw -= (event.clientX - dragging.x) * 0.006 * (settings.sensitivity / 100);
  dragging.x = event.clientX;
});
canvas.addEventListener('lostpointercapture', () => { dragging = undefined; });
canvas.addEventListener('mousedown', event => {
  if (screen !== 'play' || event.button !== 2) return;
  event.preventDefault();
  mouseDash = true;
  queued.add('dash');
});
window.addEventListener('mouseup', event => { if (event.button === 2) mouseDash = false; });
canvas.addEventListener('contextmenu', event => { if (screen === 'play') event.preventDefault(); });

function readButton(action, held) {
  if (!queued.has(action)) return held;
  // Deliver a release tick before the next press if it arrived between two simulation ticks.
  if (lastButtons[action]) return false;
  queued.delete(action);
  return true;
}

function nearbyLantern() {
  // Even a full lantern decays during the timer step before an interaction is resolved.
  return nearestLantern(state.player, state.lanterns, () => true, tuning.interact_radius);
}

function cooldown(id, seconds, max, readyText = 'Sẵn sàng') {
  text(hudFields[`${id}-status`], seconds > 0 ? `${seconds.toFixed(1).replace('.', ',')} s` : readyText);
  hudFields[`${id}-cooldown`].style.setProperty('--ready', `${100 * Math.max(0, 1 - seconds / max)}%`);
}

const held = action => settings.bindings[action].some(code => keys.has(code));

function updateHud() {
  const { player } = state;
  const seconds = Math.ceil(state.time_left_s);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  text(hudFields.time, `${minutes}:${remainder}`);
  hudFields.time.dateTime = `PT${seconds}S`;
  hudFields.time.classList.toggle('urgent', seconds <= 30);
  text(hudFields.carried, `${player.carried} / ${player.capacity}`);
  text(hudFields.flames, String(player.flames));
  flameIcons.forEach((icon, index) => icon.classList.toggle('lit', index < player.flames));
  moteSlots.forEach((slot, index) => {
    slot.hidden = index >= player.capacity;
    slot.classList.toggle('filled', index < player.carried);
  });
  text(hudFields.lit, String(state.lanterns.filter(lantern => lantern.lit).length));
  text(hudFields['lantern-total'], `/ ${state.lanterns.length}`);
  text(hudFields.score, number.format(state.score));
  cooldown('dash', player.dash_cd_s, tuning.dash_cooldown_s);
  cooldown('pulse', player.pulse_cd_s, tuning.pulse_cooldown_s,
    player.carried >= tuning.pulse_cost ? 'Sẵn sàng' : `Cần ${tuning.pulse_cost} đom đóm`);

  const windWarning = state.sim_tick < windWarningAt;
  const lowFuel = nearestLantern(player, state.lanterns, lantern => lantern.lit && lantern.fuel < tuning.low_fuel_threshold);
  cues.render(state, scene, { seconds, windWarning, lowFuel });
  const notice = state.wind.active ? 'Gió mạnh đang thổi' : windWarning ? 'Gió mạnh sắp đến' :
    player.charm_s > 0 ? `Bùa Gió · ${Math.ceil(player.charm_s)} s` : '';
  hudFields.notice.hidden = notice === '';
  hudFields.notice.classList.toggle('warning', state.wind.active || windWarning);
  text(hudFields.notice, notice);

  const nearby = nearbyLantern();
  hudFields['interact-prompt'].hidden = !nearby;
  hudFields['interact-prompt'].classList.toggle('warning', !!nearby?.lit && nearby.fuel < tuning.low_fuel_threshold);
  if (nearby) text(hudFields['interact-text'], nearby.lit ? `— Châm dầu (${nearby.fuel.toFixed(1)}%)` :
    `— ${nearby.ever_lit ? 'Thắp lại' : 'Nạp ánh sáng'} (${nearby.deposited}/${lanternCost(nearby, tuning)})`);
  const target = nearestLantern(player, state.lanterns, lantern => !lantern.lit) ??
    nearestLantern(player, state.lanterns, lantern => lantern.fuel < tuning.low_fuel_threshold);
  const marker = target && scene.projectLantern(target);
  const arrow = hudFields.wayfinder;
  arrow.hidden = !marker;
  if (!marker) return;
  arrow.style.left = `${marker.x}px`;
  arrow.style.top = `${marker.y}px`;
  hudFields['wayfinder-arrow'].style.transform = `rotate(${marker.angle}rad)`;
  text(hudFields['wayfinder-distance'], `${Math.round(Math.hypot(target.x - player.x, target.z - player.z))} m`);
}

function step() {
  const inPlay = screen === 'play';
  const x = Number(held('right')) - Number(held('left'));
  const z = Number(held('backward')) - Number(held('forward'));
  const buttons = {
    jump: inPlay && readButton('jump', held('jump')),
    dash: inPlay && readButton('dash', mouseDash || held('dash')),
    interact: inPlay && readButton('interact', held('interact')),
    pulse: inPlay && readButton('pulse', held('pulse')),
    pause: pauseRequested && !lastButtons.pause,
  };
  if (buttons.pause) pauseRequested = false;
  Object.assign(lastButtons, buttons);

  previousFoot = state.player;
  const previousSeconds = Math.ceil(state.time_left_s);
  const previousShades = state.shades;
  const events = simulation.step({ x, z, ...buttons, cam_yaw_deg: yaw * 180 / Math.PI });
  state = simulation.snapshot();
  const { player } = state;
  const dx = player.x - previousFoot.x;
  const dz = player.z - previousFoot.z;
  walk = Number(player.grounded && Math.hypot(dx, dz) > 0.002);
  if (Math.hypot(dx, dz) > 0.002) facing = Math.atan2(-dx, -dz);

  for (const record of events) {
    const event = record.event ?? record.name;
    audio.play(event);
    if (event === 'refuel') audio.play('deposit');
    if (event === 'pulse') pulse = { ...player, start: elapsed };
    if (event === 'player_hit') hitAt = elapsed;
    if (event === 'dash') dashAt = elapsed;
    if (event === 'wind_warning') windWarningAt = state.sim_tick + 120;
    if (event === 'paused') show('pause');
    if (event === 'resumed') show('play');
    if (event === 'game_over') showSummary();
  }
  if (state.shades.length > previousShades.length) {
    const existing = new Set(previousShades.map(shade => shade.id));
    const closest = state.shades.filter(shade => !existing.has(shade.id)).reduce((nearest, shade) =>
      !nearest || distance(player, shade) < distance(player, nearest) ? shade : nearest, null);
    if (closest) cues.spawn(closest, state.sim_tick);
    audio.play('shade_spawn');
  }
  if (previousFoot.grounded && !player.grounded && player.vel[1] === 7) audio.play('jump');
  const seconds = Math.ceil(state.time_left_s);
  if (seconds !== previousSeconds && seconds > 0 && seconds <= 10) audio.play(seconds === 1 ? 'countdown_last' : 'countdown');
}

function frame(now) {
  const dt = previousFrame === undefined ? 0 : Math.max(0, Math.min(0.15, (now - previousFrame) / 1000));
  previousFrame = now;
  if (state.state !== 'paused') elapsed += dt;
  if (screen === 'play') {
    const turnRight = keys.has('KeyE') && bindingsByCode.get('KeyE') === 'interact' && !nearbyLantern();
    const turnLeft = keys.has('KeyQ') && !bindingsByCode.has('KeyQ');
    yaw = (yaw + (Number(turnRight) - Number(turnLeft)) * dt * 1.75) % (2 * Math.PI);
  }
  const ticking = () => screen === 'play' || screen === 'pause' || (screen === 'settings' && settingsReturn === 'pause');
  if (ticking()) accumulator += dt;
  while (accumulator >= STEP && ticking()) {
    step();
    accumulator -= STEP;
  }

  const blend = screen === 'play' ? Math.min(1, accumulator / STEP) : 1;
  const foot = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis,
    previousFoot[axis] + (state.player[axis] - previousFoot[axis]) * blend,
  ]));
  if (pulse && elapsed - pulse.start >= PULSE_LENGTH) pulse = undefined;
  const hitIntensity = Math.max(0, 1 - (elapsed - hitAt) / 0.18);
  const dashIntensity = Math.max(0, 1 - (elapsed - dashAt) / 0.14);
  const shake = settings.reduceMotion ? 0 : Math.sin(elapsed * 55) * (hitIntensity * 0.21 + dashIntensity * 0.12);
  const flash = $('screen-flash');
  flash.style.opacity = settings.reduceMotion ? '0' : String(Math.max(hitIntensity * 0.23, dashIntensity * 0.13));
  flash.classList.toggle('hit', hitIntensity > 0);
  scene.render(state, {
    yaw: screen === 'menu' ? yaw + Math.sin(elapsed * 0.25) * 0.12 : yaw,
    facing, foot, walk: screen === 'play' ? walk : 0,
    pulse: pulse && { ...pulse, progress: (elapsed - pulse.start) / PULSE_LENGTH },
    hit: settings.reduceMotion ? Infinity : elapsed - hitAt, shake,
    backdrop: screen === 'menu', dawn: screen === 'dawn', colorblind: settings.colorblind,
  }, elapsed);
  if (screen === 'play') updateHud();
  requestAnimationFrame(frame);
}

resetNight(firstNight);
applyAppearance();
updateBindingHints();
$('begin').disabled = $('menu-settings').disabled = $('menu-leaderboard').disabled = false;
show('menu');
requestAnimationFrame(frame);
