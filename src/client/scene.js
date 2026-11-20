import * as THREE from 'three';
import { groundHeight } from '../sim/maps.js';

const TAU = 2 * Math.PI;
const COLORS = {
  sky: '#0E1430', fog: '#1B2350', grass: '#2F5D50', sand: '#C9B48A', wood: '#6B4A2F', clouds: '#12384A',
  lantern: '#FFB347', core: '#FFE9B0', unlit: '#5B5F6E', shade: '#120A1A', shadeRim: '#7A3CFF',
  stunned: '#3A3450', tunic: '#E8E2D0', scarf: '#C8102E', trim: '#F2C14E', drifter: '#8FA3B8',
  accessibleRim: '#00B3FF', accessibleWarning: '#FFFFFF', lowFuel: '#FF646B',
};

function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function surface(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
}

function texture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function haloTexture() {
  return texture(128, (context, size) => {
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(0.21, '#ffffffa8');
    gradient.addColorStop(0.5, '#ffffff35');
    gradient.addColorStop(1, '#ffffff00');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

function glow(parent, map, color, size, y = 0, opacity = 1) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  sprite.scale.setScalar(size);
  sprite.position.y = y;
  parent.add(sprite);
  return sprite;
}

function stageRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function addSky(scene, halo) {
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      high: { value: new THREE.Color(COLORS.sky) },
      horizon: { value: new THREE.Color(COLORS.fog) },
      low: { value: new THREE.Color(COLORS.clouds) },
    },
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 high, horizon, low;
      varying vec3 vDirection;
      void main() {
        float y = normalize(vDirection).y;
        vec3 color = mix(horizon, high, smoothstep(-0.05, 0.34, y));
        color = mix(color, low, smoothstep(0.02, 0.58, -y));
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  mesh(scene, new THREE.SphereGeometry(340, 32, 18), sky).renderOrder = -10;

  const random = stageRandom(354);
  const stars = new Float32Array(550 * 3);
  for (let index = 0; index < stars.length; index += 3) {
    const azimuth = TAU * random();
    const height = 0.07 + random() * 0.92;
    const horizontal = 285 * Math.sqrt(1 - height * height);
    stars.set([horizontal * Math.cos(azimuth), height * 285, horizontal * Math.sin(azimuth)], index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starfield = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: '#e2dae3', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.72, fog: false,
  }));
  scene.add(starfield);

  const moon = new THREE.Group();
  moon.position.set(-54, 36, 170);
  scene.add(moon);
  mesh(moon, new THREE.SphereGeometry(6.2, 32, 20), new THREE.MeshBasicMaterial({ color: COLORS.core, fog: false }));
  const moonHalo = glow(moon, halo, COLORS.core, 43, 0, 0.36);
  moonHalo.material.fog = false;
  moonHalo.position.z = -8;
  const sun = new THREE.Group();
  sun.position.set(-26, 16, 165);
  mesh(sun, new THREE.SphereGeometry(10, 32, 20), new THREE.MeshBasicMaterial({ color: COLORS.core, fog: false }));
  glow(sun, halo, COLORS.lantern, 91, 0, 0.85).material.fog = false;
  sun.visible = false;
  scene.add(sun);

  return dawn => {
    starfield.visible = moon.visible = !dawn;
    sun.visible = dawn;
    sky.uniforms.high.value.set(dawn ? '#63577c' : COLORS.sky);
    sky.uniforms.horizon.value.set(dawn ? '#e7a77e' : COLORS.fog);
    sky.uniforms.low.value.set(dawn ? '#866a83' : COLORS.clouds);
  };
}

function addClouds(scene) {
  const random = stageRandom(89);
  const cloudMap = texture(256, (context, size) => {
    for (let index = 0; index < 33; index++) {
      const x = size * (0.18 + random() * 0.64);
      const y = size * (0.37 + random() * 0.27);
      const radius = size * (0.09 + random() * 0.1);
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, '#ffffff83');
      gradient.addColorStop(0.55, '#ffffff40');
      gradient.addColorStop(1, '#ffffff00');
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
  const material = new THREE.SpriteMaterial({
    map: cloudMap, color: COLORS.clouds, transparent: true, opacity: 0.8, depthWrite: false, fog: false,
  });
  return Array.from({ length: 72 }, (_, index) => {
    const distance = 53 + random() * 140;
    const angle = random() * TAU;
    const y = distance < 90 ? -11 + random() * 6 : -13 + random() * 25;
    const cloud = new THREE.Sprite(material);
    cloud.position.set(Math.cos(angle) * distance, y, Math.sin(angle) * distance);
    cloud.scale.set(28 + random() * 55, 10 + random() * 16, 1);
    scene.add(cloud);
    return { cloud, x: cloud.position.x, offset: random() * TAU };
  });
}

function addTerrain(scene, lanterns, layout) {
  const random = stageRandom(788);
  const islandRadius = layout.disks[0].radius;
  const groundMap = texture(512, (context, size) => {
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const noise = 5 * Math.sin(x / 25) * Math.cos(y / 19) + 6 * (random() - 0.5);
        const index = (y * size + x) * 4;
        image.data.set([47 + noise, 93 + noise, 80 + noise, 255], index);
      }
    }
    context.putImageData(image, 0, 0);
    const center = size / 2;
    const worldToTexture = center / islandRadius;
    context.lineCap = 'round';
    context.strokeStyle = `${COLORS.sand}90`;
    context.lineWidth = 12;
    for (const { x, z } of lanterns) {
      context.beginPath();
      context.moveTo(center, center);
      context.quadraticCurveTo(center + (x - z / 3) * 2, center + (z + x / 3) * 2,
        center + x * worldToTexture, center + z * worldToTexture);
      context.stroke();
    }
  });
  groundMap.anisotropy = 4;
  const earth = surface('#45475b', { flatShading: true });
  for (const [index, disk] of layout.disks.entries()) {
    const start = disk.northHalf ? Math.PI : 0;
    const span = disk.northHalf ? Math.PI : TAU;
    const geometry = disk.inner
      ? new THREE.RingGeometry(disk.inner, disk.radius, 96, 1, start, span)
      : new THREE.CircleGeometry(disk.radius, 96, start, span);
    const ground = mesh(scene, geometry, surface(index === 0 ? '#fff' : COLORS.grass, {
      map: index === 0 ? groundMap : null,
    }), disk.x, disk.y, disk.z);
    ground.rotation.x = -Math.PI / 2;
    const depth = index === 0 || disk.y === 0 ? 7 : disk.y;
    const cliffStart = disk.northHalf ? -Math.PI / 2 : 0;
    const cliff = new THREE.CylinderGeometry(disk.radius, disk.y ? disk.radius : disk.radius * 0.9, depth, 96, 1, true, cliffStart, span);
    const wall = mesh(scene, cliff, earth, disk.x, disk.y - depth / 2, disk.z);
    if (disk.inner) {
      mesh(scene, new THREE.CylinderGeometry(disk.inner, disk.inner, depth, 96, 1, true, cliffStart, span),
        surface('#45475b', { side: THREE.BackSide }), disk.x, disk.y - depth / 2, disk.z);
      for (const sign of [-1, 1]) mesh(scene, new THREE.BoxGeometry(disk.radius - disk.inner, depth, 0.05),
        wall.material, disk.x + sign * (disk.radius + disk.inner) / 2, disk.y - depth / 2, disk.z);
    }
  }
  for (const bridge of layout.bridges) {
    const planks = [surface(COLORS.wood), surface(COLORS.wood, { roughness: 0.66 })];
    for (let x = bridge.minX + 0.2, index = 0; x < bridge.maxX; x += 0.4, index++) {
      mesh(scene, new THREE.BoxGeometry(0.39, 0.14, bridge.maxZ - bridge.minZ), planks[index % 2],
        x, bridge.y - 0.07, (bridge.minZ + bridge.maxZ) / 2);
    }
  }
  for (const ramp of layout.ramps) {
    const corners = [];
    for (const [along, y, across] of [
      [ramp.outer, ramp.low, -ramp.halfWidth], [ramp.outer, ramp.low, ramp.halfWidth],
      [ramp.inner, ramp.high, -ramp.halfWidth], [ramp.inner, ramp.high, ramp.halfWidth],
    ]) corners.push(ramp.x * along - ramp.z * across, y + 0.012, ramp.z * along + ramp.x * across);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    geometry.computeVertexNormals();
    mesh(scene, geometry, surface(COLORS.sand, { side: THREE.DoubleSide }));
  }
  for (const pad of layout.pads) {
    mesh(scene, new THREE.CylinderGeometry(pad.radius, pad.radius, 0.12, 24), surface('#416985', {
      emissive: '#226394', emissiveIntensity: 0.45,
    }), pad.x, pad.y + 0.06, pad.z);
  }
  if (layout.tower) {
    const { x, y, z, radius, height } = layout.tower;
    const roof = 1.5;
    const chamber = 1.25;
    const shaft = height - roof - chamber;
    mesh(scene, new THREE.CylinderGeometry(radius * 0.78, radius, shaft, 12), earth, x, y + shaft / 2, z);
    const frame = surface(COLORS.wood);
    for (const dx of [-0.56, 0.56]) for (const dz of [-0.56, 0.56]) {
      mesh(scene, new THREE.CylinderGeometry(0.14, 0.18, chamber, 8), frame,
        x + dx * radius, y + shaft + chamber / 2, z + dz * radius);
    }
    const brass = surface(COLORS.trim, { metalness: 0.52, roughness: 0.42 });
    mesh(scene, new THREE.CylinderGeometry(0.34, 0.59, 0.68, 16), brass, x, y + shaft + 0.62, z);
    mesh(scene, new THREE.TorusGeometry(0.56, 0.055, 8, 20), brass, x, y + shaft + 0.28, z).rotation.x = Math.PI / 2;
    mesh(scene, new THREE.ConeGeometry(radius, roof, 12), surface(COLORS.wood), x, y + height - roof / 2, z);
  }

  const blade = new THREE.InstancedMesh(new THREE.ConeGeometry(0.066, 0.56, 3), surface('#fff'), 2700);
  const stone = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), surface('#fff', { flatShading: true }), 135);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  for (let index = 0; index < blade.count + stone.count; index++) {
    const angle = random() * TAU;
    const grass = index < blade.count;
    const distance = grass ? (islandRadius - 1) * Math.sqrt(random()) : islandRadius * (0.72 + random() * 0.27);
    const scale = 0.55 + random() * 0.9;
    transform.position.set(Math.cos(angle) * distance, grass ? scale * 0.18 : -0.1, Math.sin(angle) * distance);
    transform.position.y += groundHeight(layout, transform.position.x, transform.position.z);
    transform.rotation.set((random() - 0.5) * 0.4, random() * TAU, (random() - 0.5) * 0.5);
    transform.scale.set(scale, scale * (grass ? 1 : 0.65), scale);
    transform.updateMatrix();
    const batch = grass ? blade : stone;
    const offset = grass ? index : index - blade.count;
    batch.setMatrixAt(offset, transform.matrix);
    color.set(grass ? COLORS.grass : COLORS.unlit).multiplyScalar(0.74 + random() * 0.52);
    batch.setColorAt(offset, color);
  }
  scene.add(blade, stone);

  const bark = surface(COLORS.wood);
  const leaf = surface(COLORS.grass, { flatShading: true });
  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.27, 3.5, 6);
  const leafGeometry = new THREE.IcosahedronGeometry(1.35, 1);
  for (let index = 0; index < 22; index++) {
    const angle = (index + 0.4 * random()) * TAU / 22;
    const distance = islandRadius * (0.68 + 0.24 * random());
    const tree = new THREE.Group();
    tree.position.set(distance * Math.cos(angle), 0, distance * Math.sin(angle));
    tree.position.y = groundHeight(layout, tree.position.x, tree.position.z);
    tree.scale.setScalar(0.68 + random() * 0.72);
    tree.rotation.y = random() * TAU;
    mesh(tree, trunkGeometry, bark, 0, 1.65).rotation.z = -0.14;
    mesh(tree, leafGeometry, leaf, 0.23, 3.45).scale.set(1.35, 0.78, 1.05);
    mesh(tree, leafGeometry, leaf, -0.71, 2.92, 0.35).scale.set(0.82, 0.6, 0.7);
    mesh(tree, leafGeometry, leaf, 0.97, 3.1, 0.18).scale.set(0.77, 0.57, 0.69);
    scene.add(tree);
  }
}

function makePlayer(scene, halo) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  scene.add(root);
  root.add(model);
  const tunic = surface(COLORS.tunic);
  const sash = surface(COLORS.scarf);
  const trim = surface(COLORS.trim);
  const skin = surface('#e0a680');
  const cloth = surface('#262e45');
  const straw = surface('#e6ca83', { flatShading: true });
  mesh(model, new THREE.CylinderGeometry(0.27, 0.44, 0.72, 10), tunic, 0, 0.9);
  mesh(model, new THREE.CylinderGeometry(0.34, 0.36, 0.09, 12), sash, 0, 0.74);
  mesh(model, new THREE.CylinderGeometry(0.29, 0.31, 0.13, 12), sash, 0, 1.27);
  mesh(model, new THREE.CylinderGeometry(0.294, 0.296, 0.025, 12), trim, 0, 1.327);
  mesh(model, new THREE.BoxGeometry(0.18, 0.34, 0.035), sash, -0.18, 1.05, 0.28).rotation.z = -0.21;
  const charm = new THREE.Group();
  const charmShape = new THREE.OctahedronGeometry(0.14);
  mesh(charm, charmShape, new THREE.MeshBasicMaterial({ color: COLORS.scarf }));
  mesh(charm, charmShape, new THREE.MeshBasicMaterial({ color: COLORS.trim, side: THREE.BackSide })).scale.setScalar(1.18);
  charm.position.set(0.28, 0.92, 0.35);
  model.add(charm);
  mesh(model, new THREE.SphereGeometry(0.28, 14, 10), skin, 0, 1.45);
  mesh(model, new THREE.ConeGeometry(0.63, 0.4, 24), straw, 0, 1.81).rotation.z = 0.08;
  const brim = mesh(model, new THREE.TorusGeometry(0.595, 0.025, 6, 24), trim, 0.016, 1.625);
  brim.rotation.set(Math.PI / 2, 0.08, 0);
  const legs = [-0.16, 0.16].map(x => {
    const leg = new THREE.Group();
    leg.position.set(x, 0.62, 0);
    mesh(leg, new THREE.CylinderGeometry(0.105, 0.08, 0.46, 8), cloth, 0, -0.24);
    mesh(leg, new THREE.BoxGeometry(0.19, 0.13, 0.29), cloth, 0, -0.53, -0.055);
    model.add(leg);
    return leg;
  });
  mesh(model, new THREE.CapsuleGeometry(0.09, 0.32, 4, 8), tunic, -0.35, 0.96).rotation.z = -0.28;
  mesh(model, new THREE.CapsuleGeometry(0.09, 0.32, 4, 8), tunic, 0.39, 1.02).rotation.z = 0.42;
  mesh(model, new THREE.CylinderGeometry(0.018, 0.018, 0.31, 6), sash, 0.51, 0.83, -0.12);
  mesh(model, new THREE.SphereGeometry(0.15, 12, 10), surface(COLORS.lantern, {
    emissive: COLORS.core, emissiveIntensity: 1.2,
  }), 0.51, 0.63, -0.12).scale.y = 1.25;
  const lampGlow = glow(model, halo, COLORS.lantern, 1.38, 0.63, 0.72);
  lampGlow.position.set(0.51, 0.63, -0.1);
  const light = new THREE.PointLight(COLORS.lantern, 18, 6, 2);
  light.position.set(0.56, 0.7, -0.12);
  model.add(light);

  const shadow = mesh(root, new THREE.CircleGeometry(0.51, 24), new THREE.MeshBasicMaterial({
    color: '#0a0f22', transparent: true, opacity: 0.43, depthWrite: false,
  }), 0, 0.018);
  shadow.rotation.x = -Math.PI / 2;
  return { root, model, legs, shadow, charm };
}

function warningTexture() {
  return texture(64, context => {
    context.lineWidth = 5;
    context.lineJoin = 'round';
    context.strokeStyle = '#fff';
    context.fillStyle = '#fff';
    context.beginPath();
    context.moveTo(32, 8);
    context.lineTo(58, 54);
    context.lineTo(6, 54);
    context.closePath();
    context.stroke();
    context.fillRect(29, 25, 6, 14);
    context.fillRect(29, 43, 6, 5);
  });
}

function paperTears(body) {
  const tears = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.23, 0.45);
  shape.lineTo(0.23, 0.21);
  shape.lineTo(0.10, 0.08);
  shape.lineTo(0.23, -0.20);
  shape.lineTo(-0.12, -0.38);
  shape.lineTo(-0.06, -0.05);
  shape.lineTo(-0.24, 0.04);
  shape.lineTo(-0.11, 0.19);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const edge = new THREE.MeshBasicMaterial({ color: '#9B9CAD' });
  const hole = new THREE.MeshBasicMaterial({ color: '#181927' });
  for (let index = 0; index < 4; index++) {
    const face = new THREE.Group();
    face.rotation.y = Math.PI / 8 + index * Math.PI / 2;
    mesh(face, geometry, edge, 0, 2.15, 0.77).scale.set(1.1, 1.08, 1);
    mesh(face, geometry, hole, 0, 2.15, 0.775);
    tears.add(face);
  }
  body.add(tears);
  return tears;
}

const FUEL_BAR_WIDTH = 1.52;

function makeFuelBar(root, warningMap) {
  const bar = new THREE.Group();
  bar.position.y = 4.3;
  root.add(bar);
  const track = mesh(bar, new THREE.PlaneGeometry(1.65, 0.26), new THREE.MeshBasicMaterial({
    color: '#101226', transparent: true, opacity: 0.94, depthWrite: false,
  }));
  const fill = mesh(bar, new THREE.PlaneGeometry(FUEL_BAR_WIDTH, 0.14), new THREE.MeshBasicMaterial({
    color: COLORS.lantern, transparent: true, depthWrite: false,
  }), 0, 0, 0.003);
  const warning = new THREE.Sprite(new THREE.SpriteMaterial({ map: warningMap, depthWrite: false }));
  warning.position.x = 1.03;
  warning.scale.setScalar(0.34);
  bar.add(warning);
  return { bar, track, fill, warning };
}

function makeLantern(scene, halo, warningMap, safeRadius) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const stone = surface('#727481', { flatShading: true });
  const metal = surface(COLORS.wood, { metalness: 0.27 });
  const roof = surface('#34354d');
  const pane = surface(COLORS.unlit, { emissive: COLORS.core, emissiveIntensity: 0 });
  mesh(body, new THREE.CylinderGeometry(1.03, 1.15, 0.35, 8), stone, 0, 0.175);
  mesh(body, new THREE.CylinderGeometry(0.4, 0.55, 0.92, 8), stone, 0, 0.76);
  mesh(body, new THREE.CylinderGeometry(0.91, 0.78, 0.16, 8), metal, 0, 1.26);
  mesh(body, new THREE.CylinderGeometry(0.83, 0.71, 1.66, 8), pane, 0, 2.15);
  const frame = new THREE.CylinderGeometry(0.034, 0.039, 1.69, 6);
  for (let index = 0; index < 8; index++) {
    const angle = index * TAU / 8;
    const bar = mesh(body, frame, metal, Math.cos(angle) * 0.78, 2.15, Math.sin(angle) * 0.78);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(Math.cos(angle) * 0.12, 1.69, Math.sin(angle) * 0.12).normalize());
  }
  mesh(body, new THREE.CylinderGeometry(0.97, 1.08, 0.13, 8), metal, 0, 3.02);
  mesh(body, new THREE.CylinderGeometry(0.2, 1.12, 0.69, 8), roof, 0, 3.41);
  mesh(body, new THREE.SphereGeometry(0.15, 10, 8), metal, 0, 3.8);
  const tears = paperTears(body);
  const fuelBar = makeFuelBar(root, warningMap);
  const aura = glow(body, halo, COLORS.lantern, 7.3, 2.2, 0.75);
  const light = new THREE.PointLight(COLORS.lantern, 0, 18, 2);
  light.position.y = 2.42;
  body.add(light);

  const disk = mesh(root, new THREE.CircleGeometry(safeRadius, 64), new THREE.MeshBasicMaterial({
    color: COLORS.lantern, transparent: true, opacity: 0.105, depthWrite: false,
  }), 0, 0.024);
  const ring = mesh(root, new THREE.RingGeometry(safeRadius - 0.095, safeRadius, 80), new THREE.MeshBasicMaterial({
    color: COLORS.lantern, transparent: true, opacity: 0.59, depthWrite: false,
  }), 0, 0.03);
  disk.rotation.x = ring.rotation.x = -Math.PI / 2;
  scene.add(root);
  return { root, body, tears, fuelBar, pane, light, aura, disk, ring };
}

function makeMote(scene, halo, geometry, material, phase) {
  const root = new THREE.Group();
  mesh(root, geometry, material);
  const flicker = glow(root, halo, COLORS.lantern, 1.35, 0, 0.86);
  scene.add(root);
  return { root, flicker, phase };
}

function makeShade(scene, halo) {
  const root = new THREE.Group();
  const body = surface(COLORS.shade, { emissive: COLORS.shade, emissiveIntensity: 0.37, flatShading: true });
  const head = new THREE.IcosahedronGeometry(0.77, 1);
  mesh(root, head, body, 0, 1.03).scale.set(0.87, 1.15, 0.69);
  const rim = new THREE.MeshBasicMaterial({ color: COLORS.shadeRim, side: THREE.BackSide });
  mesh(root, head, rim, 0, 1.03).scale.set(0.94, 1.22, 0.76);
  const tail = mesh(root, new THREE.ConeGeometry(0.45, 1.05, 7), body, 0, 0.54, 0.13);
  tail.rotation.set(2.66, 0, 0.31);
  const eye = new THREE.MeshBasicMaterial({ color: COLORS.shadeRim });
  for (const x of [-0.2, 0.2]) {
    mesh(root, new THREE.SphereGeometry(0.08, 8, 8), eye, x, 1.15, -0.47).scale.set(1, 0.63, 0.68);
  }
  const aura = glow(root, halo, COLORS.shadeRim, 3, 1.05, 0.30);
  scene.add(root);
  return { root, body, eye, aura, rim };
}

function setPosition(object, point, y = point.y) {
  object.position.set(point.x, y, point.z);
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  return renderer;
}

export function createScene(renderer, initial, tuning, layout) {
  const canvas = renderer.domElement;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.fog, 0.011);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 420);
  const ambient = new THREE.AmbientLight('#ffffff', 0.15);
  const moonlight = new THREE.DirectionalLight('#c5caff', 1.27);
  moonlight.position.set(19, 28, 24);
  scene.add(ambient, moonlight);
  const halo = haloTexture();
  const updateSky = addSky(scene, halo);
  const clouds = addClouds(scene);
  addTerrain(scene, initial.lanterns, layout);

  const player = makePlayer(scene, halo);
  const warningMap = warningTexture();
  const lanterns = new Map(initial.lanterns.map(({ id }) => [id, makeLantern(scene, halo, warningMap, tuning.safe_radius)]));
  const moteGeometry = new THREE.IcosahedronGeometry(0.12, 1);
  const moteMaterial = new THREE.MeshBasicMaterial({ color: COLORS.core });
  const motes = new Map();
  const shades = new Map();
  const drifters = new Map();
  const charmModels = new Map(layout.charms.map(charm => {
    const root = new THREE.Group();
    const shape = new THREE.OctahedronGeometry(0.28);
    mesh(root, shape, new THREE.MeshBasicMaterial({ color: COLORS.scarf }));
    mesh(root, shape, new THREE.MeshBasicMaterial({ color: COLORS.trim, side: THREE.BackSide })).scale.setScalar(1.18);
    glow(root, halo, COLORS.trim, 1.85, 0, 0.66);
    scene.add(root);
    return [charm.id, { root, charm }];
  }));
  const wave = mesh(scene, new THREE.RingGeometry(0.93, 1, 96), new THREE.MeshBasicMaterial({
    color: COLORS.core, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  wave.rotation.x = -Math.PI / 2;
  wave.visible = false;

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const lookAt = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const cameraSpace = new THREE.Vector3();
  let motePhase = 0;
  let lastDawn = false;

  function render(state, view, elapsed) {
    const { yaw, foot, facing, walk, pulse, hit, dawn, backdrop, colorblind } = view;
    if (lastDawn !== dawn) {
      updateSky(dawn);
      scene.fog.color.set(dawn ? '#ad7892' : COLORS.fog);
      moonlight.color.set(dawn ? '#ffd9bb' : '#c5caff');
      lastDawn = dawn;
    }
    setPosition(player.root, foot);
    player.model.rotation.y = facing;
    player.charm.visible = state.player.charm_s > 0;
    player.model.position.y = Math.abs(Math.sin(elapsed * 12)) * walk * 0.045;
    const floor = groundHeight(layout, foot.x, foot.z, foot.y + 0.001);
    player.shadow.visible = Number.isFinite(floor) && foot.y >= floor;
    if (player.shadow.visible) {
      player.shadow.position.y = floor - foot.y + 0.018;
      player.shadow.material.opacity = 0.43 * (1 - Math.min(0.65, (foot.y - floor) * 0.5));
    }
    player.legs[0].rotation.x = Math.sin(elapsed * 12) * walk * 0.57;
    player.legs[1].rotation.x = -player.legs[0].rotation.x;
    player.model.visible = hit > 0.28 || Math.floor(hit * 26) % 2 === 0;

    let lit = 0;
    for (const lantern of state.lanterns) {
      const model = lanterns.get(lantern.id);
      const low = lantern.lit && lantern.fuel < tuning.low_fuel_threshold;
      const glowLevel = low ? 0.3 + 0.7 * (1 + Math.cos(elapsed * TAU)) / 2 : 1;
      setPosition(model.root, lantern);
      model.body.scale.y = lantern.lit ? 1 : 0.8;
      model.tears.visible = !lantern.lit;
      model.disk.visible = model.ring.visible = lantern.lit && !low;
      model.aura.visible = lantern.lit;
      model.aura.material.opacity = 0.75 * glowLevel;
      model.pane.color.set(lantern.lit ? COLORS.lantern : COLORS.unlit);
      model.pane.emissiveIntensity = lantern.lit ? 0.72 * glowLevel : 0;
      model.light.intensity = lantern.lit ? 115 * glowLevel : 0;
      const { bar, track, fill, warning } = model.fuelBar;
      bar.visible = lantern.lit;
      warning.visible = low && colorblind;
      const ratio = lantern.fuel / tuning.fuel_max;
      fill.scale.x = ratio;
      fill.position.x = (ratio - 1) * FUEL_BAR_WIDTH / 2;
      fill.material.color.set(low ? (colorblind ? COLORS.accessibleWarning : COLORS.lowFuel) : COLORS.lantern);
      fill.material.opacity = glowLevel;
      track.material.opacity = 0.6 + 0.34 * glowLevel;
      warning.material.opacity = glowLevel;
      if (lantern.lit) lit++;
    }
    ambient.intensity = 0.15 + 0.55 * (lit / state.lanterns.length);

    const liveMotes = new Set();
    for (const mote of state.motes) {
      liveMotes.add(mote.id);
      if (!motes.has(mote.id)) motes.set(mote.id, makeMote(scene, halo, moteGeometry, moteMaterial, motePhase++ * 2.4));
      const { root, flicker, phase } = motes.get(mote.id);
      const [x, y, z] = mote.pos;
      root.position.set(x, y + 0.56 + 0.24 * Math.sin(elapsed * 3 + phase), z);
      flicker.material.opacity = 0.64 + 0.26 * Math.sin(elapsed * 4.7 + phase);
    }
    for (const [id, { root, flicker }] of motes) {
      if (liveMotes.has(id)) continue;
      scene.remove(root);
      flicker.material.dispose();
      motes.delete(id);
    }

    for (const shade of state.shades) {
      if (!shades.has(shade.id)) shades.set(shade.id, makeShade(scene, halo));
      const { root, body, eye, aura, rim } = shades.get(shade.id);
      setPosition(root, shade, shade.y + 0.14 * Math.sin(elapsed * 4 + shade.x));
      root.scale.setScalar(shade.state === 'spawning' ? 0.5 : 1);
      root.rotation.y = Math.atan2(shade.x - foot.x, shade.z - foot.z);
      root.rotation.z = shade.stunned ? 0.3 * Math.sin(elapsed * 15) : 0;
      body.color.set(shade.stunned ? COLORS.stunned : COLORS.shade);
      body.emissive.set(body.color);
      eye.color.set(colorblind ? COLORS.accessibleRim : shade.stunned ? COLORS.core : COLORS.shadeRim);
      rim.color.set(colorblind ? COLORS.accessibleRim : shade.stunned ? COLORS.stunned : COLORS.shadeRim);
      aura.material.opacity = shade.stunned ? 0.13 : 0.30;
    }
    removeAbsent(shades, state.shades);

    for (const drifter of state.drifters) {
      if (!drifters.has(drifter.id)) {
        const root = new THREE.Group();
        mesh(root, new THREE.IcosahedronGeometry(0.55), surface(COLORS.drifter, {
          emissive: COLORS.drifter, emissiveIntensity: 0.42, flatShading: true,
        })).scale.set(0.8, 1.16, 0.85);
        glow(root, halo, COLORS.drifter, 2.6, 0, 0.38);
        scene.add(root);
        drifters.set(drifter.id, { root });
      }
      const { root } = drifters.get(drifter.id);
      const [x, y, z] = drifter.pos;
      root.position.set(x, y + 0.95 + 0.22 * Math.sin(elapsed * 4), z);
      root.rotation.y = elapsed * (drifter.state === 'idle' ? 1.2 : 3);
    }
    removeAbsent(drifters, state.drifters);
    for (const charm of state.charms) {
      const model = charmModels.get(charm.id);
      if (!model) continue;
      model.root.visible = charm.available;
      setPosition(model.root, model.charm, model.charm.y + 0.85 + 0.18 * Math.sin(elapsed * 4));
      model.root.rotation.y = elapsed * 1.8;
    }

    wave.visible = Boolean(pulse);
    if (pulse) {
      wave.position.set(pulse.x, pulse.y + 0.8, pulse.z);
      wave.scale.setScalar(Math.max(0.05, tuning.pulse_radius * (1 - (1 - pulse.progress) ** 2)));
      wave.material.opacity = 0.95 * (1 - pulse.progress);
    }
    for (const { cloud, x, offset } of clouds) cloud.position.x = x + Math.sin(elapsed * 0.11 + offset) * 2.2;

    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    camera.position.set(foot.x + sin * 8.5, foot.y + 4.1, foot.z + cos * 8.5);
    const offset = backdrop && camera.aspect > 1.1 ? 3.7 : 0;
    lookAt.set(foot.x - sin * 3.8 - cos * offset, foot.y + 1.55, foot.z - cos * 3.8 + sin * offset);
    camera.lookAt(lookAt);
    for (const { fuelBar } of lanterns.values()) if (fuelBar.bar.visible) fuelBar.bar.quaternion.copy(camera.quaternion);
    renderer.render(scene, camera);
  }

  function removeAbsent(models, entities) {
    const shown = new Set(entities.map(entity => entity.id));
    for (const [id, { root }] of models) {
      if (shown.has(id)) continue;
      scene.remove(root);
      disposeModels(root);
      models.delete(id);
    }
  }

  function projectLantern(lantern) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    projected.set(lantern.x, lantern.y + 1.9, lantern.z);
    cameraSpace.copy(projected).applyMatrix4(camera.matrixWorldInverse);
    projected.project(camera);
    const inFront = cameraSpace.z < -camera.near;
    if (inFront && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z <= 1) return null;

    const dx = inFront ? projected.x * width / 2 : cameraSpace.x * 14;
    const dy = inFront ? -projected.y * height / 2 : Math.max(1, cameraSpace.z) * 7;
    const insetX = Math.max(12, width / 2 - 43);
    const insetY = Math.max(18, height / 2 - (dy < 0 ? 92 : 148));
    const factor = 1 / Math.max(Math.abs(dx) / insetX, Math.abs(dy) / insetY, 0.001);
    return { x: width / 2 + dx * factor, y: height / 2 + dy * factor, angle: Math.atan2(dx, -dy) };
  }

  function dispose() {
    observer.disconnect();
    disposeModels(scene, true);
    moteGeometry.dispose();
    moteMaterial.dispose();
    renderer.renderLists.dispose();
  }

  return { render, projectLantern, dispose };
}

function disposeModels(root, disposeTextures = false) {
  const resources = new Set();
  root.traverse(object => {
    if (object.isInstancedMesh) resources.add(object);
    if (object.geometry && !object.isSprite) resources.add(object.geometry);
    if (object.material) resources.add(object.material);
    if (disposeTextures && object.material?.map) resources.add(object.material.map);
  });
  for (const resource of resources) resource.dispose();
}
