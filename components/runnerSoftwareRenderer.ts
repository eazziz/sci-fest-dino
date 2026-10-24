import * as THREE from 'three';

// A small Canvas2D fallback for machines where WebGL cannot be created. It draws
// the same low-poly meshes and animations; gameplay and camera controls are shared.
export function createSoftwareRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas rendering unavailable');
  let width = 1, height = 1;
  const viewMatrix = new THREE.Matrix4(), modelView = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const light = new THREE.Vector3(-.5, 1, .4).normalize();
  type Face = { points: number[][]; depth: number; color: string; opacity: number; floor: number };
  const faces: Face[] = [];
  function clipped(points: THREE.Vector3[], near: number) {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      const pin = p.z <= -near, qin = q.z <= -near;
      if (pin) out.push(p);
      if (pin !== qin) { const t = (-near - p.z) / (q.z - p.z); out.push(new THREE.Vector3(p.x + t*(q.x-p.x), p.y+t*(q.y-p.y), -near)); }
    }
    return out;
  }
  return {
    shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
    outputColorSpace: THREE.SRGBColorSpace,
    setPixelRatio: (_ratio: number) => {},
    setSize(w: number, h: number, _style: boolean) {
      // Bound software pixel fill while CSS preserves the display size.
      const ratio = Math.min(1, 900 / w);
      width = canvas.width = Math.round(w * ratio); height = canvas.height = Math.round(h * ratio);
    },
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
      const bg = scene.background instanceof THREE.Color ? scene.background : new THREE.Color('#9bdcf4');
      ctx.fillStyle = '#' + bg.getHexString(); ctx.globalAlpha = 1; ctx.fillRect(0, 0, width, height);
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      viewMatrix.copy(camera.matrixWorldInverse);
      const fx = camera.projectionMatrix.elements[0], fy = camera.projectionMatrix.elements[5];
      faces.length = 0;
      scene.traverseVisible(obj => {
        if (!(obj instanceof THREE.Mesh)) return;
        const material = (Array.isArray(obj.material) ? obj.material[0] : obj.material) as THREE.MeshLambertMaterial;
        if (!material.visible) return;
        const pos = obj.geometry.getAttribute('position'), index = obj.geometry.index;
        if (!pos) return;
        modelView.multiplyMatrices(viewMatrix, obj.matrixWorld);
        normalMatrix.getNormalMatrix(obj.matrixWorld);
        const count = index ? index.count : pos.count;
        for (let i = 0; i < count; i += 3) {
          a.fromBufferAttribute(pos, index ? index.getX(i) : i);
          b.fromBufferAttribute(pos, index ? index.getX(i+1) : i+1);
          c.fromBufferAttribute(pos, index ? index.getX(i+2) : i+2);
          ab.subVectors(b,a); ac.subVectors(c,a); n.crossVectors(ab,ac).normalize().applyMatrix3(normalMatrix).normalize();
          const brightness = material instanceof THREE.MeshBasicMaterial ? 1 : .63 + .37 * Math.max(0,n.dot(light));
          a.applyMatrix4(modelView); b.applyMatrix4(modelView); c.applyMatrix4(modelView);
          ab.subVectors(b,a); ac.subVectors(c,a); n.crossVectors(ab,ac);
          if (n.dot(a) >= 0 && material.side !== THREE.DoubleSide) continue;
          const depth = -(a.z+b.z+c.z)/3;
          if (depth > camera.far || Math.max(a.z,b.z,c.z) < -camera.far) continue;
          const polygon = clipped([a.clone(),b.clone(),c.clone()], camera.near);
          if (polygon.length < 3) continue;
          const projected = polygon.map(p => [(p.x / -p.z * fx + 1) * width / 2, (1 - p.y / -p.z * fy) * height / 2]);
          if (projected.every(p=>p[0]<0) || projected.every(p=>p[0]>width) || projected.every(p=>p[1]<0) || projected.every(p=>p[1]>height)) continue;
          const color = material.color.clone().multiplyScalar(brightness);
          const fog = scene.fog as THREE.Fog;
          if (fog && !obj.userData.floor) color.lerp(fog.color, Math.max(0,Math.min(1,(depth-fog.near)/(fog.far-fog.near))));
          faces.push({points: projected, depth, color: '#'+color.getHexString(), opacity: material.opacity,
            floor: obj.userData.floor ?? 0});
        }
      });
      faces.sort((a,b)=>a.floor-b.floor || b.depth-a.depth);
      for (const f of faces) {
        ctx.globalAlpha = f.opacity; ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.moveTo(f.points[0][0], f.points[0][1]);
        for (let j=1;j<f.points.length;j++) ctx.lineTo(f.points[j][0],f.points[j][1]);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha=1;
    },
    dispose() {},
  };
}
