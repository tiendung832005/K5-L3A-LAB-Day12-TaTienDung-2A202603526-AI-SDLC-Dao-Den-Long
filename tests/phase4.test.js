import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/launcher.js';
import { createBenchmarkSimulation } from '../src/sim/benchmark.js';

const { tuning } = JSON.parse(readFileSync(new URL('../game.contract.json', import.meta.url), 'utf8'));

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'lantern-phase4-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(script, cwd, ...args) {
  const path = fileURLToPath(new URL(`../src/${script}.js`, import.meta.url));
  const result = spawnSync(process.execPath, [path, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('soak completes three real nights in order without crashes and repeats outcomes for the same seeds', t => {
  const cwd = temporaryDirectory(t);
  const file = join(cwd, 'soak.json');
  assert.equal(run('soak', cwd, '--seed', '7', '--nights', '3', '--out', file), '');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(report).sort(), ['crashes', 'duration_s', 'mem_end_mb', 'mem_start_mb', 'nights', 'results']);
  assert.equal(report.nights, 3);
  assert.equal(report.crashes, 0);
  assert.deepEqual(report.results.map(({ night, seed }) => [night, seed]), [[1, 7], [2, 8], [3, 9]]);
  for (const result of report.results) {
    assert.ok(['won', 'lost'].includes(result.result));
    assert.ok(result.tick > 0 && result.tick <= tuning[`night${result.night}_duration_s`] * 60);
  }
  assert.ok(report.mem_start_mb > 0 && report.mem_end_mb > 0 && report.duration_s > 0);
  const repeat = JSON.parse(run('soak', cwd, '--seed', '7', '--nights', '3'));
  assert.deepEqual(repeat.results, report.results);
});

test('launcher exports only the top ten by score and chronological ISO-8601 tie-break', t => {
  const cwd = temporaryDirectory(t);
  mkdirSync(join(cwd, 'data'));
  const entry = (name, score, achieved_at) => ({ name, score, nights_won: 2, achieved_at, seed: 7 });
  const day = '2026-11-20T09:00:00.000Z';
  const lower = Array.from({ length: 10 }, (_, index) => entry(`Mây${index}`, 100 - index, day));
  const later = entry('Muộn', 150, '2026-11-20T09:30:00+00:00');
  const earlier = entry('Sớm', 150, '2026-11-20T15:45:00+07:00');
  writeFileSync(join(cwd, 'data/leaderboard.json'), JSON.stringify({ entries: [later, ...lower.toReversed(), earlier] }));
  assert.equal(run('launcher', cwd, '--export-leaderboard', 'export/list.json'), '');
  const result = JSON.parse(readFileSync(join(cwd, 'export/list.json'), 'utf8'));
  assert.deepEqual(result, { entries: [earlier, later, ...lower.slice(0, 8)] });
});

test('leaderboard API validates entries, generates zoned timestamps and persists concurrent saves', async t => {
  const file = join(temporaryDirectory(t), 'data/leaderboard.json');
  const server = await startServer({ port: 0, file });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/leaderboard`;
  const save = name => fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, score: name === 'Mây_2' ? 20 : 15, nights_won: 1, seed: 7 }),
  });
  assert.deepEqual(await (await fetch(endpoint)).json(), { entries: [] });
  assert.equal((await save('<Mây>')).status, 400);
  const responses = await Promise.all([save('Mây_1'), save('Mây_2')]);
  assert.ok(responses.every(response => response.status === 201));
  const disk = JSON.parse(readFileSync(file, 'utf8')).entries;
  assert.equal(disk.length, 2);
  assert.ok(disk.every(entry => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.achieved_at)));
  assert.deepEqual((await (await fetch(endpoint)).json()).entries.map(({ name }) => name), ['Mây_2', 'Mây_1']);
});

test('benchmark workload has exactly 200 moving wander shades, 100 motes and three full lanterns', () => {
  const settings = { ...tuning, night1_duration_s: 1 / 60 };
  const simulation = createBenchmarkSimulation(settings, 42);
  const before = simulation.snapshot();
  assert.deepEqual(createBenchmarkSimulation(settings, 42).snapshot(), before);
  assert.notDeepEqual(createBenchmarkSimulation(settings, 43).snapshot().shades, before.shades);
  assert.equal(before.shades.length, 200);
  assert.equal(before.motes.length, 100);
  assert.deepEqual(before.lanterns.filter(lantern => lantern.lit).map(({ id, fuel }) => [id, fuel]),
    [['L1', 100], ['L2', 100], ['L3', 100]]);
  for (let tick = 0; tick < 360; tick++) simulation.step({ x: 1, pulse: true, pause: true });
  const after = simulation.snapshot();
  assert.equal(simulation.finished, false);
  assert.equal(after.shades.length, 200);
  assert.equal(after.drifters.length, 0);
  assert.ok(after.shades.every(shade => shade.state === 'wander'));
  assert.notDeepEqual(after.shades.map(({ x, z }) => [x, z]), before.shades.map(({ x, z }) => [x, z]));
  assert.deepEqual(after.motes, before.motes);
  assert.deepEqual(after.player, before.player);
  assert.deepEqual(after.lanterns, before.lanterns);
});
