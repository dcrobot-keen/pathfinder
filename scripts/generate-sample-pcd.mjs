// 아이폰 라이다로 스캔한 것과 유사한 형태의 샘플 컬러드 PCD(ASCII, XYZRGB)를 생성한다.
// 바닥/벽/책상/의자로 구성된 작은 방 하나를 200m x 200m 평면 좌표계 안(원점 근처)에 배치한다.
import { jitter, colorJitter, writePcdAscii } from './pcd-lib.mjs';

const ROOM = {
  originX: 5, // 방의 좌하단 x (m)
  originY: 5, // 방의 좌하단 y (m)
  width: 8, // x 방향 길이 (m)
  depth: 6, // y 방향 길이 (m)
  height: 2.4, // 벽 높이 (m)
};

const points = [];

function addPoint(x, y, z, color) {
  const [r, g, b] = colorJitter(color);
  points.push({ x, y, z, r, g, b });
}

// 바닥 (연회색 타일)
const FLOOR_COLOR = [195, 195, 190];
for (let x = 0; x <= ROOM.width; x += 0.05) {
  for (let y = 0; y <= ROOM.depth; y += 0.05) {
    addPoint(
      ROOM.originX + x + jitter(0.005),
      ROOM.originY + y + jitter(0.005),
      0 + jitter(0.01),
      FLOOR_COLOR
    );
  }
}

// 벽 (베이지색), 남쪽 벽 중앙에 폭 1m 문 개구부를 남긴다
const WALL_COLOR = [222, 203, 164];
const DOOR = { wall: 'south', start: 3.2, end: 4.2 };

// 남쪽 벽 (y = 0), 문 개구부 제외
for (let a = 0; a <= ROOM.width; a += 0.05) {
  if (DOOR.wall === 'south' && a >= DOOR.start && a <= DOOR.end) continue;
  for (let z = 0.05; z <= ROOM.height; z += 0.05) {
    addPoint(ROOM.originX + a, ROOM.originY, z + jitter(0.01), WALL_COLOR);
  }
}
// 북쪽 벽 (y = depth)
for (let a = 0; a <= ROOM.width; a += 0.05) {
  for (let z = 0.05; z <= ROOM.height; z += 0.05) {
    addPoint(
      ROOM.originX + a,
      ROOM.originY + ROOM.depth,
      z + jitter(0.01),
      WALL_COLOR
    );
  }
}
// 서쪽 벽 (x = 0)
for (let a = 0; a <= ROOM.depth; a += 0.05) {
  for (let z = 0.05; z <= ROOM.height; z += 0.05) {
    addPoint(ROOM.originX, ROOM.originY + a, z + jitter(0.01), WALL_COLOR);
  }
}
// 동쪽 벽 (x = width)
for (let a = 0; a <= ROOM.depth; a += 0.05) {
  for (let z = 0.05; z <= ROOM.height; z += 0.05) {
    addPoint(
      ROOM.originX + ROOM.width,
      ROOM.originY + a,
      z + jitter(0.01),
      WALL_COLOR
    );
  }
}

// 책상 (짙은 갈색 상판 + 다리)
const DESK = { x: 5.2, y: 1.0, w: 1.5, d: 0.8, topZ: 0.75 };
const DESK_COLOR = [120, 72, 40];
for (let x = 0; x <= DESK.w; x += 0.03) {
  for (let y = 0; y <= DESK.d; y += 0.03) {
    addPoint(
      ROOM.originX + DESK.x + x,
      ROOM.originY + DESK.y + y,
      DESK.topZ,
      DESK_COLOR
    );
  }
}
const legOffsets = [
  [0.05, 0.05],
  [DESK.w - 0.05, 0.05],
  [0.05, DESK.d - 0.05],
  [DESK.w - 0.05, DESK.d - 0.05],
];
for (const [lx, ly] of legOffsets) {
  for (let z = 0; z <= DESK.topZ; z += 0.03) {
    addPoint(
      ROOM.originX + DESK.x + lx,
      ROOM.originY + DESK.y + ly,
      z,
      DESK_COLOR
    );
  }
}

// 의자 (짙은 회색 좌석 판)
const CHAIR_COLOR = [70, 70, 75];
const CHAIR = { x: 5.6, y: 2.1, w: 0.5, d: 0.5, seatZ: 0.45 };
for (let x = 0; x <= CHAIR.w; x += 0.03) {
  for (let y = 0; y <= CHAIR.d; y += 0.03) {
    addPoint(
      ROOM.originX + CHAIR.x + x,
      ROOM.originY + CHAIR.y + y,
      CHAIR.seatZ,
      CHAIR_COLOR
    );
  }
}

const outPath = new URL('../public/samples/sample-room.pcd', import.meta.url);
writePcdAscii(points, outPath);

console.log(`sample-room.pcd 생성 완료: ${points.length}개 포인트 -> ${outPath.pathname}`);
