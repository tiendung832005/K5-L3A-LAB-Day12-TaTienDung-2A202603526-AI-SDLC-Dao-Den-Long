import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createSimulation, TICKS_PER_SECOND } from './sim/engine.js';
import { mulberry32 } from './sim/random.js';

const MB = 1024 ** 2;
const rss = () => process.memoryUsage.rss() / MB;

function runNight(tuning, night, seed, ready) {
  const simulation = createSimulation({ tuning, night, seed });
  ready();
  const random = mulberry32(seed);
  const input = { x: 0, z: 0, jump: false, dash: false, pulse: false, interact: false };
  const limit = tuning[`night${night}_duration_s`] * TICKS_PER_SECOND;
  for (let tick = 0; tick < limit && !simulation.finished; tick++) {
    if (tick % 30 === 0) {
      const idle = random() < 0.2;
      const angle = random() * 2 * Math.PI;
      input.x = idle ? 0 : Math.cos(angle);
      input.z = idle ? 0 : Math.sin(angle);
    }
    input.jump = random() < 0.05;
    input.dash = random() < 0.03;
    input.pulse = random() < 0.02;
    input.interact = random() < 0.1;
    simulation.step(input);
  }
  const { type, ...end } = simulation.end();
  return { night, seed, ...end };
}

try {
  const started = performance.now();
  const { values } = parseArgs({ options: {
    seed: { type: 'string', default: '7' }, nights: { type: 'string', default: '10' }, out: { type: 'string' },
  } });
  const seed = Number(values.seed);
  const nights = Number(values.nights);
  if (!/^-?\d+$/.test(values.seed) || !Number.isSafeInteger(seed) || !/^\d+$/.test(values.nights) ||
      !Number.isSafeInteger(nights) || nights < 1 || !Number.isSafeInteger(seed + (nights - 1))) {
    throw new Error('Expected integer --seed and positive integer --nights');
  }
  const { tuning } = JSON.parse(await readFile(new URL('../game.contract.json', import.meta.url), 'utf8'));
  const results = [];
  let memStart;
  let crashes = 0;
  for (let i = 0; i < nights; i++) {
    const night = i % 3 + 1;
    try {
      results.push(runNight(tuning, night, seed + i, () => { memStart ??= rss(); }));
    } catch (error) {
      memStart ??= rss();
      crashes++;
      results.push({ night, seed: seed + i, result: 'crash', error: error.message });
    }
  }
  global.gc?.();
  const report = { nights, crashes, results, mem_start_mb: memStart, mem_end_mb: rss(), duration_s: (performance.now() - started) / 1000 };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (values.out && values.out !== '-') await writeFile(values.out, output);
  else process.stdout.write(output);
  if (crashes) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
