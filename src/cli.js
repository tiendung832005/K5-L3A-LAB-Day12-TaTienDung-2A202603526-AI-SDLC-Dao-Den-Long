import { createWriteStream, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { BUTTONS, createSimulation, TICKS_PER_SECOND } from './sim/engine.js';
import { DRIFTER_STATES, SHADE_STATES } from './sim/enemies.js';
import { lanternCost, playerCapacity } from './sim/lanterns.js';

const contract = JSON.parse(readFileSync(new URL('../game.contract.json', import.meta.url), 'utf8'));
const { tuning } = contract;

function integerOption(value, name, min, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function optionalNumber(object, key, name) {
  if (Object.hasOwn(object, key) && !Number.isFinite(object[key])) {
    throw new Error(`${name}.${key} must be a finite number`);
  }
}

function optionalBoolean(object, key, name) {
  if (Object.hasOwn(object, key) && typeof object[key] !== 'boolean') {
    throw new Error(`${name}.${key} must be a boolean`);
  }
}

function optionalCount(object, key, name, max) {
  if (!Object.hasOwn(object, key)) return;
  const value = object[key];
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${name}.${key} must be an integer from 0 to ${max}`);
  }
}

function validatePosition(entity, name) {
  requireObject(entity, name);
  if (Object.hasOwn(entity, 'pos')) validateVector(entity.pos, `${name}.pos`);
  else for (const axis of ['x', 'y', 'z']) optionalNumber(entity, axis, name);
}

function validateVector(value, name) {
  if (Array.isArray(value)) {
    if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${name} must contain three finite numbers`);
    return;
  }
  requireObject(value, name);
  for (const axis of ['x', 'y', 'z']) optionalNumber(value, axis, name);
}

function optionalEnum(object, key, name, values) {
  if (Object.hasOwn(object, key) && !values.includes(object[key])) {
    throw new Error(`${name}.${key} must be one of ${values.join(', ')}`);
  }
}

function validateScenario(scenario) {
  requireObject(scenario, 'scenario');
  for (const field of ['random_motes', 'random_shades', 'random_drifters', 'wind_enabled']) {
    optionalBoolean(scenario, field, 'scenario');
  }
  optionalCount(scenario, 'flames', 'scenario', tuning.flames);
  if (Object.hasOwn(scenario, 'player')) {
    const { player } = scenario;
    const name = 'scenario.player';
    validatePosition(player, name);
    optionalCount(player, 'successful_lights', name, Number.MAX_SAFE_INTEGER);
    optionalCount(player, 'carried', name, playerCapacity(player.successful_lights ?? 0, tuning));
    optionalCount(player, 'flames', name, tuning.flames);
    optionalBoolean(player, 'grounded', name);
    optionalNumber(player, 'facing_yaw_deg', name);
    if (Object.hasOwn(player, 'vel')) validateVector(player.vel, `${name}.vel`);
    for (const field of ['invuln_ticks', 'dash_cd_ticks', 'pulse_cd_ticks', 'charm_ticks']) {
      optionalCount(player, field, name, Number.MAX_SAFE_INTEGER);
    }
  }
  optionalCount(scenario, 'carried', 'scenario', playerCapacity(scenario.player?.successful_lights ?? 0, tuning));

  for (const [key, prefix] of [['lanterns', 'L'], ['motes', 'M'], ['shades', 'S'], ['drifters', 'D'], ['charms', 'C']]) {
    if (!Object.hasOwn(scenario, key)) continue;
    const entities = scenario[key];
    if (!Array.isArray(entities)) throw new Error(`scenario.${key} must be an array`);
    const ids = new Set();
    for (const [index, entity] of entities.entries()) {
      const name = `scenario.${key}[${index}]`;
      validatePosition(entity, name);
      const id = Object.hasOwn(entity, 'id') ? entity.id : `${prefix}${index + 1}`;
      if (typeof id !== 'string' || id.length === 0 || ids.has(id)) {
        throw new Error(`${name}.id must be a unique non-empty string`);
      }
      ids.add(id);
      if (key === 'lanterns') {
        optionalBoolean(entity, 'lit', name);
        optionalBoolean(entity, 'ever_lit', name);
        optionalNumber(entity, 'fuel', name);
        if (entity.fuel < 0 || entity.fuel > tuning.fuel_max) throw new Error(`${name}.fuel must be from 0 to ${tuning.fuel_max}`);
        optionalCount(entity, 'deposited', name, tuning.lantern_cost);
        optionalCount(entity, 'charge', name, tuning.lantern_cost);
        if (entity.lit === false && (entity.deposited ?? entity.charge) >= lanternCost(entity, tuning)) {
          throw new Error(`${name} cannot have a full deposit while unlit`);
        }
      }
      if (key === 'motes') {
        optionalEnum(entity, 'kind', name, ['random', 'dropped']);
        optionalCount(entity, 'ttl_ticks', name, Number.MAX_SAFE_INTEGER);
      }
      if (key === 'shades' || key === 'drifters') {
        optionalEnum(entity, 'state', name, key === 'shades' ? SHADE_STATES : DRIFTER_STATES);
        optionalCount(entity, 'state_ticks_left', name, Number.MAX_SAFE_INTEGER);
      }
      if (key === 'shades' && entity.target_lantern_id != null && (typeof entity.target_lantern_id !== 'string' || !entity.target_lantern_id)) {
        throw new Error(`${name}.target_lantern_id must be a non-empty string or null`);
      }
      if (key === 'drifters') optionalCount(entity, 'stolen', name, 3);
      if (key === 'charms') {
        optionalBoolean(entity, 'available', name);
        optionalCount(entity, 'respawn_ticks', name, Number.MAX_SAFE_INTEGER);
      }
    }
  }
  return scenario;
}

function validateFrames(input) {
  const frames = Array.isArray(input) ? input : input?.frames;
  if (!Array.isArray(frames)) throw new Error('inputs must contain an array of frames');
  let previousTick = -1;
  return frames.map((frame, index) => {
    const name = `inputs.frames[${index}]`;
    requireObject(frame, name);
    const { tick } = frame;
    if (!Number.isSafeInteger(tick) || tick <= previousTick) {
      throw new Error(`${name}.tick must be a non-negative integer in strictly increasing order`);
    }
    previousTick = tick;
    const input = {};
    for (const key of BUTTONS) {
      optionalBoolean(frame, key, name);
      if (Object.hasOwn(frame, key)) input[key] = frame[key];
    }
    if (Object.hasOwn(frame, 'move')) requireObject(frame.move, `${name}.move`);
    const move = frame.move ?? {};
    for (const axis of ['x', 'z']) {
      optionalNumber(move, axis, `${name}.move`);
      optionalNumber(frame, axis, name);
      optionalNumber(frame, `move_${axis}`, name);
      const value = frame[axis] ?? frame[`move_${axis}`] ?? move[axis];
      if (value !== undefined) input[axis] = value;
    }
    optionalNumber(frame, 'cam_yaw_deg', name);
    if (Object.hasOwn(frame, 'cam_yaw_deg')) input.cam_yaw_deg = frame.cam_yaw_deg;
    return { tick, input };
  });
}

function* simulate(simulation, frames, ticks, snapshotEvery) {
  const input = {};
  let frameIndex = 0;
  yield simulation.snapshot();
  for (let k = 0; k < ticks && !simulation.finished; k++) {
    if (frames[frameIndex]?.tick === k) {
      Object.assign(input, frames[frameIndex].input);
      frameIndex++;
    }
    yield* simulation.step(input);
    if ((k + 1) % snapshotEvery === 0) yield simulation.snapshot();
  }
  yield simulation.end();
}

function jsonl(record) {
  return JSON.stringify(record, (key, value) => {
    if ((key === 'pos' || key === 'vel') && Array.isArray(value)) return value.map(round);
    if (key !== 'x' && key !== 'y' && key !== 'z') return value;
    return round(value);
  }) + '\n';
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function main() {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: '0' },
      night: { type: 'string', default: '1' },
      scenario: { type: 'string' },
      inputs: { type: 'string' },
      ticks: { type: 'string' },
      out: { type: 'string' },
      'snapshot-every': { type: 'string', default: '10' },
    },
  });
  const seed = integerOption(values.seed, '--seed', Number.MIN_SAFE_INTEGER);
  const night = integerOption(values.night, '--night', 1, 3);
  const ticks = values.ticks === undefined
    ? tuning[`night${night}_duration_s`] * TICKS_PER_SECOND
    : integerOption(values.ticks, '--ticks', 0);
  const snapshotEvery = integerOption(values['snapshot-every'], '--snapshot-every', 1);
  const scenario = values.scenario === undefined ? {} : validateScenario(readJson(values.scenario));
  const frames = values.inputs === undefined ? [] : validateFrames(readJson(values.inputs));
  const simulation = createSimulation({ tuning, seed, night, scenario });
  const lines = Readable.from(simulate(simulation, frames, ticks, snapshotEvery)).map(jsonl);
  const output = values.out === undefined || values.out === '-' ? process.stdout : createWriteStream(values.out);
  await pipeline(lines, output);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
