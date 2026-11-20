import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSimulation } from '../src/sim/engine.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const { tuning } = JSON.parse(readFileSync(new URL('../game.contract.json', import.meta.url), 'utf8'));
const fixedSpawns = { random_motes: false, random_shades: false };

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
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
}

function recordsFrom(output) {
  return output.trimEnd().split('\n').map(line => JSON.parse(line));
}

function scenarioRun(t, scenario, frames = [], ticks = 10) {
  const files = fixtures(t);
  const result = run(
    '--scenario', files.json('scenario.json', { ...fixedSpawns, ...scenario }),
    '--inputs', files.json('inputs.json', { frames }),
    '--ticks', String(ticks), '--snapshot-every', '1',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return recordsFrom(result.stdout);
}

test('same seed, scenario and inputs produce identical JSONL files byte for byte', t => {
  const files = fixtures(t);
  const args = [
    '--night', '1', '--ticks', '40',
    '--scenario', files.json('scenario.json', { player: { x: 0.12349, y: 0.23456 } }),
    '--inputs', files.json('inputs.json', [
      { tick: 0, x: 1, z: 1, cam_yaw_deg: 90 },
      { tick: 20, x: 0, z: 0, pulse: true },
    ]),
  ];
  const outputs = ['a', 'b', 'c'].map((name, index) => {
    const path = files.path(`${name}.jsonl`);
    const result = run(...args, '--seed', index === 2 ? '14' : '13', '--out', path);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    return readFileSync(path);
  });
  assert.deepEqual(outputs[0], outputs[1]);
  assert.notDeepEqual(outputs[0], outputs[2]);
  const records = recordsFrom(outputs[0].toString('utf8'));
  const snapshots = records.filter(record => record.type === 'snapshot');
  assert.deepEqual(snapshots.map(({ tick }) => tick), [0, 10, 20, 30, 40]);
  assert.deepEqual(snapshots[0].player, { x: 0.123, y: 0.235, z: 0, carried: 0, flames: 3 });
  assert.deepEqual(snapshots[0].lanterns.map(({ id }) => id), ['L1', 'L2', 'L3', 'L4', 'L5']);
  assert.equal(snapshots[0].motes.length, 20);
  assert.equal(snapshots[0].shades.length, 3);
  assert.equal(records.at(-1).type, 'end');
});

test('picks up motes on XZ, lights the final lantern and stops at the winning tick', t => {
  const records = scenarioRun(t, {
    lanterns: [{ id: 'L1', x: 20, lit: true }, { id: 'L2', x: 2.5, y: 50 }],
    motes: [{ x: 1.5, y: 10 }, { x: -1.5 }, { z: 1.5 }, { x: 1.50001 }],
  }, [{ tick: 0, interact: true }]);
  const events = records.filter(record => record.type === 'event');
  assert.deepEqual(events.map(({ event }) => event), [
    'mote_picked', 'mote_picked', 'mote_picked', 'deposit', 'lantern_lit', 'game_over',
  ]);
  assert.ok(events.every(({ tick }) => tick === 1));
  assert.equal(records[0].score, 0);
  assert.equal(records[0].lanterns[0].lit, true);
  assert.equal(events[3].amount, 3);
  assert.equal(records.at(-2).player.carried, 0);
  assert.deepEqual(records.at(-2).motes.map(({ id }) => id), ['M4']);
  assert.deepEqual(records.at(-1), { type: 'end', tick: 1, result: 'win', reason: 'all_lit', score: 1175 });
});

test('pulse reaches the radius boundary, pushes and stuns until its timer expires', t => {
  const records = scenarioRun(t, {
    player: { carried: 2 }, shades: [{ x: 6, y: 40 }, { x: -6.01 }],
  }, [{ tick: 0, pulse: true }], 181);
  const pulses = records.filter(({ event }) => event === 'pulse');
  assert.deepEqual(pulses, [
    { type: 'event', tick: 1, event: 'pulse', stunned: ['S1'], carried: 1, score: 25 },
  ]);
  const snapshots = records.filter(({ type }) => type === 'snapshot');
  assert.deepEqual(snapshots[1].shades[0], { id: 'S1', x: 10, y: 40, z: 0, stunned: true });
  assert.equal(snapshots[1].shades[1].stunned, false);
  assert.equal(snapshots[180].shades[0].x, 10);
  assert.equal(snapshots[181].shades[0].stunned, false);
  assert.equal(snapshots[181].shades[0].x, 9.937);
});

test('shade hits on XZ, drops floor(carried / 2) motes and respects invulnerability', t => {
  const records = scenarioRun(t, {
    player: { carried: 5 }, shades: [{ x: 1.2, y: 10 }, { x: 0 }],
  }, [], 181);
  const hits = records.filter(({ event }) => event === 'player_hit');
  assert.deepEqual(hits.map(({ tick, flames, dropped, carried }) => [tick, flames, dropped, carried]), [
    [1, 2, 2, 3], [91, 1, 1, 2], [181, 0, 1, 1],
  ]);
  assert.equal(records.find(({ type, tick }) => type === 'snapshot' && tick === 1).motes.length, 2);
  assert.equal(records.at(-1).reason, 'no_flames');
});

test('invalid JSON and malformed or non-increasing frames exit with code 2', t => {
  const files = fixtures(t);
  const malformed = files.path('malformed.json');
  writeFileSync(malformed, '{');
  for (const args of [
    ['--scenario', malformed],
    ['--inputs', malformed],
    ['--inputs', files.json('duplicate.json', [{ tick: 1 }, { tick: 1 }])],
    ['--inputs', files.json('descending.json', [{ tick: 5 }, { tick: 2 }])],
    ['--inputs', files.json('button.json', { frames: [{ tick: 0, pulse: 1 }] })],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.ok(result.stderr.trim());
    assert.equal(result.stdout, '');
  }
});

test('movement rotates normalized input and clamps the player to the island', () => {
  const simulation = createSimulation({ tuning, scenario: fixedSpawns });
  simulation.step({ x: 1, z: 1, cam_yaw_deg: 90 });
  const { x, z } = simulation.snapshot().player;
  assert.ok(Math.abs(x - 0.1 / Math.sqrt(2)) < 1e-12);
  assert.ok(Math.abs(z + 0.1 / Math.sqrt(2)) < 1e-12);
  for (let tick = 0; tick < 600; tick++) simulation.step({ x: 1 });
  const player = simulation.snapshot().player;
  assert.ok(Math.abs(Math.hypot(player.x, player.z) - 50) < 1e-12);
});

test('interact requires a new rising edge and preserves partial deposits', () => {
  const simulation = createSimulation({ tuning, scenario: {
    ...fixedSpawns, player: { carried: 1 }, lanterns: [{ x: 0 }], motes: [{ x: 1.7 }],
  } });
  assert.equal(simulation.step({ interact: true })[0].event, 'deposit');
  for (let tick = 0; tick < 4; tick++) simulation.step({ x: 1, interact: true });
  assert.equal(simulation.snapshot().lanterns[0].deposited, 1);
  assert.equal(simulation.snapshot().player.carried, 1);
  simulation.step({ interact: false });
  assert.equal(simulation.step({ interact: true })[0].deposited, 2);
});

test('pulse requires both a fresh press and an expired cooldown', () => {
  const simulation = createSimulation({ tuning, scenario: { ...fixedSpawns, player: { carried: 3 } } });
  assert.equal(simulation.step({ pulse: true })[0].event, 'pulse');
  simulation.step({ pulse: false });
  assert.deepEqual(simulation.step({ pulse: true }), []);
  for (let tick = 4; tick <= 121; tick++) {
    assert.deepEqual(simulation.step({ pulse: true }), []);
  }
  simulation.step({ pulse: false });
  assert.equal(simulation.step({ pulse: true })[0].event, 'pulse');
  assert.equal(simulation.snapshot().player.carried, 1);
});

test('random motes respawn after pickup, and lit lanterns block shade movement', () => {
  const simulation = createSimulation({ tuning, seed: 14, scenario: {
    random_shades: false,
    motes: [{ id: 'M1', x: 0 }],
    shades: [{ x: 6.02 }],
    lanterns: [{ x: 0, lit: true }, { x: 20 }],
  } });
  assert.deepEqual(simulation.step().map(({ event }) => event), ['mote_picked']);
  const snapshot = simulation.snapshot();
  assert.deepEqual(snapshot.motes.map(({ id }) => id), ['M2']);
  assert.ok(snapshot.shades[0].x >= 6);
  assert.equal(snapshot.player.flames, 3);
});

test('dawn ends the simulation on the exact 60 Hz deadline', () => {
  const simulation = createSimulation({ tuning, scenario: fixedSpawns });
  for (let tick = 1; tick < 10800; tick++) simulation.step();
  assert.equal(simulation.finished, false);
  assert.deepEqual(simulation.step(), [
    { type: 'event', tick: 10800, event: 'game_over', result: 'lose', reason: 'dawn', score: 0 },
  ]);
  assert.equal(simulation.finished, true);
  assert.deepEqual(simulation.step(), []);
});
