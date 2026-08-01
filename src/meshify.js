// 컬러드 포인트 클라우드(PCD 파싱 결과)를 3D 메쉬(삼각형 스프)로 변환한다.
// 알고리즘: 점 -> 복셀 밀도 필드(occupancy) -> 마칭 큐브 등위면 추출.
// 마칭 큐브의 edgeTable/triTable은 손으로 옮겨적지 않고 three.js가 제공하는
// 검증된 테이블(Paul Bourke / Cory Bloyd 표)을 그대로 재사용한다.
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

/**
 * @param {Array<{x:number,y:number,z:number,r:number,g:number,b:number}>} points
 * @param {{ voxelSize?: number, isoLevel?: number, pad?: number }} [options]
 * @returns {{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   colors: Float32Array,
 *   vertexCount: number,
 *   triangleCount: number,
 *   grid: { nx: number, ny: number, nz: number, voxelSize: number },
 * }}
 */
export function pointsToMesh(points, options = {}) {
  const voxelSize = options.voxelSize ?? 0.08;
  const isoLevel = options.isoLevel ?? 0.5;
  const pad = options.pad ?? 2;

  if (points.length === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Float32Array(0),
      vertexCount: 0,
      triangleCount: 0,
      grid: { nx: 0, ny: 0, nz: 0, voxelSize },
    };
  }

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

  const originX = minX - pad * voxelSize;
  const originY = minY - pad * voxelSize;
  const originZ = minZ - pad * voxelSize;
  const nx = Math.ceil((maxX - minX) / voxelSize) + 1 + 2 * pad;
  const ny = Math.ceil((maxY - minY) / voxelSize) + 1 + 2 * pad;
  const nz = Math.ceil((maxZ - minZ) / voxelSize) + 1 + 2 * pad;
  const yd = nx;
  const zd = nx * ny;
  const cornerCount = nx * ny * nz;

  // 1) 점들을 가장 가까운 격자 코너에 스플랫: 밀도(개수) + 색상 합
  const density = new Float32Array(cornerCount);
  const colorSum = new Float32Array(cornerCount * 3);

  const clampIdx = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (const p of points) {
    const ix = clampIdx(Math.round((p.x - originX) / voxelSize), nx);
    const iy = clampIdx(Math.round((p.y - originY) / voxelSize), ny);
    const iz = clampIdx(Math.round((p.z - originZ) / voxelSize), nz);
    const idx = ix + iy * yd + iz * zd;
    density[idx] += 1;
    colorSum[idx * 3] += p.r;
    colorSum[idx * 3 + 1] += p.g;
    colorSum[idx * 3 + 2] += p.b;
  }

  // 2) 1칸 팽창(dilate): 격자 해상도가 점 간격보다 성긴 경우에도 표면이 끊기지 않도록
  //    3x3x3 이웃 중 밀도가 가장 큰 코너의 값/색을 가져온다.
  const dDensity = new Float32Array(cornerCount);
  const dColor = new Float32Array(cornerCount * 3);
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = ix + iy * yd + iz * zd;
        let best = density[idx];
        let bestIdx = idx;
        for (let dz = -1; dz <= 1; dz++) {
          const nzc = iz + dz;
          if (nzc < 0 || nzc >= nz) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const nyc = iy + dy;
            if (nyc < 0 || nyc >= ny) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nxc = ix + dx;
              if (nxc < 0 || nxc >= nx) continue;
              const nIdx = nxc + nyc * yd + nzc * zd;
              if (density[nIdx] > best) {
                best = density[nIdx];
                bestIdx = nIdx;
              }
            }
          }
        }
        dDensity[idx] = best;
        if (best > 0) {
          dColor[idx * 3] = colorSum[bestIdx * 3] / density[bestIdx];
          dColor[idx * 3 + 1] = colorSum[bestIdx * 3 + 1] / density[bestIdx];
          dColor[idx * 3 + 2] = colorSum[bestIdx * 3 + 2] / density[bestIdx];
        }
      }
    }
  }

  // 3) 마칭 큐브로 등위면 추출 (비인덱스 삼각형 스프로 출력)
  const positions = [];
  const colors = [];
  const vlist = new Float32Array(12 * 3);
  const clist = new Float32Array(12 * 3);

  const worldX = (ix) => originX + ix * voxelSize;
  const worldY = (iy) => originY + iy * voxelSize;
  const worldZ = (iz) => originZ + iz * voxelSize;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function interpEdge(offset, val1, val2, x1, y1, z1, x2, y2, z2, idx1, idx2) {
    const denom = val2 - val1;
    const mu = Math.abs(denom) < 1e-9 ? 0.5 : (isoLevel - val1) / denom;
    vlist[offset] = lerp(x1, x2, mu);
    vlist[offset + 1] = lerp(y1, y2, mu);
    vlist[offset + 2] = lerp(z1, z2, mu);
    clist[offset] = lerp(dColor[idx1 * 3], dColor[idx2 * 3], mu);
    clist[offset + 1] = lerp(dColor[idx1 * 3 + 1], dColor[idx2 * 3 + 1], mu);
    clist[offset + 2] = lerp(dColor[idx1 * 3 + 2], dColor[idx2 * 3 + 2], mu);
  }

  for (let iz = 0; iz < nz - 1; iz++) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const q = ix + iy * yd + iz * zd;
        const q1 = q + 1;
        const qy = q + yd;
        const qz = q + zd;
        const q1y = q1 + yd;
        const q1z = q1 + zd;
        const qyz = q + yd + zd;
        const q1yz = q1 + yd + zd;

        const f0 = dDensity[q];
        const f1 = dDensity[q1];
        const f2 = dDensity[qy];
        const f3 = dDensity[q1y];
        const f4 = dDensity[qz];
        const f5 = dDensity[q1z];
        const f6 = dDensity[qyz];
        const f7 = dDensity[q1yz];

        let cubeindex = 0;
        if (f0 < isoLevel) cubeindex |= 1;
        if (f1 < isoLevel) cubeindex |= 2;
        if (f2 < isoLevel) cubeindex |= 8;
        if (f3 < isoLevel) cubeindex |= 4;
        if (f4 < isoLevel) cubeindex |= 16;
        if (f5 < isoLevel) cubeindex |= 32;
        if (f6 < isoLevel) cubeindex |= 128;
        if (f7 < isoLevel) cubeindex |= 64;

        const bits = edgeTable[cubeindex];
        if (bits === 0) continue;

        const x = worldX(ix), x2 = worldX(ix + 1);
        const y = worldY(iy), y2 = worldY(iy + 1);
        const z = worldZ(iz), z2 = worldZ(iz + 1);

        if (bits & 1) interpEdge(0, f0, f1, x, y, z, x2, y, z, q, q1);
        if (bits & 2) interpEdge(3, f1, f3, x2, y, z, x2, y2, z, q1, q1y);
        if (bits & 4) interpEdge(6, f2, f3, x, y2, z, x2, y2, z, qy, q1y);
        if (bits & 8) interpEdge(9, f0, f2, x, y, z, x, y2, z, q, qy);
        if (bits & 16) interpEdge(12, f4, f5, x, y, z2, x2, y, z2, qz, q1z);
        if (bits & 32) interpEdge(15, f5, f7, x2, y, z2, x2, y2, z2, q1z, q1yz);
        if (bits & 64) interpEdge(18, f6, f7, x, y2, z2, x2, y2, z2, qyz, q1yz);
        if (bits & 128) interpEdge(21, f4, f6, x, y, z2, x, y2, z2, qz, qyz);
        if (bits & 256) interpEdge(24, f0, f4, x, y, z, x, y, z2, q, qz);
        if (bits & 512) interpEdge(27, f1, f5, x2, y, z, x2, y, z2, q1, q1z);
        if (bits & 1024) interpEdge(30, f3, f7, x2, y2, z, x2, y2, z2, q1y, q1yz);
        if (bits & 2048) interpEdge(33, f2, f6, x, y2, z, x, y2, z2, qy, qyz);

        const triOffset = cubeindex << 4;
        for (let i = 0; triTable[triOffset + i] !== -1; i += 3) {
          const a = triTable[triOffset + i] * 3;
          const b = triTable[triOffset + i + 1] * 3;
          const c = triTable[triOffset + i + 2] * 3;
          positions.push(
            vlist[a], vlist[a + 1], vlist[a + 2],
            vlist[b], vlist[b + 1], vlist[b + 2],
            vlist[c], vlist[c + 1], vlist[c + 2]
          );
          colors.push(
            clist[a] / 255, clist[a + 1] / 255, clist[a + 2] / 255,
            clist[b] / 255, clist[b + 1] / 255, clist[b + 2] / 255,
            clist[c] / 255, clist[c + 1] / 255, clist[c + 2] / 255
          );
        }
      }
    }
  }

  const positionsArr = new Float32Array(positions);
  const colorsArr = new Float32Array(colors);
  const vertexCount = positionsArr.length / 3;
  const normalsArr = new Float32Array(positionsArr.length);

  // 삼각형 단위 평면(flat) 노멀 계산
  for (let t = 0; t < vertexCount; t += 3) {
    const ax = positionsArr[t * 3], ay = positionsArr[t * 3 + 1], az = positionsArr[t * 3 + 2];
    const bx = positionsArr[(t + 1) * 3], by = positionsArr[(t + 1) * 3 + 1], bz = positionsArr[(t + 1) * 3 + 2];
    const cx = positionsArr[(t + 2) * 3], cy = positionsArr[(t + 2) * 3 + 1], cz = positionsArr[(t + 2) * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nxv = uy * vz - uz * vy;
    let nyv = uz * vx - ux * vz;
    let nzv = ux * vy - uy * vx;
    const len = Math.hypot(nxv, nyv, nzv) || 1;
    nxv /= len; nyv /= len; nzv /= len;
    for (let v = 0; v < 3; v++) {
      normalsArr[(t + v) * 3] = nxv;
      normalsArr[(t + v) * 3 + 1] = nyv;
      normalsArr[(t + v) * 3 + 2] = nzv;
    }
  }

  return {
    positions: positionsArr,
    normals: normalsArr,
    colors: colorsArr,
    vertexCount,
    triangleCount: vertexCount / 3,
    grid: { nx, ny, nz, voxelSize },
  };
}
