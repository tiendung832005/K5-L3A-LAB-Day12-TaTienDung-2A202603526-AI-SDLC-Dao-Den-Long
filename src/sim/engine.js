export const TICKS_PER_SECOND = 60;
const ISLAND_RADIUS = 50;
const RANDOM_MOTE_COUNT = 20;
const RANDOM_SHADE_COUNT = 3;
const BUTTONS = ['jump', 'interact', 'pulse'];

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function onCircle(radius, angle) {
  return { x: radius * Math.cos(angle), y: 0, z: radius * Math.sin(angle) };
}

function position(source = {}) {
  const { x = 0, y = 0, z = 0 } = source.pos ?? source;
  return { x, y, z };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function direction(from, to) {
  const length = distance(from, to);
  return length === 0 ? { x: 1, z: 0 } : {
    x: (to.x - from.x) / length,
    z: (to.z - from.z) / length,
  };
}

function insideIsland(entity) {
  const length = Math.hypot(entity.x, entity.z);
  if (length > ISLAND_RADIUS) {
    entity.x = entity.x / length * ISLAND_RADIUS;
    entity.z = entity.z / length * ISLAND_RADIUS;
  }
}

export function createSimulation({ tuning, seed = 0, night = 1, scenario = {} }) {
  if (night !== 1) throw new RangeError('Only night 1 is supported');

  const random = mulberry32(seed);
  const initialPlayer = scenario.player ?? {};
  const player = {
    ...position(initialPlayer),
    carried: initialPlayer.carried ?? scenario.carried ?? 0,
    flames: initialPlayer.flames ?? scenario.flames ?? tuning.flames,
  };
  const lanternSpawns = scenario.lanterns ?? Array.from(
    { length: tuning.lantern_count_night1 },
    (_, index) => onCircle(25, index * 2 * Math.PI / tuning.lantern_count_night1),
  );
  const lanterns = lanternSpawns.map((spawn, index) => {
    const deposited = spawn.lit ? tuning.lantern_cost :
      (spawn.deposited ?? spawn.charge ?? 0);
    return {
      id: spawn.id ?? `L${index + 1}`,
      ...position(spawn),
      deposited,
      lit: spawn.lit ?? deposited >= tuning.lantern_cost,
    };
  });

  function randomMotePosition() {
    return onCircle(ISLAND_RADIUS * Math.sqrt(random()), random() * 2 * Math.PI);
  }

  const respawnMotes = scenario.random_motes !== false;
  const moteSpawns = scenario.motes ??
    Array.from({ length: respawnMotes ? RANDOM_MOTE_COUNT : 0 }, randomMotePosition);
  const shadeSpawns = scenario.shades ?? Array.from(
    { length: scenario.random_shades === false ? 0 : RANDOM_SHADE_COUNT },
    () => onCircle(ISLAND_RADIUS, random() * 2 * Math.PI),
  );
  const motes = moteSpawns.map((spawn, index) => ({
    id: spawn.id ?? `M${index + 1}`, ...position(spawn), respawns: respawnMotes,
  }));
  const shades = shadeSpawns.map((spawn, index) => ({
    id: spawn.id ?? `S${index + 1}`, ...position(spawn), stunnedUntil: 0,
  }));
  const usedMoteIds = new Set(motes.map(({ id }) => id));
  let nextMoteNumber = 1;
  const duration = tuning.night1_duration_s * TICKS_PER_SECOND;
  let tick = 0;
  let score = 0;
  let result = 'in_progress';
  let reason = null;
  let invulnerableUntil = 0;
  let pulseReadyAt = 0;
  const previousButtons = Object.fromEntries(BUTTONS.map(button => [button, false]));

  function addMote(at, respawns) {
    let id;
    do {
      id = `M${nextMoteNumber++}`;
    } while (usedMoteIds.has(id));
    usedMoteIds.add(id);
    motes.push({ id, ...at, respawns });
  }

  function movePlayer(input) {
    let x = input.x ?? 0;
    let z = input.z ?? 0;
    const scale = Math.max(1, Math.abs(x), Math.abs(z));
    x /= scale;
    z /= scale;
    const yaw = ((input.cam_yaw_deg ?? 0) % 360) * Math.PI / 180;
    const step = tuning.player_speed / TICKS_PER_SECOND / Math.max(1, Math.hypot(x, z));
    player.x += (x * Math.cos(yaw) + z * Math.sin(yaw)) * step;
    player.z += (-x * Math.sin(yaw) + z * Math.cos(yaw)) * step;
    insideIsland(player);
  }

  function pickMotes(emit) {
    let replacements = 0;
    for (let index = 0; index < motes.length && player.carried < tuning.carry_capacity;) {
      const mote = motes[index];
      if (distance(player, mote) <= tuning.pickup_radius) {
        motes.splice(index, 1);
        player.carried++;
        score += tuning.score.per_mote;
        if (mote.respawns) replacements++;
        emit('mote_picked', { mote_id: mote.id, carried: player.carried });
      } else {
        index++;
      }
    }
    for (let index = 0; index < replacements; index++) {
      addMote(randomMotePosition(), true);
    }
  }

  function deposit(emit) {
    if (player.carried === 0) return;
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
      score += tuning.score.per_lantern;
      emit('lantern_lit', { lantern_id: target.id });
    }
  }

  function pulse(emit) {
    if (player.carried < tuning.pulse_cost || tick < pulseReadyAt) return;
    player.carried -= tuning.pulse_cost;
    pulseReadyAt = tick + tuning.pulse_cooldown_s * TICKS_PER_SECOND;
    const stunned = [];
    for (const shade of shades) {
      if (distance(player, shade) > tuning.pulse_radius) continue;
      const away = direction(player, shade);
      shade.x += away.x * tuning.pulse_push_m;
      shade.z += away.z * tuning.pulse_push_m;
      shade.stunnedUntil = tick + tuning.pulse_stun_s * TICKS_PER_SECOND;
      score += tuning.score.per_stun;
      stunned.push(shade.id);
    }
    emit('pulse', { stunned, carried: player.carried });
  }

  function chase(shade, safeLanterns) {
    const step = Math.min(tuning.shade_speed / TICKS_PER_SECOND, distance(shade, player));
    const toward = direction(shade, player);
    const next = { x: shade.x + toward.x * step, z: shade.z + toward.z * step };
    const safeRadius = tuning.safe_radius;
    const isInside = at => safeLanterns.some(lantern => distance(at, lantern) <= safeRadius);
    if (isInside(next)) {
      for (const lantern of safeLanterns) {
        if (distance(next, lantern) > safeRadius) continue;
        const away = direction(lantern, next);
        next.x = lantern.x + away.x * (safeRadius + 1e-9);
        next.z = lantern.z + away.z * (safeRadius + 1e-9);
      }
      if (isInside(next)) {
        if (!isInside(shade)) return;
        // Overlapping safe areas can make the first projection land inside another lantern's area.
        next.x = Math.max(...safeLanterns.map(lantern => lantern.x)) + safeRadius + 1e-9;
      }
    }
    shade.x = next.x;
    shade.z = next.z;
  }

  function hit(shade, emit) {
    player.flames--;
    invulnerableUntil = tick + tuning.invuln_s * TICKS_PER_SECOND;
    const dropped = Math.floor(player.carried * tuning.hit_drop_ratio);
    player.carried -= dropped;
    const inward = Math.atan2(-player.z, -player.x);
    for (let index = 0; index < dropped; index++) {
      const angle = inward + (index - (dropped - 1) / 2) * Math.PI / 6;
      const at = onCircle(tuning.pickup_radius + 0.25, angle);
      at.x += player.x;
      at.z += player.z;
      insideIsland(at);
      addMote(at, false);
    }
    emit('player_hit', { shade_id: shade.id, flames: player.flames, dropped, carried: player.carried });
  }

  function step(input = {}) {
    if (reason !== null) return [];
    tick++;
    const events = [];
    const emit = (event, data) => events.push({ type: 'event', tick, event, ...data, score });
    const pressed = {};
    for (const button of BUTTONS) {
      const down = input[button] === true;
      pressed[button] = down && !previousButtons[button];
      previousButtons[button] = down;
    }

    movePlayer(input);
    pickMotes(emit);
    if (pressed.interact) deposit(emit);
    if (pressed.pulse) pulse(emit);

    const safeLanterns = lanterns.filter(lantern => lantern.lit);
    for (const shade of shades) {
      if (tick < shade.stunnedUntil) continue;
      chase(shade, safeLanterns);
      if (player.flames > 0 && tick >= invulnerableUntil &&
          distance(player, shade) <= tuning.shade_hit_radius) hit(shade, emit);
    }

    if (lanterns.length > 0 && safeLanterns.length === lanterns.length) {
      reason = 'all_lit';
      result = 'win';
      score += Math.floor(Math.max(0, duration - tick) / TICKS_PER_SECOND) * tuning.score.per_second_left;
      score += player.flames * tuning.score.per_flame_left;
    } else if (player.flames === 0 || tick >= duration) {
      reason = player.flames === 0 ? 'no_flames' : 'dawn';
      result = 'lose';
    }
    if (reason !== null) emit('game_over', { result, reason });
    return events;
  }

  function snapshot() {
    return {
      type: 'snapshot', tick, night, score, result, reason,
      time_left_s: Math.max(0, duration - tick) / TICKS_PER_SECOND,
      player: { ...player },
      lanterns: lanterns.map(lantern => ({ ...lantern })),
      motes: motes.map(({ id, x, y, z }) => ({ id, x, y, z })),
      shades: shades.map(({ id, x, y, z, stunnedUntil }) => ({
        id, x, y, z, stunned: tick < stunnedUntil,
      })),
    };
  }

  function end() {
    return { type: 'end', tick, result, reason, score };
  }

  return { step, snapshot, end, get finished() { return reason !== null; } };
}
