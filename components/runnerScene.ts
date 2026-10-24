import * as THREE from 'three';
import { RUNNER, createRunner } from './runnerEngine.mjs';
import { createSoftwareRenderer } from './runnerSoftwareRenderer';

type Runner = ReturnType<typeof createRunner>;

// All art is constructed locally: no downloaded models, textures, or CDN calls.
export function createRunnerScene(canvas: HTMLCanvasElement) {
  let renderer: THREE.WebGLRenderer | ReturnType<typeof createSoftwareRenderer>;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch { renderer = createSoftwareRenderer(canvas); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9bdcf4');
  scene.fog = new THREE.Fog('#bde7ef', 40, 115);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 150);
  const ambient = new THREE.HemisphereLight('#fff4dc', '#618f79', 2.6);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight('#fff3dd', 3.0);
  sun.position.set(-12, 24, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 22, bottom: -35, near: 1, far: 70 });
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const materials = new Map<string, THREE.MeshLambertMaterial>();
  const mat = (color: string) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return materials.get(color)!;
  };
  const cube = new THREE.BoxGeometry(1, 1, 1);
  function box(parent: THREE.Object3D, color: string, x: number, y: number, z: number,
      w: number, h: number, d: number, shadow = false) {
    const m = new THREE.Mesh(cube, mat(color));
    m.position.set(x, y, z); m.scale.set(w, h, d);
    if (h < 0.4 && d > 20) m.userData.floor = color === '#74ad5a' ? -4 : color === '#505c70' ? -3 : -2;
    m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, color: string,
      x: number, y: number, z: number, shadow = false) {
    const m = new THREE.Mesh(geometry, mat(color)); m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  box(scene, '#74ad5a', 0, -0.18, -45, 220, 0.3, 150);
  box(scene, '#505c70', 0, -0.035, -45, 8.2, 0.14, 150);
  for (const side of [-1, 1]) {
    box(scene, '#e8cfab', side * 5.35, 0.025, -45, 2.5, 0.18, 150);
    box(scene, '#fff0d9', side * 4.17, 0.10, -45, 0.16, 0.25, 150);
  }
  const marks: THREE.Mesh[] = [];
  for (const x of [-1.3, 1.3]) for (let i = 0; i < 22; i++) {
    const mark = box(scene, '#e5edf1', x, 0.043, -i * 5, 0.09, 0.01, 2.1);
    mark.userData.floor = -1;
    mark.userData.baseZ = -i * 5; marks.push(mark);
  }

  const decor: THREE.Group[] = [];
  const leaves = new THREE.DodecahedronGeometry(1, 0);
  const trunk = new THREE.CylinderGeometry(0.16, 0.23, 2.3, 6);
  function tree(group: THREE.Group, x: number, z: number, size: number) {
    mesh(group, trunk, '#875337', x, 1.1, z, true);
    for (const [dx, dy, dz, scale, color] of [[0, 3, 0, 1.45, '#559b3c'], [-0.55, 2.4, 0.2, 1.1, '#83ba41'], [0.55, 2.7, 0, 1.05, '#70ac35']] as const) {
      const m = mesh(group, leaves, color, x + dx * size, dy * size, z + dz, true);
      m.scale.set(scale * size, scale * size * 1.2, scale * size);
    }
  }
  function building(group: THREE.Group, side: number, i: number) {
    const x = side * (10 + (i % 2) * 1.3), h = 5.5 + (i % 3) * 1.5;
    const color = ['#e5af82', '#d58d67', '#e9c79c'][i % 3];
    box(group, color, x, h / 2, 0, 5.5, h, 8, true);
    box(group, '#e9dcc7', x, h + 0.15, 0, 5.9, 0.3, 8.4);
    box(group, '#47616a', x, h + 0.48, 0, 5.3, 0.38, 7.8);
    box(group, '#f7dfba', x, 0.4, 0, 5.7, 0.8, 8.1);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      box(group, '#fff0d2', x - side * 2.78, 2 + row * 2.1, -2.6 + col * 2.6, 0.10, 1.65, 1.25);
      box(group, '#4e879b', x - side * 2.84, 2 + row * 2.1, -2.6 + col * 2.6, 0.03, 1.4, 0.97);
      box(group, '#f8e6c9', x - side * 2.87, 2 + row * 2.1, -2.6 + col * 2.6, 0.03, 0.08, 0.97);
    }
  }
  for (let i = 0; i < 8; i++) {
    const group = new THREE.Group(); group.userData.baseZ = -i * 14;
    for (const side of [-1, 1]) {
      building(group, side, i);
      tree(group, side * 6.7, 3.5, 0.85 + (i % 3) * 0.12);
      box(group, '#364c54', side * 5.5, 1.9, -1, 0.10, 3.8, 0.10);
      box(group, '#f9e4ae', side * 5.5, 3.85, -1, 0.38, 0.46, 0.38);
      box(group, '#a41e36', side * 5.25, 2.8, -1, 0.6, 1.15, 0.04);
      box(group, '#f6e8d4', side * 5.25, 2.8, -0.97, 0.07, 0.55, 0.02);
      if (i % 2 === 0) {
        box(group, '#bc743c', side * 5.5, 0.65, 6, 0.65, 0.13, 1.7);
        box(group, '#bc743c', side * 5.8, 1.05, 6, 0.12, 0.7, 1.7);
        for (const z of [5.4, 6.6]) box(group, '#435055', side * 5.5, 0.3, z, 0.5, 0.55, 0.1);
      }
    }
    scene.add(group); decor.push(group);
  }
  // Landmark tower on the horizon; distinct from the repeating street blocks.
  const tower = new THREE.Group(); tower.position.set(13, 0, -95);
  box(tower, '#d69878', 0, 7.5, 0, 4.5, 15, 4.5);
  box(tower, '#f4debb', 0, 13.5, 0, 4.8, 0.45, 4.8);
  const roof = mesh(tower, new THREE.ConeGeometry(4, 5, 4), '#386276', 0, 17.7, 0); roof.rotation.y = Math.PI / 4;
  const clock = mesh(tower, new THREE.CircleGeometry(1.15, 24), '#fff3cc', 0, 11.3, 2.28);
  box(tower, '#4e5b66', 0, 11.65, 2.31, 0.1, 0.7, 0.02);
  box(tower, '#4e5b66', 0.28, 11.3, 2.31, 0.6, 0.1, 0.02);
  scene.add(tower);
  const cloudGeometry = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 7; i++) {
    const c = mesh(scene, cloudGeometry, '#fffdf0', -36 + i * 12, 21 + (i % 2) * 3, -65 - (i % 3) * 8);
    c.scale.set(5, 1.3, 2.5);
  }

  const avatar = new THREE.Group(); scene.add(avatar);
  const body = new THREE.Group(); avatar.add(body);
  box(body, '#e3333d', 0, 1.20, 0, 0.65, 0.7, 0.4, true);
  box(body, '#bc2436', 0, 1.3, 0.24, 0.48, 0.50, 0.17, true); // hood/back
  box(body, '#f36b49', 0, 1.3, 0.335, 0.06, 0.4, 0.015);
  box(body, '#243548', 0, 0.82, 0, 0.55, 0.22, 0.35, true);
  mesh(body, new THREE.IcosahedronGeometry(0.30, 1), '#ad714b', 0, 1.82, 0, true);
  const hairGeometry = new THREE.DodecahedronGeometry(0.13, 0);
  for (let i = 0; i < 11; i++) {
    const angle = i * 2.399;
    mesh(body, hairGeometry, '#382b28', Math.cos(angle) * 0.24, 2.01 + (i % 3) * 0.02, Math.sin(angle) * 0.22, true);
  }
  const limbs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.43, 1.43, 0); body.add(arm);
    box(arm, '#df303b', 0, -0.2, 0, 0.21, 0.48, 0.23, true);
    box(arm, '#ad714b', 0, -0.47, -0.03, 0.18, 0.20, 0.18, true);
    limbs.push(arm);
    const leg = new THREE.Group(); leg.position.set(side * 0.18, 0.78, 0); body.add(leg);
    box(leg, '#27394f', 0, -0.30, 0, 0.23, 0.6, 0.25, true);
    box(leg, '#f5f1e4', 0, -0.64, -0.1, 0.25, 0.19, 0.42, true);
    box(leg, '#db3944', 0, -0.60, -0.06, 0.26, 0.08, 0.27);
    limbs.push(leg);
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: '#1c3449', transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.05; scene.add(shadow);

  const coinGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.10, 12);
  const coinFace = new THREE.CylinderGeometry(0.23, 0.23, 0.115, 12);
  const objectMeshes = new Map<number, THREE.Group>();
  const pools: Record<string, THREE.Group[]> = { coin: [], block: [], hurdle: [], gate: [] };
  function createObject(kind: string) {
    const g = new THREE.Group(); g.userData.kind = kind;
    if (kind === 'coin') {
      const rim = mesh(g, coinGeometry, '#ffa600', 0, 0, 0); rim.rotation.x = Math.PI / 2;
      const face = mesh(g, coinFace, '#ffdc39', 0, 0, 0); face.rotation.x = Math.PI / 2;
      box(g, '#fff1a6', 0, 0, 0.063, 0.05, 0.28, 0.012);
    } else if (kind === 'block') {
      box(g, '#ed6b20', 0, 1.15, 0, 1.72, 2.3, 1.35, true);
      box(g, '#ffa52c', 0, 2.33, 0, 1.8, 0.15, 1.45, true);
      box(g, '#fff4d7', 0, 1.18, 0.686, 1.6, 0.45, 0.035);
      for (const x of [-0.5, 0, 0.5]) { const stripe = box(g, '#e76325', x, 1.18, 0.71, 0.20, 0.50, 0.015); stripe.rotation.z = -0.5; }
      box(g, '#a14524', 0, 0.12, 0, 1.85, 0.24, 1.5);
    } else {
      const gate = kind === 'gate';
      for (const side of [-1, 1]) {
        box(g, gate ? '#245d88' : '#646471', side * 0.86, gate ? 1.12 : 0.45, 0, 0.13, gate ? 2.24 : 0.9, 0.18, true);
        box(g, '#394753', side * 0.86, 0.1, 0, 0.35, 0.2, 0.65);
      }
      box(g, gate ? '#208fc7' : '#e64a3c', 0, gate ? 1.75 : 0.65, 0, 1.85, gate ? 1.3 : 0.5, 0.36, true);
      for (const x of [-0.62, 0, 0.62]) {
        const stripe = box(g, '#f2f2dc', x, gate ? 1.72 : 0.65, 0.19, 0.24, gate ? 0.5 : 0.44, 0.015);
        stripe.rotation.z = gate ? 0 : -0.45;
      }
    }
    return g;
  }
  let viewW = 0, viewH = 0;
  let idleDistance = 0;
  const demoObjects = [
    { id: -1, kind: 'block', lane: -1, z: 12, done: false },
    { id: -2, kind: 'hurdle', lane: 0, z: 27, done: false },
    { id: -3, kind: 'gate', lane: 1, z: 45, done: false },
    ...Array.from({ length: 7 }, (_, i) => ({ id: -10 - i, kind: 'coin', lane: 1, z: 6 + i * 2.3, done: false }))
  ];

  function render(s: Runner, dt: number, time: number, idle: boolean) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (width < 1 || height < 1) return;
    if (viewW !== width || viewH !== height) {
      viewW = width; viewH = height; renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = camera.aspect < 1 ? 62 : 55;
      camera.position.set(0, 4.4, camera.aspect < 1 ? 10.5 : 8.3);
      camera.lookAt(0, 1.1, -14); camera.updateProjectionMatrix();
    }
    if (idle) idleDistance += Math.min(dt, 0.05) * 3;
    const distance = idle ? idleDistance : s.distance;
    for (const m of marks) m.position.z = ((m.userData.baseZ + distance) % 110 + 110) % 110 - 102;
    for (const d of decor) d.position.z = ((d.userData.baseZ + distance) % 112 + 112) % 112 - 104;
    avatar.position.set(s.x, s.y + 0.06, 0);
    avatar.rotation.z = THREE.MathUtils.lerp(avatar.rotation.z, -(s.lane * RUNNER.laneWidth - s.x) * 0.08, 0.15);
    body.scale.y = THREE.MathUtils.lerp(body.scale.y, s.duck && s.y < 0.1 ? 0.46 : 1, 0.25);
    body.rotation.x = s.duck && s.y < 0.1 ? -0.24 : 0;
    const running = idle || s.phase === 'running';
    const stride = Math.sin(distance * 1.65) * (running ? 0.7 : 0.08);
    limbs[0].rotation.x = stride; limbs[1].rotation.x = -stride;
    limbs[2].rotation.x = -stride; limbs[3].rotation.x = stride;
    if (s.y > 0.05) { limbs[1].rotation.x = -0.65; limbs[3].rotation.x = 0.6; }
    body.position.y = running && s.y === 0 ? Math.abs(Math.sin(distance * 1.65)) * 0.045 : 0;
    shadow.position.x = s.x;
    shadow.scale.setScalar(1 - Math.min(0.4, s.y * 0.15));
    const activeObjects = idle ? demoObjects : s.objects;
    const ids = new Set(activeObjects.filter(o => !(o.kind === 'coin' && o.done)).map(o => o.id));
    for (const [id, g] of objectMeshes) if (!ids.has(id)) {
      scene.remove(g); pools[g.userData.kind].push(g); objectMeshes.delete(id);
    }
    for (const o of activeObjects) {
      if (!ids.has(o.id)) continue;
      let g = objectMeshes.get(o.id);
      if (!g) { g = pools[o.kind].pop() ?? createObject(o.kind); objectMeshes.set(o.id, g); scene.add(g); }
      g.position.set(o.lane * RUNNER.laneWidth, o.kind === 'coin' ? 1.05 + Math.sin(time * 3 + o.id) * 0.08 : 0.05, -o.z);
      g.rotation.y = o.kind === 'coin' ? time * 2.6 : 0;
      g.visible = true;
    }
    renderer.render(scene, camera);
  }
  function dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const allMaterials = new Set<THREE.Material>();
    const collect = (o: THREE.Object3D) => { if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry); const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => allMaterials.add(x));
    } };
    scene.traverse(collect);
    Object.values(pools).flat().forEach(g => g.traverse(collect));
    geometries.forEach(g => g.dispose()); allMaterials.forEach(m => m.dispose());
    cube.dispose(); renderer.dispose();
  }
  return { render, dispose };
}
