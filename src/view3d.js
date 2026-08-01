import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { pointsToMesh } from './meshify.js';

/**
 * 컨테이너 엘리먼트에 Three.js 기반 3D 포인트 클라우드 / 메쉬 orbit 뷰어를 만든다.
 * @param {HTMLElement} container
 */
export function createView3D(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
  camera.up.set(0, 0, 1); // z-up: PCD의 z(높이)를 위쪽으로

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const grid = new THREE.GridHelper(20, 20, 0x444455, 0x2a2a33);
  grid.rotation.x = Math.PI / 2; // xy 평면에 맞춤 (z-up)
  scene.add(grid);
  scene.add(new THREE.AxesHelper(2));

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, -4, 6);
  scene.add(ambientLight, dirLight);

  let pointCloud = null;
  let meshObject = null;
  let currentPoints = [];
  let resizeObserver;

  function resize() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let running = true;
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function frameCamera(points) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }
    const center = new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);

    controls.target.copy(center);
    camera.position.set(
      center.x + size * 0.8,
      center.y - size * 1.2,
      center.z + size * 0.9
    );
    controls.update();
  }

  function rebuildPointCloud(points) {
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      colors[i * 3] = p.r / 255;
      colors[i * 3 + 1] = p.g / 255;
      colors[i * 3 + 2] = p.b / 255;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    if (pointCloud) {
      scene.remove(pointCloud);
      pointCloud.geometry.dispose();
      pointCloud.material.dispose();
    }
    pointCloud = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.03, vertexColors: true })
    );
    scene.add(pointCloud);
  }

  /** 새 포인트 세트를 뷰에 반영한다 (점군 표시 + 카메라 정렬). 메쉬는 다음 변환 시까지 초기화된다. */
  function setPoints(points) {
    currentPoints = points;
    rebuildPointCloud(points);
    if (meshObject) {
      scene.remove(meshObject);
      meshObject.geometry.dispose();
      meshObject.material.dispose();
      meshObject = null;
    }
    frameCamera(points);
    setDisplayMode('points');
  }

  /** 현재 로드된 포인트로 마칭 큐브 메쉬를 생성해 표시한다. */
  function convertToMesh(options) {
    if (!currentPoints.length) {
      throw new Error('변환할 포인트가 없습니다. 먼저 PCD를 로드하세요.');
    }
    const mesh = pointsToMesh(currentPoints, options);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));

    if (meshObject) {
      scene.remove(meshObject);
      meshObject.geometry.dispose();
      meshObject.material.dispose();
    }
    meshObject = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide })
    );
    scene.add(meshObject);
    setDisplayMode('mesh');

    return { triangleCount: mesh.triangleCount, vertexCount: mesh.vertexCount, grid: mesh.grid };
  }

  function setDisplayMode(mode) {
    if (pointCloud) pointCloud.visible = mode === 'points';
    if (meshObject) meshObject.visible = mode === 'mesh';
  }

  function dispose() {
    running = false;
    resizeObserver.disconnect();
    controls.dispose();
    renderer.dispose();
    if (pointCloud) {
      pointCloud.geometry.dispose();
      pointCloud.material.dispose();
    }
    if (meshObject) {
      meshObject.geometry.dispose();
      meshObject.material.dispose();
    }
    container.removeChild(renderer.domElement);
  }

  return {
    setPoints,
    convertToMesh,
    setDisplayMode,
    resize,
    dispose,
  };
}
