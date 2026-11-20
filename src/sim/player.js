import { groundHeight } from './maps.js';

export const TICKS_PER_SECOND = 60;
const DT = 1 / TICKS_PER_SECOND;
const JUMP_SPEED = 7;
const GRAVITY = 20;
const MAX_STEP_HEIGHT = 0.4;
const FALL_HEIGHT = -10;
const CHARM_SPEED = 7.2;

export function position(source = {}, fallback = {}) {
  const at = source.pos ?? source;
  if (Array.isArray(at)) return { x: at[0], y: at[1], z: at[2] };
  return { x: at.x ?? fallback.x ?? 0, y: at.y ?? fallback.y ?? 0, z: at.z ?? fallback.z ?? 0 };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function direction(from, to) {
  const length = distance(from, to);
  return length === 0 ? { x: 1, z: 0 } : {
    x: (to.x - from.x) / length, z: (to.z - from.z) / length,
  };
}

export function makePlayer(layout, tuning, scenario) {
  const initial = scenario.player ?? {};
  const at = position(initial, layout.spawn);
  const face = (initial.facing_yaw_deg ?? 0) * Math.PI / 180;
  return {
    ...at, vel: position(initial.vel), facing: { x: Math.sin(face), z: Math.cos(face) },
    grounded: initial.grounded ?? at.y === groundHeight(layout, at.x, at.z, at.y),
    carried: initial.carried ?? scenario.carried ?? 0,
    flames: initial.flames ?? scenario.flames ?? tuning.flames,
    invuln: initial.invuln_ticks ?? 0,
    dashCd: initial.dash_cd_ticks ?? 0,
    pulseCd: initial.pulse_cd_ticks ?? 0,
    charm: initial.charm_ticks ?? 0,
    dash: null, launch: null, respawn: 0, onPad: null,
  };
}

function movement(input) {
  let x = input.x ?? 0;
  let z = input.z ?? 0;
  const scale = Math.max(1, Math.abs(x), Math.abs(z));
  x /= scale;
  z /= scale;
  const length = Math.max(1, Math.hypot(x, z));
  const yaw = ((input.cam_yaw_deg ?? 0) % 360) * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: (x * cos + z * sin) / length, z: (-x * sin + z * cos) / length };
}

function accelerate(vel, targetX, targetZ, maxDelta) {
  const dx = targetX - vel.x;
  const dz = targetZ - vel.z;
  const delta = Math.hypot(dx, dz);
  const ratio = delta === 0 ? 1 : Math.min(1, maxDelta / delta);
  vel.x += dx * ratio;
  vel.z += dz * ratio;
}

function fall(player, tuning, emit) {
  const lost = player.carried;
  player.carried = 0;
  player.flames--;
  player.respawn = player.flames > 0 ? TICKS_PER_SECOND : 0;
  player.grounded = false;
  player.dash = player.launch = player.onPad = null;
  player.vel = { x: 0, y: 0, z: 0 };
  emit('player_hit', { by: 'fall', lost, carried: 0, flames: player.flames });
}

export function tickPlayerTimers(player, layout, tuning, emit) {
  for (const key of ['invuln', 'dashCd', 'pulseCd', 'charm']) {
    if (player[key] > 0) player[key]--;
  }
  if (player.respawn > 0 && --player.respawn === 0) {
    Object.assign(player, layout.spawn);
    player.grounded = true;
    player.invuln = tuning.invuln_s * TICKS_PER_SECOND;
    emit('player_respawned', {});
    return true;
  }
  return false;
}

export function movePlayer(player, input, pressed, layout, tuning, wind, emit) {
  if (player.y < FALL_HEIGHT && tuning.fall_enabled) {
    fall(player, tuning, emit);
    return;
  }
  const wish = movement(input);
  const speed = player.charm > 0 ? CHARM_SPEED : tuning.player_speed;
  const { vel } = player;
  if (player.dash?.remaining === 0) {
    vel.x = player.dash.x * speed;
    vel.z = player.dash.z * speed;
    player.dash = null;
  }
  if (wish.x || wish.z) player.facing = direction({ x: 0, z: 0 }, wish);
  if (pressed.dash && player.dashCd === 0 && !player.dash) {
    player.dash = { ...player.facing, remaining: tuning.dash_duration_s * TICKS_PER_SECOND };
    player.dashCd = player.charm > 0 ? 0 : tuning.dash_cooldown_s * TICKS_PER_SECOND;
    emit('dash', {});
  }

  const dash = player.dash;
  if (dash) {
    vel.x = dash.x * tuning.dash_speed;
    vel.z = dash.z * tuning.dash_speed;
  } else if (player.launch) {
    vel.x = player.launch.vx;
    vel.z = player.launch.vz;
  } else {
    accelerate(vel, wish.x * speed, wish.z * speed, speed / 6);
  }

  const x = player.x + (vel.x + (dash ? 0 : wind.x)) * DT;
  const z = player.z + (vel.z + (dash ? 0 : wind.z)) * DT;
  const oldHeight = groundHeight(layout, player.x, player.z);
  const nextHeight = groundHeight(layout, x, z);
  const canStepUp = !dash && player.grounded && nextHeight - player.y <= MAX_STEP_HEIGHT;
  const tower = layout.tower;
  const blockedByTower = tower && player.y >= tower.y && Math.hypot(x - tower.x, z - tower.z) < tower.radius;
  const blockedByLedge = nextHeight > player.y && nextHeight > oldHeight && !canStepUp;
  if (!blockedByTower && !blockedByLedge && (tuning.fall_enabled || Number.isFinite(nextHeight))) {
    player.x = x;
    player.z = z;
  }
  const stepHeight = player.grounded && !dash ? MAX_STEP_HEIGHT : 0;
  const height = groundHeight(layout, player.x, player.z, player.y + stepHeight);
  if (dash) {
    player.grounded = player.y === height;
    dash.remaining--;
    return;
  }

  if (player.grounded && player.y - height > MAX_STEP_HEIGHT) player.grounded = false;
  const pad = layout.pads.find(pad => distance(player, pad) <= pad.radius && Math.abs(player.y - pad.y) < 0.4);
  if (!pad) player.onPad = null;
  if (player.grounded && pad && player.onPad !== pad.id) {
    player.launch = pad;
    player.onPad = pad.id;
    player.grounded = false;
    vel.x = pad.vx;
    vel.y = pad.vy;
    vel.z = pad.vz;
    emit('launch_pad', { pad_id: pad.id });
  } else if (player.grounded && pressed.jump) {
    player.grounded = false;
    vel.y = JUMP_SPEED;
  } else if (!player.grounded) {
    vel.y -= GRAVITY * DT;
  }

  if (player.grounded || (vel.y < 0 && player.y >= height && player.y + vel.y * DT <= height)) {
    player.y = height;
    player.grounded = true;
    vel.y = 0;
    player.launch = null;
  } else {
    player.y += vel.y * DT;
  }
  if (player.y < FALL_HEIGHT && tuning.fall_enabled) fall(player, tuning, emit);
}
