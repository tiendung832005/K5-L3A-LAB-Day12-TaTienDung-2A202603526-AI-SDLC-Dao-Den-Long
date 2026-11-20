import { createSimulation, TICKS_PER_SECOND } from '../sim/engine.js';
import { createAudio } from './audio.js';
import { createRenderer, createScene } from './scene.js';

const response = await fetch(new URL('../../game.contract.json', import.meta.url));
if (!response.ok) throw new Error(`HTTP ${response.status} while loading game.contract.json`);
const { tuning } = await response.json();

const $ = id => document.getElementById(id);
const canvas = $('world');
const panels = {
  menu: $('menu'), intro: $('intro'), pause: $('pause-menu'), settings: $('settings'), summary: $('summary'), dawn: $('dawn'),
};
const hud = $('hud');
const number = new Intl.NumberFormat('vi-VN');
const STEP = 1 / TICKS_PER_SECOND;
const INITIAL_YAW = Math.PI;
const PULSE_LENGTH = 0.57;
const SETTING_KEY = 'lantern-island.settings';
const NIGHTS = [
  ['Đảo Bến', 'Mây à, gom đom đóm và mang ánh sáng về cho những ngọn đèn. Đèn đã thắp sẽ xua Bóng Mực ra xa.'],
  ['Đảo Cau', 'Cầu tre nối hai bờ, còn bục nhảy đưa con qua biển mây. Nếu Gió Lạc cướp đom đóm, hãy tỏa sáng để lấy lại.'],
  ['Đảo Chuông', 'Theo đường dốc và bục nhảy để lên tháp chuông. Khi nghe báo gió mạnh, nhớ tránh mép đảo.'],
];
const ACTION_KEYS = new Map([['Space', 'jump'], ['ShiftLeft', 'dash'], ['ShiftRight', 'dash'], ['KeyE', 'interact'], ['KeyF', 'pulse']]);
const GAME_KEYS = new Set([...ACTION_KEYS.keys(), 'KeyQ', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTING_KEY));
    const safe = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    return { volume: safe(stored?.volume, 0, 100, 65), sensitivity: safe(stored?.sensitivity, 25, 200, 100) };
  } catch {
    return { volume: 65, sensitivity: 100 };
  }
}

const settings = loadSettings();
const audio = createAudio(settings.volume / 100);
const renderer = createRenderer(canvas);
const keys = new Set();
const queued = new Set();
const lastButtons = { jump: false, dash: false, interact: false, pulse: false, pause: false };
const requestedNight = Number(new URLSearchParams(location.search).get('night'));
const firstNight = [1, 2, 3].includes(requestedNight) ? requestedNight : 1;
let night = firstNight;
let screen;
let settingsReturn = 'menu';
let simulation;
let state;
let scene;
let sceneNight;
let campaignScore = 0;
let previousFoot;
let yaw;
let facing;
let walk;
let previousFrame;
let accumulator;
let elapsed;
let hitAt;
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
const moteSlots = createSlots($('mote-slots'), 'mote-slot', tuning.carry_capacity);
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
  simulation = createSimulation({ tuning, night });
  state = simulation.snapshot();
  if (sceneNight !== night) {
    scene?.dispose();
    scene = createScene(renderer, state, tuning, simulation.layout);
    sceneNight = night;
  }
  previousFoot = state.player;
  yaw = facing = INITIAL_YAW;
  walk = accumulator = elapsed = 0;
  hitAt = windWarningAt = -Infinity;
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
  $('intro-objective').textContent = `Thắp ${state.lanterns.length} đèn trong ${minutes}:${seconds}.`;
  show('intro');
}

function openMenu() {
  resetNight(firstNight);
  campaignScore = 0;
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
  for (const setting of ['volume', 'sensitivity']) {
    $(setting).value = settings[setting];
    $(`${setting}-value`).value = `${settings[setting]}%`;
  }
}

function openSettings(from) {
  settingsReturn = from;
  displaySettings();
  show('settings', 'volume');
}

function closeSettings() {
  show(settingsReturn, settingsReturn === 'pause' ? 'pause-settings' : 'menu-settings');
}

function showSummary() {
  const won = state.state === 'won';
  const lit = state.lanterns.filter(lantern => lantern.lit).length;
  if (won) campaignScore += state.score;
  $('summary-night').textContent = `Tổng kết · Đêm ${night}`;
  $('summary-title').textContent = won ? 'Đảo đã bừng sáng' : state.reason === 'no_flames' ? 'Mây đã hết lửa' : 'Đêm đã kết thúc';
  $('summary-detail').textContent = won ? 'Mây đã thắp hết những ngọn đèn trên đảo.' :
    state.reason === 'no_flames' ? 'Mây cần thêm ngọn lửa để đi tiếp.' : 'Vẫn còn đèn chưa thắp khi hết giờ.';
  $('summary-lanterns').textContent = `${lit}/${state.lanterns.length}`;
  $('summary-flames').textContent = state.player.flames;
  $('summary-score').textContent = number.format(state.score);
  $('next-night').textContent = night === 3 ? 'Đón Bình Minh' : `Sang Đêm ${night + 1}`;
  $('next-night').hidden = !won;
  $('summary-retry').hidden = won;
  audio.play(won ? 'won' : 'lost');
  show('summary');
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
$('next-night').addEventListener('click', () => {
  if (night < 3) openIntro(night + 1);
  else {
    $('dawn-score').textContent = number.format(campaignScore);
    show('dawn');
  }
});
for (const setting of ['volume', 'sensitivity']) {
  $(setting).addEventListener('input', event => {
    settings[setting] = Number(event.target.value);
    $(`${setting}-value`).value = `${settings[setting]}%`;
    if (setting === 'volume') audio.setVolume(settings.volume / 100);
    try { localStorage.setItem(SETTING_KEY, JSON.stringify(settings)); } catch { /* Keep settings for this session. */ }
  });
}

window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const { code } = event;
  if (code === 'Tab' && screen !== 'play') {
    const controls = [...panels[screen].querySelectorAll('button:not([disabled]):not([hidden]), input')];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0]).focus();
    }
    return;
  }
  if (code === 'Escape' || code === 'KeyP') {
    if (screen === 'play' || screen === 'pause') {
      event.preventDefault();
      if (!event.repeat) pauseRequested = true;
    } else if (screen === 'settings' && (code === 'Escape' || settingsReturn === 'pause')) {
      event.preventDefault();
      if (!event.repeat) closeSettings();
    }
    return;
  }
  if (screen !== 'play' || !GAME_KEYS.has(code)) return;
  if (event.target === $('pause-button') && code === 'Space') return;
  event.preventDefault();
  if (event.repeat) return;
  keys.add(code);
  if (ACTION_KEYS.has(code)) queued.add(ACTION_KEYS.get(code));
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

function nearestUnlit() {
  let target;
  let distance = Infinity;
  for (const lantern of state.lanterns) {
    if (lantern.lit) continue;
    const range = Math.hypot(lantern.x - state.player.x, lantern.z - state.player.z);
    if (range >= distance) continue;
    target = lantern;
    distance = range;
  }
  return { target, distance };
}

function cooldown(id, seconds, max, readyText = 'Sẵn sàng') {
  text(hudFields[`${id}-status`], seconds > 0 ? `${seconds.toFixed(1).replace('.', ',')} s` : readyText);
  hudFields[`${id}-cooldown`].style.setProperty('--ready', `${100 * Math.max(0, 1 - seconds / max)}%`);
}

function updateHud(nearest) {
  const { player } = state;
  const { target, distance } = nearest;
  const seconds = Math.ceil(state.time_left_s);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  text(hudFields.time, `${minutes}:${remainder}`);
  hudFields.time.dateTime = `PT${seconds}S`;
  hudFields.time.classList.toggle('urgent', seconds <= 30);
  text(hudFields.carried, `${player.carried} / ${tuning.carry_capacity}`);
  text(hudFields.flames, String(player.flames));
  flameIcons.forEach((icon, index) => icon.classList.toggle('lit', index < player.flames));
  moteSlots.forEach((slot, index) => slot.classList.toggle('filled', index < player.carried));
  text(hudFields.lit, String(state.lanterns.filter(lantern => lantern.lit).length));
  text(hudFields['lantern-total'], `/ ${state.lanterns.length}`);
  text(hudFields.score, number.format(state.score));
  cooldown('dash', player.dash_cd_s, tuning.dash_cooldown_s);
  cooldown('pulse', player.pulse_cd_s, tuning.pulse_cooldown_s,
    player.carried >= tuning.pulse_cost ? 'Sẵn sàng' : `Cần ${tuning.pulse_cost} đom đóm`);

  const windWarning = state.sim_tick < windWarningAt;
  const notice = state.wind.active ? 'Gió mạnh đang thổi' : windWarning ? 'Gió mạnh sắp đến' :
    player.charm_s > 0 ? `Bùa Gió · ${Math.ceil(player.charm_s)} s` : '';
  hudFields.notice.hidden = notice === '';
  text(hudFields.notice, notice);

  const near = target && distance <= tuning.interact_radius;
  hudFields['interact-prompt'].hidden = !near;
  if (near) text(hudFields['interact-text'], `— Nạp ánh sáng (${target.deposited}/${tuning.lantern_cost})`);
  const marker = target && scene.projectLantern(target);
  const arrow = hudFields.wayfinder;
  arrow.hidden = !marker;
  if (!marker) return;
  arrow.style.left = `${marker.x}px`;
  arrow.style.top = `${marker.y}px`;
  hudFields['wayfinder-arrow'].style.transform = `rotate(${marker.angle}rad)`;
  text(hudFields['wayfinder-distance'], `${Math.round(distance)} m`);
}

function step() {
  const inPlay = screen === 'play';
  const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const buttons = {
    jump: inPlay && readButton('jump', keys.has('Space')),
    dash: inPlay && readButton('dash', mouseDash || keys.has('ShiftLeft') || keys.has('ShiftRight')),
    interact: inPlay && readButton('interact', keys.has('KeyE')),
    pulse: inPlay && readButton('pulse', keys.has('KeyF')),
    pause: pauseRequested && !lastButtons.pause,
  };
  if (buttons.pause) pauseRequested = false;
  Object.assign(lastButtons, buttons);

  previousFoot = state.player;
  const previousSeconds = Math.ceil(state.time_left_s);
  const previousShadeCount = state.shades.length;
  const events = simulation.step({ x, z, ...buttons, cam_yaw_deg: yaw * 180 / Math.PI });
  state = simulation.snapshot();
  const { player } = state;
  const dx = player.x - previousFoot.x;
  const dz = player.z - previousFoot.z;
  walk = Number(player.grounded && Math.hypot(dx, dz) > 0.002);
  if (Math.hypot(dx, dz) > 0.002) facing = Math.atan2(-dx, -dz);

  for (const { event } of events) {
    audio.play(event);
    if (event === 'pulse') pulse = { ...player, start: elapsed };
    if (event === 'player_hit') hitAt = elapsed;
    if (event === 'wind_warning') windWarningAt = state.sim_tick + 120;
    if (event === 'paused') show('pause');
    if (event === 'resumed') show('play');
    if (event === 'game_over') showSummary();
  }
  if (state.shades.length > previousShadeCount) audio.play('shade_spawn');
  if (previousFoot.grounded && !player.grounded && player.vel[1] === 7) audio.play('jump');
  const seconds = Math.ceil(state.time_left_s);
  if (seconds !== previousSeconds && seconds > 0 && seconds <= 10) audio.play(seconds === 1 ? 'countdown_last' : 'countdown');
}

function frame(now) {
  const dt = previousFrame === undefined ? 0 : Math.max(0, Math.min(0.15, (now - previousFrame) / 1000));
  previousFrame = now;
  if (state.state !== 'paused') elapsed += dt;
  if (screen === 'play') {
    const turnRight = keys.has('KeyE') && nearestUnlit().distance > tuning.interact_radius;
    yaw = (yaw + (Number(turnRight) - Number(keys.has('KeyQ'))) * dt * 1.75) % (2 * Math.PI);
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
  scene.render(state, {
    yaw: screen === 'menu' ? yaw + Math.sin(elapsed * 0.25) * 0.12 : yaw,
    facing, foot, walk: screen === 'play' ? walk : 0,
    pulse: pulse && { ...pulse, progress: (elapsed - pulse.start) / PULSE_LENGTH },
    hit: elapsed - hitAt,
    backdrop: screen === 'menu', dawn: screen === 'dawn',
  }, elapsed);
  if (screen === 'play') updateHud(nearestUnlit());
  requestAnimationFrame(frame);
}

resetNight(firstNight);
$('begin').disabled = $('menu-settings').disabled = false;
show('menu');
requestAnimationFrame(frame);
