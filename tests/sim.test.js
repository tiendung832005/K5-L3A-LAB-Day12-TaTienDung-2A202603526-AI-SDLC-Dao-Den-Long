import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSimulation } from '../src/sim/engine.js';
import { createLayout, groundHeight } from '../src/sim/maps.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const contract = JSON.parse(readFileSync(new URL('../game.contract.json', import.meta.url), 'utf8'));
const fixed = { random_motes: false, random_shades: false, random_drifters: false };
const nearly = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function fixtures(t) {
  const directory = mkdtempSync(join(tmpdir(), 'lantern-island-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    path: name => join(directory, name),
    json(name, value) {
      const path = join(directory, name);
      writeFileSync(path, JSON.stringify(value));
      return path;
    },
  };
}

function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  return result;
}

function parse(output) {
  return output.trimEnd().split('\n').map(line => JSON.parse(line));
}

function scenarioRun(t, scenario, frames, ticks, night = 1) {
  const files = fixtures(t);
  const result = run('--night', String(night), '--scenario', files.json('scenario.json', { ...fixed, ...scenario }),
    '--inputs', files.json('inputs.json', { frames }), '--ticks', String(ticks), '--snapshot-every', '1');
  assert.equal(result.status, 0, result.stderr);
  const records = parse(result.stdout);
  return {
    events: records.filter(record => record.type === 'event'),
    snapshots: records.filter(record => record.type === 'snapshot'),
    end: records.at(-1),
  };
}

function game(scenario = {}, night = 1) {
  return createSimulation({ tuning: contract.tuning, night, scenario: { ...fixed, ...scenario } });
}

function advance(simulation, count, input) {
  const events = [];
  for (let index = 0; index < count; index++) events.push(...simulation.step(input));
  return events;
}

test('v1.1 declares exact configuration and night map coordinates', () => {
  assert.equal(contract.contract_version, '1.1');
  assert.deepEqual([contract.tuning.night1_duration_s, contract.tuning.night2_duration_s, contract.tuning.night3_duration_s], [300, 330, 360]);
  const [first, second, third] = [1, 2, 3].map(createLayout);
  assert.deepEqual([first, second, third].map(map => map.lanterns.length), [5, 6, 7]);
  assert.deepEqual([first, second, third].map(map => map.moteSpawns.length), [24, 24, 30]);
  assert.deepEqual([first, second, third].map(map => map.shadeSpawns.length), [12, 16, 16]);
  assert.deepEqual(first.lanterns[1], { x: 23.8, y: 0, z: 7.7 });
  assert.equal(groundHeight(first, 40, 0), 0);
  assert.equal(groundHeight(first, 40.0001, 0), -Infinity);
  assert.equal(groundHeight(second, 35, 2), 0);
  assert.equal(groundHeight(second, 35, 2.01), -Infinity);
  assert.equal(groundHeight(third, 0, 18), 3);
  assert.equal(groundHeight(third, 0, -18), 0);
  assert.equal(groundHeight(third, 0, 10), 0);
  assert.equal(groundHeight(third, 0, 8), 6);
});

test('CLI determinism is byte identical and default snapshots have official vector shapes', t => {
  const files = fixtures(t);
  const args = ['--night', '1', '--ticks', '40', '--scenario', files.json('scenario.json', {
    player: { pos: [0.12349, 0.23456, 0], vel: [0.12349, 0.23456, 0], pulse_cd_ticks: 120 },
  }), '--inputs', files.json('inputs.json', [{ tick: 0, x: 1, z: 1, cam_yaw_deg: 90 }, { tick: 20, pause: true }])];
  const outputs = ['a', 'b', 'c'].map((name, index) => {
    const path = files.path(`${name}.jsonl`);
    const result = run(...args, '--seed', index === 2 ? '14' : '13', '--out', path);
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(path);
  });
  assert.deepEqual(outputs[0], outputs[1]);
  assert.notDeepEqual(outputs[0], outputs[2]);
  const records = parse(outputs[0].toString('utf8'));
  const snapshots = records.filter(record => record.type === 'snapshot');
  assert.deepEqual(snapshots.map(({ tick }) => tick), [0, 10, 20, 30, 40]);
  assert.equal(snapshots[0].player.x, 0.123);
  assert.equal(snapshots[0].player.y, 0.235);
  assert.deepEqual(snapshots[0].player.vel, [0.123, 0.235, 0]);
  assert.equal(snapshots[0].player.pulse_cd_s, 2);
  assert.equal(snapshots[0].motes.length, 20);
  assert.deepEqual(Object.keys(snapshots[0].motes[0]), ['id', 'pos', 'kind', 'ttl_s']);
  assert.deepEqual(snapshots[0].wind, { active: false, dir_deg: 0 });
  assert.equal(records.at(-1).sim_tick, 20);
});

test('picks up at both distance boundaries and deposits to win with v1.1 scoring', t => {
  const { events, snapshots, end } = scenarioRun(t, {
    player: { carried: 7 }, lanterns: [{ x: 20, lit: true }, { x: 2, y: 50 }],
    motes: [{ pos: [1, 1.5, 0] }, { x: -1 }, { z: 1 }, { x: 1.00001 }, { y: 1.50001 }],
  }, [{ tick: 0, interact: true }], 10);
  assert.deepEqual(events.map(event => event.event), [
    'night_start', 'mote_picked', 'mote_picked', 'mote_picked', 'deposit', 'lantern_lit', 'game_over',
  ]);
  assert.equal(snapshots[0].score, 0);
  assert.equal(events.find(event => event.event === 'deposit').amount, 10);
  assert.deepEqual(snapshots[1].motes.map(({ id }) => id), ['M4', 'M5']);
  assert.deepEqual(end, { type: 'end', tick: 1, sim_tick: 1, state: 'won', result: 'won', reason: 'all_lit', score: 878 });
});

test('held interact deposits once and a new rising edge resumes a partial deposit', () => {
  const sim = game({ player: { carried: 1 }, lanterns: [{ x: 0 }], motes: [{ x: 1.2 }] });
  sim.step({ interact: true });
  advance(sim, 6, { x: 1, interact: true });
  assert.equal(sim.snapshot().lanterns[0].deposited, 1);
  assert.equal(sim.snapshot().player.carried, 1);
  sim.step();
  assert.equal(sim.step({ interact: true })[0].deposited, 2);
});

test('pulse uses the 3D center, pushes over 15 ticks, stuns for 120 and observes cooldown', t => {
  const { events, snapshots } = scenarioRun(t, {
    player: { carried: 6, invuln_ticks: 200 }, shades: [{ pos: [5, 0.8, 0] }, { pos: [-5, 0, 0] }],
  }, [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 30, pulse: true },
    { tick: 179, pulse: false }, { tick: 180, pulse: true }], 181);
  const pulses = events.filter(({ event }) => event === 'pulse');
  assert.deepEqual(pulses.map(({ tick }) => tick), [1, 181]);
  assert.deepEqual(pulses[0].stunned, ['S1']);
  assert.equal(pulses[0].score, 5);
  assert.equal(snapshots[1].shades[0].x, 5.267);
  assert.equal(snapshots[15].shades[0].x, 9);
  assert.equal(snapshots[120].shades[0].state, 'stunned');
  assert.equal(snapshots[121].shades[0].state, 'chase');
});

test('Gió Lạc steals before numeric shade ID order and only valid vertical contacts deal damage', t => {
  const { events, snapshots } = scenarioRun(t, {
    player: { carried: 9 }, drifters: [{ pos: [1.2, 0, 0] }],
    shades: [{ id: 'S10', x: 0 }, { id: 'S2', x: 0, y: 1.5 }, { id: 'S1', x: 0, y: 1.50001 }],
  }, [], 1, 2);
  assert.deepEqual(events.map(({ event }) => event), ['night_start', 'drifter_steal', 'player_hit']);
  assert.equal(events[1].carried, 6);
  assert.equal(events[2].shade_id, 'S2');
  assert.equal(events[2].dropped, 3);
  assert.equal(snapshots[1].player.invuln, true);
  assert.equal(snapshots[1].shades.find(shade => shade.id === 'S2').state, 'recoil');
  assert.equal(snapshots[1].drifters[0].state, 'flee');
  assert.ok(snapshots[1].motes.every(mote => mote.kind === 'dropped' && mote.ttl_s === 8 &&
    Math.hypot(mote.pos[0], mote.pos[2]) >= 1.499 && Math.hypot(mote.pos[0], mote.pos[2]) <= 2.501));
});

test('Pulse forces a fleeing Gió Lạc to drop stolen motes, which expire after 480 ticks', () => {
  const sim = game({ player: { carried: 6 }, drifters: [{ x: 1 }] }, 2);
  assert.equal(sim.step().find(event => event.event === 'drifter_steal').amount, 3);
  assert.deepEqual(sim.step({ pulse: true }).map(({ event }) => event), ['pulse', 'drifter_drop']);
  assert.equal(sim.snapshot().drifters[0].stolen, 0);
  assert.equal(sim.snapshot().motes.length, 3);
  advance(sim, 238);
  assert.equal(sim.snapshot().drifters.length, 1);
  sim.step();
  assert.equal(sim.snapshot().drifters.length, 0);
  advance(sim, 240);
  assert.equal(sim.snapshot().motes.length, 3);
  sim.step();
  assert.equal(sim.snapshot().motes.length, 0);
});

test('an idle Gió Lạc touching Mây can steal fewer than three motes', () => {
  const sim = game({ player: { carried: 2 }, drifters: [{ x: 0 }] }, 2);
  const steal = sim.step().find(event => event.event === 'drifter_steal');
  assert.equal(steal.amount, 2);
  assert.equal(steal.carried, 0);
  assert.equal(sim.snapshot().drifters[0].state, 'flee');
});

test('shade chase has 12 m detection, 18 m hysteresis, and uses Night 3 speed', () => {
  const sim = game({ player: { pos: [0, 0, -25] }, wind_enabled: false, shades: [
    { id: 'S1', pos: [12, 0, -25], state: 'wander' },
    { id: 'S2', pos: [-18, 0, -25], state: 'chase' },
    { id: 'S3', pos: [-18.01, 0, -25], state: 'chase' },
  ] }, 3);
  sim.step();
  const [first, second, third] = sim.snapshot().shades;
  assert.equal(first.state, 'chase');
  assert.equal(second.state, 'chase');
  assert.equal(third.state, 'wander');
  nearly(first.x, 12 - 4.5 / 60);

  const recoil = game({ shades: [{ x: 0 }] });
  recoil.step();
  advance(recoil, 60);
  nearly(recoil.snapshot().shades[0].x, 2);
  recoil.step();
  assert.equal(recoil.snapshot().shades[0].state, 'chase');
});

test('newly lit lantern ejects shades within 30 ticks and blocks subsequent entry', () => {
  const sim = game({ player: { carried: 10 }, lanterns: [{ x: 0 }, { x: 15 }], shades: [{ x: 2 }, { x: 6.02 }] });
  sim.step({ interact: true });
  assert.ok(sim.snapshot().shades[0].x > 2 && sim.snapshot().shades[0].x < 6);
  advance(sim, 29);
  assert.ok(sim.snapshot().shades.every(shade => shade.x >= 6));
  advance(sim, 60);
  assert.ok(sim.snapshot().shades.every(shade => shade.x >= 6));
  assert.equal(sim.snapshot().player.flames, 3);
});

test('dash uses the rotated input for 12 ticks, holds Y, and applies no invulnerability', () => {
  const sim = game({ player: { y: 5, vel: [0, -2, 0] } });
  assert.ok(sim.step({ dash: true, x: 1, cam_yaw_deg: 90 }).some(event => event.event === 'dash'));
  advance(sim, 11, { dash: true, x: -1 });
  let { player } = sim.snapshot();
  nearly(player.z, -2.8);
  nearly(player.vel[2], -14);
  assert.equal(player.y, 5);
  assert.equal(player.invuln, false);
  nearly(player.dash_cd_s, 79 / 60);
  sim.step();
  assert.ok(sim.snapshot().player.y < 5);
  const grounded = game();
  grounded.step({ dash: true });
  assert.ok(grounded.snapshot().player.z > 0, 'stationary dash faces +Z at spawn');
  advance(grounded, 88);
  assert.ok(grounded.step({ dash: true }).every(event => event.event !== 'dash'));
  grounded.step();
  assert.ok(grounded.step({ dash: true }).some(event => event.event === 'dash'));
  const vulnerable = game({ shades: [{ z: 0.25 }] });
  assert.ok(vulnerable.step({ dash: true }).some(event => event.event === 'player_hit'));
});

test('normal movement reaches speed in six ticks, jumping uses vy 7, and fall resets the load and respawns', () => {
  const sim = game();
  advance(sim, 6, { x: 1, z: 1 });
  nearly(Math.hypot(sim.snapshot().player.vel[0], sim.snapshot().player.vel[2]), 6);
  sim.step({ jump: true });
  assert.equal(sim.snapshot().player.vel[1], 7);
  assert.equal(sim.snapshot().player.grounded, false);
  advance(sim, 60, { jump: true });
  assert.equal(sim.snapshot().player.y, 0);
  const fall = game({ player: { x: 39.95, carried: 7 } });
  let hit;
  for (let i = 0; i < 100 && !hit; i++) hit = fall.step({ x: 1 }).find(event => event.event === 'player_hit');
  assert.equal(hit.by, 'fall');
  assert.equal(hit.lost, 7);
  assert.equal(fall.snapshot().motes.length, 0);
  assert.ok(fall.snapshot().player.y < -10);
  advance(fall, 59);
  assert.ok(fall.snapshot().player.y < -10);
  assert.ok(fall.step().some(event => event.event === 'player_respawned'));
  assert.deepEqual([fall.snapshot().player.x, fall.snapshot().player.y, fall.snapshot().player.z], [0, 0, 0]);
  assert.equal(fall.snapshot().player.flames, 2);
  assert.equal(fall.snapshot().player.invuln, true);
  advance(fall, 90);
  assert.equal(fall.snapshot().player.invuln, false);
});

test('Đêm 2 bridge supports walking and the launch pad reaches the other island', () => {
  const walk = game({ player: { x: 27.5 } }, 2);
  advance(walk, 180, { x: 1 });
  assert.ok(walk.snapshot().player.x > 44);
  assert.equal(walk.snapshot().player.y, 0);
  const launch = game({ player: { pos: [20, 0, 18] } }, 2);
  assert.ok(launch.step().some(event => event.event === 'launch_pad'));
  assert.equal(launch.snapshot().player.vel[1], 14);
  advance(launch, 30, { x: -1 });
  const airborne = launch.snapshot().player;
  nearly(Math.hypot(airborne.vel[0], airborne.vel[2]), 24);
  assert.ok(airborne.x > 30 && airborne.y > 4);
  advance(launch, 55);
  assert.ok(launch.snapshot().player.x > 45);
  assert.equal(launch.snapshot().player.grounded, true);
});

test('Bùa Gió respawns in 2700 ticks and grants speed 7.2 and no dash cooldown for 600 ticks', () => {
  const sim = game({ player: { pos: [35, 0, 0], dash_cd_ticks: 90 } }, 2);
  const picked = sim.step().find(event => event.event === 'charm_picked');
  assert.equal(picked.charm_ticks, 600);
  assert.deepEqual(sim.snapshot().charms, [{ id: 'C1', available: false, respawn_s: 45 }]);
  assert.equal(sim.snapshot().player.charm_s, 10);
  advance(sim, 6, { x: 1 });
  nearly(sim.snapshot().player.vel[0], 7.2);
  assert.ok(sim.step({ dash: true, x: 1 }).some(event => event.event === 'dash'));
  assert.equal(sim.snapshot().player.dash_cd_s, 0);
  advance(sim, 12);
  assert.ok(sim.step({ dash: true, x: 1 }).some(event => event.event === 'dash'));
  advance(sim, 601 - sim.snapshot().sim_tick);
  assert.equal(sim.snapshot().player.charm_s, 0);
  advance(sim, 2700 - sim.snapshot().sim_tick);
  assert.equal(sim.snapshot().charms[0].available, false);
  sim.step();
  assert.equal(sim.snapshot().charms[0].available, true);
});

test('Đêm 3 slopes reach level 1, standing walls block, and the pad reaches level 2', () => {
  const ux = Math.cos(Math.PI / 6);
  const uz = Math.sin(Math.PI / 6);
  const ramp = game({ player: { pos: [30 * ux, 0, 30 * uz] }, wind_enabled: false }, 3);
  advance(ramp, 66, { x: -ux, z: -uz });
  assert.equal(ramp.snapshot().player.y, 3);
  const wall = game({ player: { pos: [0, 0, 24.1] } }, 3);
  advance(wall, 30, { z: -1 });
  assert.equal(wall.snapshot().player.y, 0);
  assert.ok(wall.snapshot().player.z >= 24);
  const base = game({ player: { pos: [5, 0, -5] } }, 3);
  base.step();
  assert.equal(base.snapshot().player.y, 0);
  assert.equal(base.snapshot().player.grounded, true);
  const ledge = game({ player: { pos: [3, 3, 12.1] } }, 3);
  advance(ledge, 40, { z: -1 });
  assert.equal(ledge.snapshot().player.y, 0);
  const pad = game({ player: { pos: [0, 3, 13] } }, 3);
  pad.step();
  assert.deepEqual(pad.snapshot().player.vel, [0, 12, -8]);
  advance(pad, 62);
  assert.equal(pad.snapshot().player.y, 6);
  advance(pad, 70, { z: -1 });
  assert.ok(pad.snapshot().player.z >= 2);
});

test('Đêm 3 warns 120 ticks before wind, pushes at 2 m/s for 300 ticks, and can disable it', () => {
  const sim = game({ player: { pos: [15, 0, -15] } }, 3);
  const calm = game({ player: { pos: [15, 0, -15] }, wind_enabled: false }, 3);
  const warnings = advance(sim, 1799).filter(event => event.event === 'wind_warning');
  assert.equal(warnings[0].tick, 1680);
  assert.equal(sim.snapshot().wind.active, false);
  const before = sim.snapshot().player;
  advance(sim, 300);
  assert.equal(sim.snapshot().wind.active, true);
  assert.equal(sim.snapshot().wind.dir_deg, warnings[0].dir_deg);
  const after = sim.snapshot().player;
  nearly(Math.hypot(after.x - before.x, after.z - before.z), 10);
  sim.step();
  assert.equal(sim.snapshot().wind.active, false);
  assert.ok(advance(calm, 2100).every(event => event.event !== 'wind_warning'));
  assert.deepEqual(calm.snapshot().wind, { active: false, dir_deg: 0 });
});

test('Pause uses an edge, preserves timers/entities, and resumes exact sim ticks', t => {
  const { events, snapshots } = scenarioRun(t, {
    player: { invuln_ticks: 90, dash_cd_ticks: 60, pulse_cd_ticks: 120, charm_ticks: 300 },
    shades: [{ x: 10, state: 'stunned', state_ticks_left: 60 }],
    motes: [{ pos: [5.23456, 0, 5], kind: 'dropped', ttl_ticks: 30 }],
    drifters: [{ pos: [10, 0, 10], state: 'flee', state_ticks_left: 30, stolen: 2 }],
    charms: [{ available: false, respawn_ticks: 30 }],
  }, [{ tick: 1, pause: true, dash: true }, { tick: 4, pause: false }, { tick: 5, pause: true }], 7, 2);
  assert.deepEqual(events.map(({ event, tick }) => [event, tick]), [['night_start', 1], ['paused', 2], ['resumed', 6]]);
  for (const snapshot of snapshots.slice(2, 6)) {
    const { state, tick, ...frozen } = snapshot;
    const { state: previousState, tick: previousTick, ...running } = snapshots[1];
    assert.deepEqual(frozen, running);
    assert.equal(state, 'paused');
    assert.ok(tick > previousTick);
  }
  assert.equal(snapshots[6].sim_tick, 2);
  assert.deepEqual(snapshots[6].motes[0].pos, [5.235, 0, 5]);
  assert.equal(snapshots[6].charms[0].respawn_s, 28 / 60);
  assert.equal(snapshots[6].shades[0].state_ticks_left, 58);
});

test('periodic spawn boundaries, Night 1 exclusion and per-night limits', () => {
  const first = game({ random_motes: true, random_shades: true, motes: [], player: { invuln_ticks: 6000 } });
  advance(first, 239);
  assert.equal(first.snapshot().motes.length, 0);
  first.step();
  assert.equal(first.snapshot().motes.length, 1);
  advance(first, 60);
  assert.equal(first.snapshot().shades.length, 2);
  assert.ok(first.snapshot().shades.every(shade => shade.state === 'spawning' && Math.hypot(shade.x, shade.z) >= 15));
  advance(first, 480);
  assert.equal(first.snapshot().shades.length, 3);
  advance(first, 480 * 6);
  assert.equal(first.snapshot().shades.length, 6);
  for (const [night, firstShade, cap] of [[2, 420, 8], [3, 360, 10]]) {
    const sim = game({ random_shades: true, random_drifters: true, wind_enabled: false, player: { invuln_ticks: 9000 } }, night);
    advance(sim, firstShade - 1);
    assert.equal(sim.snapshot().shades.length, 0);
    sim.step();
    assert.equal(sim.snapshot().shades.length, 1);
    advance(sim, 1200 - firstShade);
    assert.equal(sim.snapshot().drifters.length, 1);
    advance(sim, 5000);
    assert.equal(sim.snapshot().drifters.length, 2);
    assert.equal(sim.snapshot().shades.length, cap);
  }
});

test('CLI rejects invalid JSON, timestamps, enum values, timers and vectors', t => {
  const files = fixtures(t);
  const malformed = files.path('malformed.json');
  writeFileSync(malformed, '{');
  for (const args of [
    ['--scenario', malformed], ['--inputs', malformed], ['--night', '4'],
    ['--inputs', files.json('duplicate.json', [{ tick: 1 }, { tick: 1 }])],
    ['--inputs', files.json('descending.json', [{ tick: 5 }, { tick: 2 }])],
    ['--inputs', files.json('button.json', [{ tick: 0, dash: 1 }])],
    ['--scenario', files.json('timer.json', { player: { charm_ticks: -1 } })],
    ['--scenario', files.json('shade.json', { shades: [{ state: 'angry' }] })],
    ['--scenario', files.json('vector.json', { drifters: [{ pos: [0, 0] }] })],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.ok(result.stderr.trim());
    assert.equal(result.stdout, '');
  }
});

test('no flames takes priority over a pre-lit map and dawn stops the correct night', () => {
  const dead = game({ player: { flames: 0 }, lanterns: [{ lit: true }] });
  assert.equal(dead.snapshot().score, 0);
  assert.equal(dead.step().at(-1).reason, 'no_flames');
  const sim = game();
  advance(sim, 17999);
  assert.equal(sim.finished, false);
  assert.equal(sim.step().at(-1).reason, 'dawn');
  assert.deepEqual(sim.step(), []);
});

test('full 21,600-tick Night 3 CLI with regular JSONL snapshots takes under 2 seconds', t => {
  const files = fixtures(t);
  const scenario = files.json('long.json', { player: { invuln_ticks: 21601 } });
  const file = files.path('night3.jsonl');
  const start = performance.now();
  const result = run('--night', '3', '--ticks', '21600', '--scenario', scenario, '--out', file);
  const elapsed = performance.now() - start;
  const records = parse(readFileSync(file, 'utf8'));
  const { tick, sim_tick, reason } = records.at(-1);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([tick, sim_tick, reason], [21600, 21600, 'dawn']);
  assert.ok(records.some(record => record.event === 'wind_warning'));
  assert.ok(elapsed < 2000, `elapsed ${elapsed.toFixed(0)} ms`);
  t.diagnostic(`CLI wall time ${elapsed.toFixed(0)} ms`);
});
