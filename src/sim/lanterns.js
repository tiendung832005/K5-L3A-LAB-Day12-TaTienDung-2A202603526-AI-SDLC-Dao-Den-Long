import { distance, position, TICKS_PER_SECOND } from './player.js';

export const FUEL_SCALE = TICKS_PER_SECOND;

export function byId(a, b) {
  const first = /^(.*?)(\d+)$/.exec(a.id);
  const second = /^(.*?)(\d+)$/.exec(b.id);
  if (first && second && first[1] === second[1]) {
    const delta = Number(first[2]) - Number(second[2]);
    if (delta) return delta;
  }
  return a.id < b.id ? -1 : Number(a.id > b.id);
}

export function nearestLantern(origin, lanterns, eligible, radius = Infinity) {
  let target;
  let nearest = radius;
  for (const lantern of lanterns) {
    if (!eligible(lantern)) continue;
    const range = distance(origin, lantern);
    if (range > nearest || (range === nearest && target && byId(lantern, target) >= 0)) continue;
    target = lantern;
    nearest = range;
  }
  return target;
}

export function lanternCost(lantern, tuning) {
  return lantern.ever_lit ? tuning.relight_cost : tuning.lantern_cost;
}

export function makeLantern(spawn, id, tuning) {
  const deposited = spawn.deposited ?? spawn.charge ?? 0;
  const lit = spawn.lit ?? deposited >= lanternCost(spawn, tuning);
  return {
    id, ...position(spawn), lit,
    deposited: lit ? (spawn.ever_lit ? tuning.relight_cost : tuning.lantern_cost) : deposited,
    fuel_ticks: lit ? Math.round((spawn.fuel ?? tuning.fuel_max) * FUEL_SCALE) : 0,
    ever_lit: lit || spawn.ever_lit === true,
    relit_count: 0,
  };
}

export function fuelValue(ticks) {
  return Math.round(ticks * 10 / FUEL_SCALE) / 10;
}

export function lowFuel(lantern, tuning) {
  return lantern.lit && lantern.fuel_ticks < tuning.low_fuel_threshold * FUEL_SCALE;
}

export function playerCapacity(successfulLights, tuning) {
  return Math.min(tuning.capacity_max, tuning.carry_capacity + 2 * successfulLights);
}
