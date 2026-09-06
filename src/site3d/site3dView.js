// 지도 › 3D "현장 3D" -- pathfinder 안의 three.js 장면. 시뮬레이터 viewer.html 의 3D 장면을 옮겨 와서
// 데이터를 이 앱의 소스에서 직접 먹인다:
//   · 벽/가구  : importedObstacleSource (from-slicemap 이 만든 kind:block 사각형, category wall|furniture) -> 인스턴스 박스
//   · 바닥     : activeProjectFloorImage (정합 워크스페이스가 합성한 floorplan) -> 텍스처 평면
//   · 스캔 메시: activeProjectSlicemap.sources (스캔별 offsetX/offsetZ/yaw) + origin -> scan-engine 의 overlay.glb
//   · 로봇     : /api/vda5050/stream (실기·시뮬 구분 없이 VDA5050 위치와 상태) -> 실린더 + 방향 노즈 + 라벨
// 좌표: 프로젝트 평면 (x, y) -> three (X, Y, Z) = (x, 높이, -y). 정합 규약은 studio/merge_slicemaps.py 와 같다
// (평면 (x,y) = (x_arkit, -z_arkit); yaw CCW 회전 후 (offsetX, -offsetZ) 이동; 격자 모서리 = 평면 원점).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { subscribeFleetStream } from '../fleet/fleetApi.js';
import { listRobots } from '../robots/robotApi.js';

const WALL = {
  wall: { h: 0.5, color: 0xe7ecf3, opacity: 0.95 },
  furniture: { h: 0.3, color: 0xf5a623, opacity: 0.9 },
};
const ROBOT_R = 0.11;
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

/**
 * @param {HTMLElement} container
 * @param {{ obstacleSource: import('ol/source/Vector.js').default, floorImage: {url: string, extent: number[]} | null,
 *           slicemap: { origin: number[], sources?: any[] } | null, sizeX: number, sizeY: number, scanFileUrl: (scan: string, file: string) => string }} opts
 */
export function createSite3D(container, { obstacleSource, floorImage, slicemap, sizeX, sizeY, scanFileUrl }) {
  container.classList.add('site3d');
  const bar = el('div', 'site3d__bar');
  const canvas = document.createElement('canvas');
  canvas.className = 'site3d__canvas';
  container.append(bar, canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.05, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.1; controls.maxPolarAngle = Math.PI / 2 - 0.02; controls.screenSpacePanning = false;
  scene.add(new THREE.HemisphereLight(0xdfe7f5, 0x1a212c, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(6, 14, 8); scene.add(sun);

  // ---- 정적: 바닥 · 격자 · 벽 ------------------------------------------------------------
  const staticGroup = new THREE.Group(); scene.add(staticGroup);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeY), new THREE.MeshStandardMaterial({ color: 0x121722, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(sizeX / 2, -0.003, -sizeY / 2); staticGroup.add(ground);
  {
    const pts = [];
    for (let x = 0; x <= sizeX + 1e-9; x += 1) pts.push(x, 0.001, 0, x, 0.001, -sizeY);
    for (let y = 0; y <= sizeY + 1e-9; y += 1) pts.push(0, 0.001, -y, sizeX, 0.001, -y);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    staticGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x232b38 })));
  }
  if (floorImage?.url && floorImage.extent) {
    const [x0, y0, x1, y1] = floorImage.extent;
    new THREE.TextureLoader().load(floorImage.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, transparent: true, opacity: 0.92 }));
      plane.rotation.x = -Math.PI / 2; plane.position.set((x0 + x1) / 2, 0.002, -(y0 + y1) / 2); staticGroup.add(plane);
    });
  }

  let wallGroup = null;
  const wallMats = [];
  function rebuildWalls() {
    if (wallGroup) { staticGroup.remove(wallGroup); wallGroup.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    wallMats.length = 0;
    wallGroup = new THREE.Group();
    const byCat = { wall: [], furniture: [] };
    for (const f of obstacleSource.getFeatures()) {
      const geom = f.getGeometry(); if (!geom) continue;
      const cat = f.get('category') === 'wall' ? 'wall' : 'furniture';
      byCat[cat].push(geom.getExtent());
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4();
    for (const [cat, rects] of Object.entries(byCat)) {
      if (!rects.length) continue;
      const spec = WALL[cat];
      const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.85, metalness: 0.05, transparent: true, opacity: spec.opacity });
      wallMats.push({ mat, opacity: spec.opacity });
      const inst = new THREE.InstancedMesh(unit, mat, rects.length);
      rects.forEach(([x0, y0, x1, y1], i) => {
        m4.compose(new THREE.Vector3((x0 + x1) / 2, spec.h / 2, -(y0 + y1) / 2), new THREE.Quaternion(), new THREE.Vector3(Math.max(x1 - x0, 0.02), spec.h, Math.max(y1 - y0, 0.02)));
        inst.setMatrixAt(i, m4);
      });
      inst.instanceMatrix.needsUpdate = true;
      wallGroup.add(inst);
    }
    staticGroup.add(wallGroup);
    applyWallDim();
  }

  // ---- 스캔 메시 (scan-engine overlay.glb, 스튜디오 Z-up) ------------------------------------
  const meshGroup = new THREE.Group(); scene.add(meshGroup);
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.8);
  const meshMats = new Set();
  let meshesVisible = true;
  const meshStat = el('span', 'site3d__stat');
  function estimateFloorZ(root) {
    const zs = [];
    root.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position; const step = Math.max(1, Math.floor(a.count / 60000)); for (let i = 0; i < a.count; i += step) zs.push(a.getZ(i)); });
    if (zs.length < 100) return 0;
    zs.sort((a, b) => a - b);
    const lo = zs[Math.floor(zs.length * 0.01)], bin = 0.02, bins = new Map();
    for (const z of zs) { if (z < lo || z > lo + 0.8) continue; const k = Math.round((z - lo) / bin); bins.set(k, (bins.get(k) ?? 0) + 1); }
    let bestK = 0, bestN = -1; for (const [k, n] of bins) if (n > bestN) { bestN = n; bestK = k; }
    return lo + bestK * bin;
  }
  function applyWallDim() {
    const dim = meshesVisible && meshGroup.children.length > 0;
    for (const { mat, opacity } of wallMats) { mat.opacity = dim ? Math.min(opacity, 0.25) : opacity; mat.depthWrite = !dim; }
  }
  function loadMeshes() {
    const sources = (slicemap?.sources ?? []).filter((s) => s && s.scan);
    if (!sources.length) { meshStat.textContent = '스캔 메시 없음'; return; }
    const [ox, oy] = slicemap.origin ?? [0, 0];
    const loader = new GLTFLoader();
    let done = 0;
    meshStat.textContent = `메시 0/${sources.length}`;
    for (const m of sources) {
      loader.load(scanFileUrl(m.scan, 'overlay.glb'), (gltf) => {
        const root = gltf.scene;
        const drop = []; root.traverse((o) => { if (o.isPoints) drop.push(o); }); drop.forEach((o) => o.parent?.remove(o));
        root.rotation.x = -Math.PI / 2;
        root.position.y = -estimateFloorZ(root);
        root.traverse((o) => {
          if (!o.isMesh) return;
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!mat.map && !o.geometry.attributes.color) { mat.color.setHex(0xb9ad9a); mat.flatShading = true; mat.needsUpdate = true; }
            mat.side = THREE.DoubleSide; mat.clippingPlanes = [cutPlane]; mat.transparent = true; meshMats.add(mat);
          }
        });
        const holder = new THREE.Group(); holder.add(root);
        holder.rotation.y = m.yawRadians ?? 0;
        holder.position.set((m.offsetX ?? 0) - ox, 0, (m.offsetZ ?? 0) + oy);
        holder.visible = meshesVisible;
        meshGroup.add(holder);
        done++; meshStat.textContent = `메시 ${done}/${sources.length}`;
        applyWallDim();
      }, undefined, () => { done++; meshStat.textContent = `메시 로드 실패: ${m.scan}`; });
    }
  }
  loadMeshes();
  // 벽은 메시 상태(meshesVisible)를 참조하므로 메시 선언 뒤에 처음 그린다
  rebuildWalls();
  obstacleSource.on('change', () => { clearTimeout(rebuildWalls._t); rebuildWalls._t = setTimeout(rebuildWalls, 150); });

  // ---- 로봇 (VDA5050 플릿 스트림) ------------------------------------------------------------
  const robots = new Map(); // serial -> { group, mat, label }
  const bodyGeo = new THREE.CylinderGeometry(ROBOT_R, ROBOT_R, 0.19, 28);
  const noseGeo = new THREE.BoxGeometry(0.07, 0.05, 0.05);
  let registry = new Map();
  listRobots().then((all) => { registry = new Map(all.filter((r) => r.vda5050Serial).map((r) => [r.vda5050Serial, r])); for (const [serial, r] of robots) r.label.material.map = makeLabelTexture(registry.get(serial)?.name ?? serial); }).catch(() => {});
  function makeLabelTexture(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d'); ctx.font = '600 28px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(11,14,19,0.75)'; const w = Math.min(250, ctx.measureText(text).width + 24); ctx.beginPath(); ctx.roundRect((256 - w) / 2, 8, w, 48, 10); ctx.fill();
    ctx.fillStyle = '#e7ecf3'; ctx.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function robotEntry(serial) {
    let r = robots.get(serial); if (r) return r;
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b96a8, roughness: 0.6, metalness: 0.1 });
    const body = new THREE.Mesh(bodyGeo, mat); body.position.y = 0.095;
    const nose = new THREE.Mesh(noseGeo, new THREE.MeshStandardMaterial({ color: 0xe7ecf3, roughness: 0.5 })); nose.position.set(0.1, 0.2, 0);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(registry.get(serial)?.name ?? serial), depthTest: false, transparent: true }));
    label.scale.set(0.9, 0.225, 1); label.position.y = 0.42;
    const group = new THREE.Group(); group.add(body, nose, label); scene.add(group);
    r = { group, mat, label }; robots.set(serial, r); return r;
  }
  function applyRobot(rec) {
    if (!rec?.position || typeof rec.position.x !== 'number') return;
    const r = robotEntry(rec.serialNumber);
    r.group.position.set(rec.position.x, 0, -rec.position.y);
    r.group.rotation.y = rec.position.theta ?? 0;
    const st = rec.state;
    const online = rec.connectionState === 'ONLINE';
    const color = !online ? 0x525c6c : (st?.safetyState?.eStop ?? 'NONE') !== 'NONE' ? 0xef4444 : st?.paused ? 0xf5a623 : st?.driving ? 0x34d399 : 0x4fd1c5;
    r.mat.color.setHex(color);
    r.group.visible = true;
  }
  const stream = subscribeFleetStream((msg) => {
    if (msg.type === 'snapshot') { for (const r of msg.robots) applyRobot(r); }
    else if (msg.type === 'robot') applyRobot(msg.robot);
    else if (msg.type === 'forget') { for (const [serial, r] of robots) if (msg.key?.endsWith(`/${serial}`) || msg.key === serial) { scene.remove(r.group); robots.delete(serial); } }
  });

  // ---- 툴바 -------------------------------------------------------------------------------
  function lookAt(target, dist, preset) {
    controls.target.copy(target);
    const off = preset === 'top' ? new THREE.Vector3(0, dist, 0.0001 * dist) : new THREE.Vector3(0, dist * 0.7, dist * 0.75);
    camera.position.copy(target).add(off); camera.lookAt(target); controls.update();
  }
  const center = new THREE.Vector3(sizeX / 2, 0, -sizeY / 2);
  const btn = (text, title, onClick) => { const b = el('button', 'robot-button', text); b.title = title; b.addEventListener('click', onClick); return b; };
  const meshBtn = btn('스캔 메시', 'iPhone 스캔 메시(overlay.glb) 표시', () => { meshesVisible = !meshesVisible; meshBtn.classList.toggle('active', meshesVisible); for (const c of meshGroup.children) c.visible = meshesVisible; applyWallDim(); });
  meshBtn.classList.add('active');
  const cut = document.createElement('input'); cut.type = 'range'; cut.min = '0.3'; cut.max = '3'; cut.step = '0.05'; cut.value = '1.8'; cut.title = '절단 높이 (천장 제거)';
  const cutV = el('span', 'site3d__stat', '1.8 m');
  cut.addEventListener('input', () => { cutPlane.constant = Number(cut.value); cutV.textContent = `${Number(cut.value).toFixed(2)} m`; });
  bar.append(
    btn('기본 시점', '3/4 시점으로', () => lookAt(center.clone(), Math.max(sizeX, sizeY) * 0.9, 'iso')),
    btn('탑뷰', '위에서 내려다보기', () => lookAt(center.clone(), Math.max(sizeX, sizeY) * 0.9, 'top')),
    el('span', 'site3d__spacer'),
    meshBtn, el('span', 'site3d__label', '절단'), cut, cutV, meshStat,
  );
  lookAt(center.clone(), Math.max(sizeX, sizeY) * 0.9, 'iso');

  // ---- 루프 -------------------------------------------------------------------------------
  function fitSize() {
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 480;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }
  let running = true;
  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    if (container.offsetParent === null) return; // 숨겨진 탭이면 그리지 않음
    fitSize(); controls.update(); renderer.render(scene, camera);
  }
  tick();

  return {
    resize: fitSize,
    destroy() { running = false; stream.close(); renderer.dispose(); },
  };
}
