// scan-to-map-studio가 만든 output.geojson(방 하나 분량)을 pathfinder가 이해하는
// 장애물 블록(kind: "block") FeatureCollection으로 변환한다.
//
// 배경: pathfinder는 지금까지 합성 PCD(scripts/generate-*-pcd.mjs)와 수동으로
// 그린 data/nodelink.geojson만으로 동작했다 — 실제 스캔 파이프라인(scan-to-map-studio)의
// 결과와 연결되어 있지 않았다(doc/architecture-improvements.md ① 참고). 이 스크립트가
// 그 첫 연결 지점이다.
//
// scan-to-map-studio의 studio/vectorize.py(to_geojson)는 세 종류의 feature를 만든다:
//   - category: "furniture" (Polygon, area_m2) -- 가구 발자국. block으로 1:1 변환.
//   - category: "wall"      (LineString, length_m) -- 개별 벽 세그먼트. 두께를 줘서
//                             얇은 사각형 block Polygon으로 변환(pathfinder는 Polygon
//                             block만 장애물로 이해하므로).
//   - category: "room"      (Polygon, area_m2) -- 방 전체의 바깥 윤곽(=바닥 경계).
//                             기본으로는 장애물로 변환하지 않는다 -- "바깥쪽이
//                             막힘"을 표현하려면 큰 사각형에서 room을 뺀 홀(hole)
//                             폴리곤이 필요한데, Go 쪽 RasterizeBlocks가 홀을 실제로
//                             지원하는지 검증되지 않았다. 그대로 room feature로
//                             출력해 두어(카테고리 유지) 뷰 초기 범위 힌트 등에 쓴다.
//                             --room-walls 를 주면 외곽선의 각 변을 벽 세그먼트로
//                             취급해 두께 있는 block으로도 함께 내보낸다 (studio의
//                             pipeline.py 는 wall LineString을 만들지 않고 room +
//                             furniture만 만들기 때문에, 이것이 스캔 지도를 "닫는"
//                             유일한 방법이다).
//
// 결과는 data/nodelink.geojson(사용자가 손으로 편집하는 파일)을 절대 건드리지 않고
// data/imported/<room>.geojson에 별도로 저장한다 -- 재가져오기가 안전하게 통째로
// 덮어쓸 수 있도록.
//
// 사용법:
//   node scripts/import-scan-to-map-studio.mjs <scan-to-map-studio 프로젝트 폴더> --room <이름> [--wall-thickness 0.15] [--room-walls]
//   예) node scripts/import-scan-to-map-studio.mjs scan-engine/projects/bedroom --room bedroom
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {resolve, dirname, basename } from 'node:path';
import { alignmentFor, parseGroupAlignment, transformGeoJSON } from '../shared/scanAlignment.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WALL_THICKNESS_M = 0.15;

function parseArgs(argv) {
  const positional = [];
  const options = { wallThickness: DEFAULT_WALL_THICKNESS_M, room: null, roomWalls: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--room') {
      options.room = argv[++i];
    } else if (arg === '--alignment') {
      options.alignment = argv[++i];
    } else if (arg === '--scan') {
      options.scan = argv[++i];
    } else if (arg === '--wall-thickness') {
      options.wallThickness = Number(argv[++i]);
    } else if (arg === '--room-walls') {
      options.roomWalls = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

/** 2점 LineString(벽 세그먼트)을 두께 thickness(m)짜리 얇은 사각형 Polygon으로 부풀린다. */
function bufferWallToPolygon([[x1, y1], [x2, y2]], thickness) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null; // 길이 0인 퇴화된 세그먼트는 스킵
  const half = thickness / 2;
  // 진행 방향에 수직인 단위 벡터
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  const ring = [
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
    [x1 + nx, y1 + ny], // 링 닫기
  ];
  return ring;
}

/** room Polygon의 바깥 링을 변마다 두께 있는 벽 block으로 바꾼다 (--room-walls). */
export function roomOutlineToWallBlocks(feature, { wallThickness, baseProps }) {
  const ring = feature.geometry.coordinates[0] ?? [];
  const blocks = [];
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1];
    const poly = bufferWallToPolygon([a, b], wallThickness);
    if (!poly) continue;
    blocks.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [poly] },
      properties: {
        ...baseProps,
        category: 'wall',
        kind: 'block',
        derived_from: 'room-outline',
        length_m: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100) / 100,
        thickness_m: wallThickness,
      },
    });
  }
  return blocks;
}

function convertFeature(feature, { room, wallThickness, importedAt, roomWalls = false }) {
  const category = feature.properties?.category;
  const baseProps = { source: 'scan-to-map-studio', room, importedAt, category };

  if (category === 'furniture') {
    if (feature.geometry.type !== 'Polygon') return { skipped: 'furniture가 Polygon이 아님' };
    return {
      feature: {
        type: 'Feature',
        geometry: feature.geometry,
        properties: { ...baseProps, kind: 'block', area_m2: feature.properties.area_m2 },
      },
    };
  }

  if (category === 'wall') {
    if (feature.geometry.type !== 'LineString') return { skipped: 'wall이 LineString이 아님' };
    const ring = bufferWallToPolygon(feature.geometry.coordinates, wallThickness);
    if (!ring) return { skipped: '길이 0인 벽 세그먼트' };
    return {
      feature: {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          ...baseProps,
          kind: 'block',
          length_m: feature.properties.length_m,
          thickness_m: wallThickness,
        },
      },
    };
  }

  if (category === 'room') {
    // 장애물로 변환하지 않음 -- 위 파일 상단 주석 참고. 참고용으로 원본 그대로 보존.
    if (feature.geometry.type !== 'Polygon') return { skipped: 'room이 Polygon이 아님' };
    const outline = {
      type: 'Feature',
      geometry: feature.geometry,
      properties: { ...baseProps, kind: 'room-outline', area_m2: feature.properties.area_m2 },
    };
    if (!roomWalls) {
      return { feature: outline, note: 'room 폴리곤은 장애물(block)로 변환하지 않고 참고용(kind: room-outline)으로만 보존됨 (--room-walls 로 외곽 벽 생성 가능)' };
    }
    const walls = roomOutlineToWallBlocks(feature, { wallThickness, baseProps });
    return { feature: outline, extra: walls, note: `room 외곽선 ${walls.length}변을 두께 ${wallThickness} m 벽 block으로 변환` };
  }

  return { skipped: `알 수 없는 category: ${category}` };
}

export async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [projectDir] = positional;

  if (!projectDir || !options.room) {
    console.error(
      '사용법: node scripts/import-scan-to-map-studio.mjs <scan-to-map-studio 프로젝트 폴더> --room <이름> [--wall-thickness 0.15] [--room-walls] [--alignment group_alignment.json [--scan <scan id>]]'
    );
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), projectDir, 'output.geojson');
  const raw = await readFile(inputPath, 'utf-8').catch((err) => {
    throw new Error(`${inputPath} 를 읽을 수 없습니다: ${err.message}`);
  });
  const input = JSON.parse(raw);
  if (input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error(`${inputPath} 가 유효한 GeoJSON FeatureCollection이 아닙니다.`);
  }

  // --alignment <group_alignment.json>: move this room into its project's reference
  // frame (scan-group-alignment-v1, shared with the iPhone app and the studio
  // workspace) so several rooms of one project land on the plane where they
  // really are relative to each other. --scan names this room's scan id
  // (default: the project folder's basename, which is the scan id when the
  // studio project was created by orchestrate/groups).
  let alignment = null;
  let alignmentInfo = null;
  if (options.alignment) {
    const parsed = parseGroupAlignment(JSON.parse(await readFile(resolve(process.cwd(), options.alignment), 'utf-8')));
    const scanId = options.scan ?? basename(resolve(process.cwd(), projectDir));
    alignment = alignmentFor(parsed, scanId);
    alignmentInfo = { file: options.alignment, reference: parsed.reference, scan: scanId, ...alignment };
    console.log(`  정렬 적용: ${scanId} -> 기준 ${parsed.reference} (${alignment.method}, offsetX ${alignment.offsetX.toFixed(3)}, offsetZ ${alignment.offsetZ.toFixed(3)}, yaw ${(alignment.yawRadians * 180 / Math.PI).toFixed(2)}°)`);
  }

  const importedAt = new Date().toISOString();
  const outFeatures = [];
  const counts = { furniture: 0, wall: 0, room: 0, skipped: 0 };

  for (const feature of input.features) {
    const placed = alignment ? transformGeoJSON(feature, alignment) : feature;
    const result = convertFeature(placed, { room: options.room, wallThickness: options.wallThickness, importedAt, roomWalls: options.roomWalls });
    if (result.skipped) {
      counts.skipped++;
      console.warn(`  스킵: ${result.skipped}`);
      continue;
    }
    outFeatures.push(result.feature);
    counts[feature.properties.category] = (counts[feature.properties.category] ?? 0) + 1;
    if (result.extra?.length) {
      outFeatures.push(...result.extra);
      counts.wall += result.extra.length;
    }
    if (result.note) console.log(`  참고: ${result.note}`);
  }

  const outDir = resolve(__dirname, '../data/imported');
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `${options.room}.geojson`);
  const outFeatureCollection = { type: 'FeatureCollection', features: outFeatures, ...(alignmentInfo ? { scanAlignment: alignmentInfo } : {}) };
  await writeFile(outPath, JSON.stringify(outFeatureCollection, null, 2), 'utf-8');

  console.log(
    `${options.room}: furniture ${counts.furniture}개, wall ${counts.wall}개, room ${counts.room}개 변환 ` +
      `(스킵 ${counts.skipped}개) -> ${outPath}`
  );
  console.log(
    `-> pathfinder에서 "스캔 장애물" 패널에서 "${options.room}"을 선택해 불러오면 편집 지도/길찾기에 반영됩니다.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
