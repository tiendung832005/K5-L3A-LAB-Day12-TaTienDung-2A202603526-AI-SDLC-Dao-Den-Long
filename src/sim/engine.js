import { createLayout, groundHeight } from './maps.js';
import { direction, distance, makePlayer, movePlayer, position, tickPlayerTimers, TICKS_PER_SECOND } from './player.js';
import {
  byId, fleeDrifter, makeDrifter, makeShade, moveDrifters, moveShades, pushShade, updateEnemyTimers, updateSafeZones,
} from './enemies.js';

export { TICKS_PER_SECOND } from './player.js';
export const BUTTONS = ['pause', 'jump', 'dash', 'interact', 'pulse'];
const NIGHTS = {
  1: { firstShade: 300, shadeInterval: 480, maxShades: 6 },
  2: { firstShade: 420, shadeInterval: 420, maxShades: 8 },
  3: { firstShade: 360, shadeInterval: 360, maxShades: 10 },
};
const CHARM_TICKS = 600;
const CHARM_RESPAWN_TICKS = 2700;
const DROPPED_TTL = 480;
const HEIGHT_REACH = 1.5;
const MAX_MOTES = 30;

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function ids(prefix, entities) {
  const used = new Set(entities.map(entity => entity.id));
  let next = 1;
  return () => {
    let id;
    do { id = `${prefix}${next++}`; } while (used.has(id));
    return id;
  };
}

function xyz({ x, y, z }) {
  return [x, y, z];
}

export function createSimulation({ tuning, seed = 0, night = 1, scenario = {} }) {
  const layout = createLayout(night);
  const rules = NIGHTS[night];
  const random = mulberry32(seed);
  const player = makePlayer(layout, tuning, scenario);
  const duration = Math.round(tuning[`night${night}_duration_s`] * TICKS_PER_SECOND);
  const stunTicks = tuning.pulse_stun_s * TICKS_PER_SECOND;
  const lanterns = (scenario.lanterns ?? layout.lanterns).map((spawn, index) => {
    const deposited = spawn.lit ? tuning.lantern_cost : (spawn.deposited ?? spawn.charge ?? 0);
    return { id: spawn.id ?? `L${index + 1}`, ...position(spawn), deposited, lit: spawn.lit ?? deposited >= tuning.lantern_cost };
  });
  const lit = lanterns.filter(lantern => lantern.lit);
  const motes = (scenario.motes ?? []).map((spawn, index) => {
    const kind = spawn.kind ?? (spawn.ttl_ticks != null ? 'dropped' : 'random');
    return { id: spawn.id ?? `M${index + 1}`, ...position(spawn), kind, ttl: kind === 'dropped' ? (spawn.ttl_ticks ?? DROPPED_TTL) : null };
  });
  const shades = (scenario.shades ?? []).map((spawn, index) =>
    makeShade(spawn, spawn.id ?? `S${index + 1}`, random, stunTicks)).sort(byId);
  const drifters = (scenario.drifters ?? []).map((spawn, index) =>
    makeDrifter(spawn, spawn.id ?? `D${index + 1}`, random)).filter(drifter => drifter.state !== 'removed').sort(byId);
  const charms = (scenario.charms ?? layout.charms).map((spawn, index) => {
    const id = spawn.id ?? `C${index + 1}`;
    const timer = spawn.respawn_ticks ?? (spawn.available === false ? CHARM_RESPAWN_TICKS : 0);
    return { id, ...position(spawn, layout.charms.find(charm => charm.id === id)), timer };
  });
  const nextMoteId = ids('M', motes);
  const nextShadeId = ids('S', shades);
  const nextDrifterId = ids('D', drifters);
  const previousButtons = Object.fromEntries(BUTTONS.map(button => [button, false]));
  const buttons = {};
  const wind = { active: false, dir_deg: 0 };
  const windVelocity = { x: 0, z: 0 };
  let tick = 0;
  let simTick = 0;
  let score = 0;
  let state = 'playing';
  let reason = null;

  function randomPoint(points) {
    return points.length ? points[Math.floor(random() * points.length)] : undefined;
  }

  function addMote(at, kind) {
    motes.push({ id: nextMoteId(), ...position(at), kind, ttl: kind === 'dropped' ? DROPPED_TTL : null });
  }

  function spawnMote() {
    const free = layout.moteSpawns.filter(point => !motes.some(mote => mote.kind === 'random' && distance(point, mote) < 1e-8));
    addMote(randomPoint(free.length ? free : layout.moteSpawns), 'random');
  }

  if (scenario.motes === undefined && scenario.random_motes !== false) {
    for (let i = 0; i < 20; i++) spawnMote();
  }

  function dropMotes(origin, count) {
    for (let i = 0; i < count; i++) {
      const angle = random() * 2 * Math.PI;
      const radius = 1.5 + random();
      let at;
      for (let offset = 0; offset < 8; offset++) {
        const theta = angle + offset * Math.PI / 4;
        const x = origin.x + Math.cos(theta) * radius;
        const z = origin.z + Math.sin(theta) * radius;
        const y = groundHeight(layout, x, z);
        at = { x, y: Number.isFinite(y) ? y : origin.y, z };
        if (Number.isFinite(y)) break;
      }
      addMote(at, 'dropped');
    }
  }

  function updateWorldTimers(emit) {
    updateEnemyTimers(shades, drifters);
    for (const charm of charms) if (charm.timer > 0) charm.timer--;
    for (let i = motes.length - 1; i >= 0; i--) {
      const mote = motes[i];
      if (mote.ttl !== null && --mote.ttl <= 0) motes.splice(i, 1);
    }
    if (night !== 3 || scenario.wind_enabled === false) return;
    const cycle = simTick % 1800;
    if (cycle === 1680) {
      wind.dir_deg = random() * 360;
      emit('wind_warning', { dir_deg: wind.dir_deg });
    }
    wind.active = simTick >= 1800 && cycle < 300;
    const angle = wind.dir_deg * Math.PI / 180;
    windVelocity.x = wind.active ? Math.cos(angle) * 2 : 0;
    windVelocity.z = wind.active ? Math.sin(angle) * 2 : 0;
  }

  function pickItems(emit) {
    for (let i = 0; i < motes.length && player.carried < tuning.carry_capacity;) {
      const mote = motes[i];
      if (distance(player, mote) <= tuning.pickup_radius && Math.abs(player.y - mote.y) <= HEIGHT_REACH) {
        motes.splice(i, 1);
        player.carried++;
        score += tuning.score.per_mote;
        emit('mote_picked', { mote_id: mote.id, carried: player.carried });
      } else i++;
    }
    for (const charm of charms) {
      if (charm.timer > 0 || distance(player, charm) > tuning.pickup_radius || Math.abs(player.y - charm.y) > HEIGHT_REACH) continue;
      charm.timer = CHARM_RESPAWN_TICKS;
      player.charm = CHARM_TICKS;
      player.dashCd = 0;
      emit('charm_picked', { charm_id: charm.id, charm_ticks: CHARM_TICKS });
    }
  }

  function deposit(emit) {
    if (!player.carried) return;
    let target;
    let nearest = Infinity;
    for (const lantern of lanterns) {
      const range = distance(player, lantern);
      if (!lantern.lit && range <= tuning.interact_radius && range < nearest) {
        target = lantern;
        nearest = range;
      }
    }
    if (!target) return;
    const amount = Math.min(player.carried, tuning.lantern_cost - target.deposited);
    player.carried -= amount;
    target.deposited += amount;
    emit('deposit', { lantern_id: target.id, amount, deposited: target.deposited, carried: player.carried });
    if (target.deposited === tuning.lantern_cost) {
      target.lit = true;
      lit.push(target);
      score += tuning.score.per_lantern;
      emit('lantern_lit', { lantern_id: target.id });
    }
  }

  function pulse(emit) {
    if (player.carried < tuning.pulse_cost || player.pulseCd > 0) return;
    player.carried -= tuning.pulse_cost;
    player.pulseCd = tuning.pulse_cooldown_s * TICKS_PER_SECOND;
    const inRange = actor => Math.hypot(actor.x - player.x, actor.y - player.y - 0.8, actor.z - player.z) <= tuning.pulse_radius;
    const stunned = [];
    const hitDrifters = [];
    for (const shade of shades) {
      if (!inRange(shade)) continue;
      pushShade(shade, player, tuning.pulse_push_m, 15, 'stunned', stunTicks);
      score += tuning.score.per_stun;
      stunned.push(shade.id);
    }
    for (const drifter of drifters) {
      if (!inRange(drifter)) continue;
      if (drifter.state !== 'flee') fleeDrifter(drifter, player);
      hitDrifters.push(drifter.id);
    }
    emit('pulse', { stunned, drifters: hitDrifters, carried: player.carried });
    for (const drifter of drifters) {
      if (!drifter.stolen || !hitDrifters.includes(drifter.id)) continue;
      dropMotes(drifter, drifter.stolen);
      emit('drifter_drop', { drifter_id: drifter.id, amount: drifter.stolen });
      drifter.stolen = 0;
    }
  }

  function resolveCollisions(emit) {
    for (const drifter of drifters) {
      if (drifter.state === 'flee' || distance(player, drifter) > 1.2) continue;
      const amount = Math.min(3, player.carried);
      if (amount === 0) continue;
      player.carried -= amount;
      drifter.stolen += amount;
      fleeDrifter(drifter, player);
      emit('drifter_steal', { drifter_id: drifter.id, amount, carried: player.carried });
    }
    if (player.invuln > 0 || player.flames <= 0) return;
    for (const shade of shades) {
      if (shade.ejection || (shade.state !== 'chase' && shade.state !== 'wander')) continue;
      if (distance(player, shade) > tuning.shade_hit_radius || Math.abs(player.y - shade.y) > HEIGHT_REACH) continue;
      player.flames--;
      player.invuln = tuning.invuln_s * TICKS_PER_SECOND;
      const dropped = Math.floor(player.carried * tuning.hit_drop_ratio);
      player.carried -= dropped;
      dropMotes(player, dropped);
      pushShade(shade, player, 2, 60, 'recoil', 60);
      emit('player_hit', { by: 'shade', shade_id: shade.id, flames: player.flames, dropped, carried: player.carried });
      break;
    }
  }

  function spawnPeriodic() {
    if (scenario.random_motes !== false && simTick % 240 === 0 && motes.length < MAX_MOTES) spawnMote();
    if (scenario.random_shades !== false && simTick >= rules.firstShade && (simTick - rules.firstShade) % rules.shadeInterval === 0) {
      const candidates = night === 1 ? layout.shadeSpawns.filter(point => distance(point, player) >= 15) : layout.shadeSpawns;
      const count = night === 1 && simTick === rules.firstShade ? 2 : 1;
      const pool = [...candidates];
      for (let i = 0; i < count && shades.length < rules.maxShades && pool.length; i++) {
        const [at] = pool.splice(Math.floor(random() * pool.length), 1);
        shades.push(makeShade(at, nextShadeId(), random, stunTicks, 'spawning'));
      }
      shades.sort(byId);
    }
    if (night >= 2 && scenario.random_drifters !== false && simTick % 1200 === 0 && drifters.length < 2) {
      drifters.push(makeDrifter(randomPoint(layout.shadeSpawns), nextDrifterId(), random));
      drifters.sort(byId);
    }
  }

  function checkEnding(emit) {
    if (player.flames === 0) {
      reason = 'no_flames';
      state = 'lost';
    } else if (lanterns.length > 0 && lit.length === lanterns.length) {
      reason = 'all_lit';
      state = 'won';
      score += Math.floor(timeLeft()) * tuning.score.per_second_left + player.flames * tuning.score.per_flame_left;
    } else if (simTick >= duration) {
      reason = 'dawn';
      state = 'lost';
    }
    if (reason) emit('game_over', { result: state, reason });
  }

  function timeLeft() {
    return Math.max(0, duration - simTick) / TICKS_PER_SECOND;
  }

  function step(input = {}) {
    if (reason !== null) return [];
    tick++;
    const events = [];
    const emit = (event, data) => events.push({ type: 'event', tick, event, ...data, score });
    for (const button of BUTTONS) {
      const down = input[button] === true;
      buttons[button] = down && !previousButtons[button];
      previousButtons[button] = down;
    }
    if (buttons.pause) {
      state = state === 'paused' ? 'playing' : 'paused';
      emit(state === 'paused' ? 'paused' : 'resumed', {});
    }
    if (state === 'paused') return events;

    simTick++;
    if (simTick === 1) emit('night_start', { night });
    const justRespawned = tickPlayerTimers(player, layout, tuning, emit);
    updateWorldTimers(emit);
    if (!justRespawned && player.respawn === 0 && player.flames > 0) movePlayer(player, input, buttons, layout, tuning, windVelocity, emit);
    const activePlayer = player.respawn === 0 && player.flames > 0 && !justRespawned;
    if (activePlayer) pickItems(emit);
    if (activePlayer && buttons.interact) deposit(emit);
    updateSafeZones(shades, lit, tuning.safe_radius);
    if (activePlayer && buttons.pulse) pulse(emit);
    moveShades(shades, player, lit, night === 3 ? tuning.shade_speed_night3 : tuning.shade_speed, tuning.safe_radius, layout);
    moveDrifters(drifters, player, layout);
    for (let i = drifters.length - 1; i >= 0; i--) if (drifters[i].state === 'removed') drifters.splice(i, 1);
    if (activePlayer) resolveCollisions(emit);
    spawnPeriodic();
    checkEnding(emit);
    return events;
  }

  function snapshot() {
    return {
      type: 'snapshot', tick, sim_tick: simTick, night, state, score, result: reason ? state : 'in_progress', reason,
      time_left_s: timeLeft(), wind: { ...wind },
      player: {
        ...position(player), carried: player.carried, flames: player.flames, vel: xyz(player.vel),
        grounded: player.grounded, invuln: player.invuln > 0, dash_cd_s: player.dashCd / TICKS_PER_SECOND,
        pulse_cd_s: player.pulseCd / TICKS_PER_SECOND, charm_s: player.charm / TICKS_PER_SECOND,
      },
      lanterns: lanterns.map(lantern => ({ ...lantern })),
      motes: motes.map(mote => ({ id: mote.id, pos: xyz(mote), kind: mote.kind, ttl_s: mote.ttl === null ? null : mote.ttl / TICKS_PER_SECOND })),
      shades: shades.map(shade => ({ id: shade.id, ...position(shade), state: shade.state, state_ticks_left: shade.timer, stunned: shade.state === 'stunned' })),
      drifters: drifters.map(drifter => ({ id: drifter.id, pos: xyz(drifter), state: drifter.state, stolen: drifter.stolen })),
      charms: charms.map(charm => ({ id: charm.id, available: charm.timer === 0, respawn_s: charm.timer / TICKS_PER_SECOND })),
    };
  }

  function end() {
    return { type: 'end', tick, sim_tick: simTick, state, result: reason ? state : 'in_progress', reason, score };
  }

  return { step, snapshot, end, layout, get finished() { return reason !== null; } };
}
