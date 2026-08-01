// 업로드 테스트용으로 크기/색/가구 배치가 서로 다른 랜덤 방 컬러드 PCD를 여러 개 생성한다.
// 사용법: node scripts/generate-random-pcd.mjs [개수]  (기본 3개)
import { jitter, colorJitter, writePcdAscii } from './pcd-lib.mjs';

const COUNT = Number(process.argv[2]) || 3;

const FLOOR_PALETTE = [
  [195, 195, 190], // 연회색 타일
  [150, 110, 70], // 원목마루
  [90, 90, 95], // 짙은 콘크리트
  [180, 160, 130], // 베이지 카펫
];
const WALL_PALETTE = [
  [222, 203, 164], // 베이지
  [235, 235, 230], // 화이트
  [140, 170, 160], // 민트 그레이
  [200, 180, 190], // 연핑크 그레이
];
const FURNITURE_PALETTE = [
  [120, 72, 40], // 원목 갈색
  [70, 70, 75], // 다크 그레이
  [60, 90, 120], // 네이비
  [150, 40, 40], // 버건디
];

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(randFloat(min, max + 1));
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function buildRoom() {
  const width = randFloat(5, 9);
  const depth = randFloat(4, 7);
  const height = randFloat(2.2, 3.0);
  const originX = randFloat(5, 150);
  const originY = randFloat(5, 150);

  const floorColor = pick(FLOOR_PALETTE);
  const wallColor = pick(WALL_PALETTE);

  const doorWall = pick(['south', 'north', 'east', 'west']);
  const doorLen = randFloat(0.8, 1.2);
  const doorAlong = doorWall === 'south' || doorWall === 'north' ? width : depth;
  const doorStart = randFloat(0.5, Math.max(0.6, doorAlong - doorLen - 0.5));
  const doorEnd = doorStart + doorLen;

  const points = [];
  function addPoint(x, y, z, color) {
    const [r, g, b] = colorJitter(color);
    points.push({ x: originX + x, y: originY + y, z, r, g, b });
  }

  // 바닥
  for (let x = 0; x <= width; x += 0.05) {
    for (let y = 0; y <= depth; y += 0.05) {
      addPoint(x + jitter(0.005), y + jitter(0.005), 0 + jitter(0.01), floorColor);
    }
  }

  // 벽 4면, doorWall에만 문 개구부를 뚫는다
  function wallSpan(along, isDoorWall, toXY) {
    for (let a = 0; a <= along; a += 0.05) {
      if (isDoorWall && a >= doorStart && a <= doorEnd) continue;
      for (let z = 0.05; z <= height; z += 0.05) {
        const [x, y] = toXY(a);
        addPoint(x, y, z + jitter(0.01), wallColor);
      }
    }
  }
  wallSpan(width, doorWall === 'south', (a) => [a, 0]);
  wallSpan(width, doorWall === 'north', (a) => [a, depth]);
  wallSpan(depth, doorWall === 'west', (a) => [0, a]);
  wallSpan(depth, doorWall === 'east', (a) => [width, a]);

  // 랜덤 가구 (책상형 박스 1~3개)
  const furnitureCount = randInt(1, 3);
  for (let i = 0; i < furnitureCount; i++) {
    const fw = randFloat(0.6, 1.6);
    const fd = randFloat(0.5, 1.0);
    const topZ = randFloat(0.4, 0.9);
    const fx = randFloat(0.5, Math.max(0.6, width - fw - 0.5));
    const fy = randFloat(0.5, Math.max(0.6, depth - fd - 0.5));
    const color = pick(FURNITURE_PALETTE);

    for (let x = 0; x <= fw; x += 0.03) {
      for (let y = 0; y <= fd; y += 0.03) {
        addPoint(fx + x, fy + y, topZ, color);
      }
    }
    const legOffsets = [
      [0.05, 0.05],
      [fw - 0.05, 0.05],
      [0.05, fd - 0.05],
      [fw - 0.05, fd - 0.05],
    ];
    for (const [lx, ly] of legOffsets) {
      for (let z = 0; z <= topZ; z += 0.03) {
        addPoint(fx + lx, fy + ly, z, color);
      }
    }
  }

  return { points, meta: { width, depth, height, originX, originY, doorWall, furnitureCount } };
}

for (let i = 1; i <= COUNT; i++) {
  const { points, meta } = buildRoom();
  const outPath = new URL(`../public/samples/random-room-${i}.pcd`, import.meta.url);
  writePcdAscii(points, outPath);
  console.log(
    `random-room-${i}.pcd 생성: ${points.length}개 포인트, ` +
      `${meta.width.toFixed(1)}x${meta.depth.toFixed(1)}x${meta.height.toFixed(1)}m, ` +
      `원점(${meta.originX.toFixed(1)}, ${meta.originY.toFixed(1)}), 문:${meta.doorWall}, 가구:${meta.furnitureCount}개 ` +
      `-> ${outPath.pathname}`
  );
}
