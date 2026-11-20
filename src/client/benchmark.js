import { createBenchmarkSimulation } from '../sim/benchmark.js';
import { TICKS_PER_SECOND } from '../sim/engine.js';
import { createRenderer, createScene } from './scene.js';

const query = new URLSearchParams(location.search);
const seed = Number(query.get('seed') ?? 42);
const duration = Number(query.get('duration') ?? 30);
if (!Number.isSafeInteger(seed) || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid benchmark parameters');

const response = await fetch(new URL('../../game.contract.json', import.meta.url));
if (!response.ok) throw new Error(`Could not load contract: HTTP ${response.status}`);
const { tuning } = await response.json();
const simulation = createBenchmarkSimulation(tuning, seed);
let state = simulation.snapshot();
const renderer = createRenderer(document.getElementById('world'));
const gl = renderer.getContext();
const debug = gl.getExtension('WEBGL_debug_renderer_info');
const rendererName = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
const scene = createScene(renderer, state, tuning, simulation.layout);

window.lanternBench = new Promise((resolve, reject) => {
  const frameTimes = [];
  let first;
  let previous;
  let measuredStart;
  let measuredEnd;
  let firstFrameAt;
  function frame(now) {
    try {
      if (first === undefined) {
        first = now;
        measuredStart = now + 3000;
        measuredEnd = measuredStart + duration * 1000;
      }
      if (previous >= measuredStart && now <= measuredEnd && now > previous) frameTimes.push(now - previous);
      if (now >= measuredEnd) {
        resolve({ firstFrameAt, frameTimes, renderer: rendererName });
        return;
      }
      const elapsed = (now - first) / 1000;
      const tick = Math.floor(elapsed * TICKS_PER_SECOND);
      if (tick > state.sim_tick) {
        for (let i = state.sim_tick; i < tick; i++) simulation.step();
        state = simulation.snapshot();
      }
      const angle = 2 * Math.PI * elapsed / 15;
      scene.render(state, {
        foot: state.player, facing: Math.PI, walk: 0, hit: Infinity, dawn: false,
        orbit: { x: 30 * Math.cos(angle), y: 15, z: -30 * Math.sin(angle) },
      }, elapsed);
      firstFrameAt ??= performance.timeOrigin + performance.now();
      previous = now;
      requestAnimationFrame(frame);
    } catch (error) {
      reject(error);
    }
  }
  requestAnimationFrame(frame);
});
