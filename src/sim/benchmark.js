import { createSimulation } from './engine.js';
import { createLayout } from './maps.js';
import { mulberry32 } from './random.js';

export function createBenchmarkSimulation(tuning, seed) {
  const layout = createLayout(1);
  const random = mulberry32(seed);
  const radius = layout.disks[0].radius;
  function distribute(count, details) {
    const rotation = random() * 2 * Math.PI;
    return Array.from({ length: count }, (_, index) => {
      const angle = rotation + index * Math.PI * (3 - Math.sqrt(5)) + (random() - 0.5) * 0.09;
      const distance = radius * Math.sqrt((index + random()) / count);
      return { x: Math.cos(angle) * distance, y: 0, z: Math.sin(angle) * distance, ...details };
    });
  }
  return createSimulation({ tuning, seed, benchmark: true, scenario: {
    lanterns: layout.lanterns.map((lantern, index) => ({ ...lantern, lit: index < 3 })),
    shades: distribute(200, { state: 'wander' }),
    motes: distribute(100),
    random_shades: false, random_motes: false, random_drifters: false, wind_enabled: false,
  } });
}
