function point(x, y = 0, z = 0) {
  return { x, y, z };
}

function disk(radius, x = 0, y = 0, z = 0, inner = 0, northHalf = false) {
  return { ...point(x, y, z), radius, inner, northHalf };
}

function ring(count, radius, { x = 0, y = 0, z = 0, start = 0, step = 360 / count } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (start + index * step) * Math.PI / 180;
    return point(x + radius * Math.cos(angle), y, z + radius * Math.sin(angle));
  });
}

export function createLayout(night) {
  const layout = { night, spawn: point(0), bridges: [], ramps: [], pads: [], charms: [], tower: null };
  if (night === 1) {
    return {
      ...layout, disks: [disk(40)],
      lanterns: [point(0, 0, 25), point(23.8, 0, 7.7), point(14.7, 0, -20.2), point(-14.7, 0, -20.2), point(-23.8, 0, 7.7)],
      moteSpawns: [...ring(8, 12), ...ring(16, 33)],
      shadeSpawns: ring(12, 37, { start: 15 }),
    };
  }
  if (night === 2) {
    const pad = (id, x, z, targetX) => {
      const length = Math.hypot(targetX - x, z);
      return { id, ...point(x, 0, z), radius: 1, vy: 14, vx: (targetX - x) / length * 24, vz: -z / length * 24 };
    };
    return {
      ...layout, disks: [disk(28), disk(28, 70)],
      bridges: [{ minX: 26, maxX: 44, minZ: -2, maxZ: 2, y: 0 }],
      pads: [pad('P1', 20, 18, 70), pad('P2', 50, -18, 0)],
      lanterns: [point(0, 0, 20), point(17, 0, -10), point(-17, 0, -10), point(70, 0, 20), point(87, 0, -10), point(53, 0, -10)],
      moteSpawns: [0, 70].flatMap(x => [...ring(4, 10, { x }), ...ring(8, 22, { x })]),
      shadeSpawns: [0, 70].flatMap(x => ring(8, 26, { x, start: 22.5 })),
      charms: [{ id: 'C1', ...point(35) }],
    };
  }
  if (night === 3) {
    return {
      ...layout, spawn: point(0, 0, -30),
      disks: [disk(45), disk(24, 0, 3, 0, 12, true), disk(8, 0, 6)],
      ramps: [30, 150].map(degrees => {
        const radians = degrees * Math.PI / 180;
        return { x: Math.cos(radians), z: Math.sin(radians), outer: 30, inner: 24, halfWidth: 1.5, low: 0, high: 3 };
      }),
      pads: [{ id: 'P1', ...point(0, 3, 13), radius: 1, vx: 0, vy: 12, vz: -8 }],
      tower: { ...point(0, 6, 0), radius: 2, height: 8 },
      lanterns: [point(0, 6, 6), point(18, 3, 10), point(-18, 3, 10), point(35, 0, -10), point(-35, 0, -10), point(20, 0, -35), point(-20, 0, -35)],
      moteSpawns: [...ring(18, 34), ...ring(8, 18, { y: 3, start: 20, step: 20 }), ...ring(4, 5, { y: 6, start: 45 })],
      shadeSpawns: ring(16, 43),
      charms: [{ id: 'C1', ...point(30, 0, 25) }, { id: 'C2', ...point(-30, 0, 25) }],
    };
  }
  throw new RangeError('Night must be 1, 2 or 3');
}

export function groundHeight(layout, x, z, maxY = Infinity) {
  let height = -Infinity;
  for (const disk of layout.disks) {
    const radiusSquared = (x - disk.x) ** 2 + (z - disk.z) ** 2;
    if (disk.y <= maxY && (!disk.northHalf || z > disk.z) && radiusSquared >= disk.inner ** 2 && radiusSquared <= disk.radius ** 2) {
      height = Math.max(height, disk.y);
    }
  }
  for (const bridge of layout.bridges) {
    if (bridge.y <= maxY && x >= bridge.minX && x <= bridge.maxX && z >= bridge.minZ && z <= bridge.maxZ) {
      height = Math.max(height, bridge.y);
    }
  }
  for (const ramp of layout.ramps) {
    const along = x * ramp.x + z * ramp.z;
    const across = z * ramp.x - x * ramp.z;
    if (along >= ramp.inner - 0.05 && along <= ramp.outer + 1e-9 && Math.abs(across) <= ramp.halfWidth) {
      const t = Math.min(1, (ramp.outer - along) / (ramp.outer - ramp.inner));
      const rampHeight = ramp.low + (ramp.high - ramp.low) * t;
      if (rampHeight <= maxY) height = Math.max(height, rampHeight);
    }
  }
  return height;
}
