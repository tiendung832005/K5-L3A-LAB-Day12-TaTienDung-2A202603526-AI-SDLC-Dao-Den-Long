import { groundHeight } from './maps.js';
import { direction, distance, position, TICKS_PER_SECOND } from './player.js';
import { lowFuel, nearestLantern } from './lanterns.js';

export const SHADE_STATES = ['spawning', 'wander', 'chase', 'recoil', 'stunned', 'drain'];
export const DRIFTER_STATES = ['idle', 'chase', 'flee', 'removed'];
const EDGE_MARGIN = 1e-8;
const DRIFTER_FLEE_TICKS = 240;
const DRAIN_REACH = 2;
const DRAIN_CHASE_RADIUS = 6;

function heading(random) {
  const angle = random() * 2 * Math.PI;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

export function makeShade(spawn, id, random, stunTicks, defaultState = 'wander') {
  const state = spawn.state ?? defaultState;
  const duration = { spawning: 60, recoil: 60, stunned: stunTicks };
  return {
    id, ...position(spawn), state, timer: spawn.state_ticks_left ?? duration[state] ?? 0,
    heading: heading(random), motion: null, ejection: null,
    targetLanternId: spawn.target_lantern_id ?? null, drainTicks: 0,
  };
}

export function makeDrifter(spawn, id, random) {
  const state = spawn.state ?? 'idle';
  return {
    id, ...position(spawn), state, stolen: spawn.stolen ?? 0,
    timer: spawn.state_ticks_left ?? (state === 'flee' ? DRIFTER_FLEE_TICKS : 0),
    heading: heading(random),
  };
}

export function updateEnemyTimers(shades, drifters) {
  for (const shade of shades) if (shade.timer > 0) shade.timer--;
  for (const drifter of drifters) if (drifter.timer > 0) drifter.timer--;
}

function stepAlong(actor, vector, meters, layout) {
  actor.x += vector.x * meters;
  actor.z += vector.z * meters;
  const height = groundHeight(layout, actor.x, actor.z);
  if (Number.isFinite(height)) actor.y = height;
}

function keepWanderingOnLand(actor, meters, layout) {
  const { heading } = actor;
  if (Number.isFinite(groundHeight(layout, actor.x + heading.x * meters, actor.z + heading.z * meters))) return;
  const nearest = layout.disks.reduce((best, disk) => distance(actor, disk) < distance(actor, best) ? disk : best);
  actor.heading = direction(actor, nearest);
}

function edgeOf(lantern, from, radius) {
  const away = direction(lantern, from);
  return { x: lantern.x + away.x * (radius + EDGE_MARGIN), z: lantern.z + away.z * (radius + EDGE_MARGIN) };
}

export function updateSafeZones(shades, lit, radius) {
  for (const shade of shades) {
    if (shade.ejection && !lit.some(lantern => lantern.id === shade.ejection.lanternId)) shade.ejection = null;
    if (shade.ejection) continue;
    const lantern = lit.find(lantern => distance(shade, lantern) < radius);
    if (!lantern) continue;
    let target = edgeOf(lantern, shade, radius);
    if (lit.some(other => distance(target, other) < radius)) {
      target = { x: Math.max(...lit.map(other => other.x)) + radius + EDGE_MARGIN, z: shade.z };
    }
    shade.ejection = { ...target, lanternId: lantern.id, remaining: 30 };
  }
}

function stepOutsideSafety(shade, vector, meters, lit, radius) {
  let maxStep = meters;
  for (const lantern of lit) {
    const x = shade.x - lantern.x;
    const z = shade.z - lantern.z;
    const along = x * vector.x + z * vector.z;
    if (along >= 0) continue;
    const discriminant = along * along - (x * x + z * z - radius * radius);
    if (discriminant > 0) maxStep = Math.min(maxStep, Math.max(0, -along - Math.sqrt(discriminant) - EDGE_MARGIN));
  }
  shade.x += vector.x * maxStep;
  shade.z += vector.z * maxStep;
}

export function pushShade(shade, awayFrom, meters, ticks, state, stateTicks) {
  shade.state = state;
  shade.timer = stateTicks;
  shade.targetLanternId = null;
  shade.drainTicks = 0;
  shade.motion = { vector: direction(awayFrom, shade), speed: meters / ticks, remaining: ticks };
}

export function drainTarget(shade, lanternById, tuning) {
  const target = lanternById.get(shade.targetLanternId);
  return target && lowFuel(target, tuning) && distance(shade, target) <= DRAIN_REACH ? target : null;
}

function wander(shade, lanternById, lit, step, tuning, layout) {
  const target = nearestLantern(shade, lanternById.values(), lantern => lowFuel(lantern, tuning)) ??
    nearestLantern(shade, lanternById.values(), lantern => !lantern.lit);
  shade.targetLanternId = target?.id ?? null;
  if (target) {
    const range = distance(shade, target);
    if (!lowFuel(target, tuning) || range > DRAIN_REACH) {
      stepOutsideSafety(shade, direction(shade, target), Math.min(range, step), lit, tuning.safe_radius);
    }
    if (lowFuel(target, tuning) && distance(shade, target) <= DRAIN_REACH) shade.state = 'drain';
    return;
  }
  keepWanderingOnLand(shade, step, layout);
  stepOutsideSafety(shade, shade.heading, step, lit, tuning.safe_radius);
}

export function moveShades(shades, player, lanternById, lit, speed, tuning, layout) {
  const safeRadius = tuning.safe_radius;
  for (const shade of shades) {
    const range = distance(shade, player);
    const wasDraining = shade.state === 'drain';
    if (wasDraining) {
      const target = drainTarget(shade, lanternById, tuning);
      const chase = target && player.respawn === 0 && range <= DRAIN_CHASE_RADIUS;
      if (target && !chase && !shade.ejection) continue;
      shade.state = chase ? 'chase' : 'wander';
      shade.targetLanternId = null;
      shade.drainTicks = 0;
    }
    if (shade.ejection) {
      const target = shade.ejection;
      shade.x += (target.x - shade.x) / target.remaining;
      shade.z += (target.z - shade.z) / target.remaining;
      if (--target.remaining === 0) shade.ejection = null;
    }
    if (shade.motion) {
      const motion = shade.motion;
      if (shade.ejection) {
        shade.x += motion.vector.x * motion.speed;
        shade.z += motion.vector.z * motion.speed;
      } else {
        stepOutsideSafety(shade, motion.vector, motion.speed, lit, safeRadius);
      }
      if (--motion.remaining === 0) shade.motion = null;
      continue;
    }
    if (shade.timer > 0 || shade.ejection) continue;
    if (shade.state === 'chase') {
      if (range > 18 || player.respawn > 0) shade.state = 'wander';
    } else if (!wasDraining) {
      shade.state = range <= 12 && player.respawn === 0 ? 'chase' : 'wander';
    }
    if (shade.state === 'chase') {
      shade.targetLanternId = null;
      stepOutsideSafety(shade, direction(shade, player), Math.min(range, speed / TICKS_PER_SECOND), lit, safeRadius);
    } else if (!wasDraining) {
      wander(shade, lanternById, lit, speed / (2 * TICKS_PER_SECOND), tuning, layout);
    }
  }
}

export function fleeDrifter(drifter, player) {
  drifter.state = 'flee';
  drifter.timer = DRIFTER_FLEE_TICKS;
  drifter.heading = direction(player, drifter);
}

export function moveDrifters(drifters, player, layout) {
  for (const drifter of drifters) {
    if (drifter.state === 'flee') {
      if (drifter.timer === 0) drifter.state = 'removed';
      else stepAlong(drifter, drifter.heading, 7 / TICKS_PER_SECOND, layout);
      continue;
    }
    const range = distance(drifter, player);
    if (player.respawn === 0 && (drifter.state === 'chase' || (player.carried >= 5 && range <= 15))) {
      drifter.state = 'chase';
      stepAlong(drifter, direction(drifter, player), Math.min(range, 7 / TICKS_PER_SECOND), layout);
    } else {
      drifter.state = 'idle';
      keepWanderingOnLand(drifter, 2 / TICKS_PER_SECOND, layout);
      stepAlong(drifter, drifter.heading, 2 / TICKS_PER_SECOND, layout);
    }
  }
}
