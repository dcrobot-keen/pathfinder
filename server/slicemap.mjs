// slicemap-v1(scan-to-map-studio의 2D 점유 격자; 정합 워크스페이스가 시뮬레이터
// worlds/ 에 publish하는 파일과 같은 것) -> pathfinder 프로젝트 + 장애물 블록.
//
// 좌표 규약: 시뮬레이터(ros-chromium/simulator/src/slicemap.js toWorld)는 격자의
// 왼쪽-아래 모서리를 월드 (0, 0)으로 두고 셀 (col, row)를 (col*r, row*r)에 놓는다
// (slicemap의 origin은 버림). 여기서도 똑같이 하므로, 같은 slicemap으로 만든
// pathfinder 프로젝트 평면과 시뮬레이터 월드는 아무 변환 없이 일치한다 --
// sim-driver의 SIM_ORIGIN_X/Y = 0 이면 VDA5050 agvPosition이 그대로 이 평면 좌표다.
// 프로젝트 크기 = (cols*r, rows*r). 원래 origin은 provenance로 프로젝트에 남긴다.
//
// 장애물: 점유 셀(2 = furniture, 3 = wall)을 행 단위 연속 구간(run)으로 묶고, 같은
// 열 범위의 run이 위아래로 이어지면 하나의 직사각형으로 합친다. 결과는
// import-scan-to-map-studio.mjs 가 만드는 것과 같은 kind:"block" 폴리곤이라 기존
// "스캔 장애물" 패널/길찾기 요청이 그대로 받아들인다.

export const SLICE_CODE = { UNKNOWN: 0, FREE: 1, OCC_FURNITURE: 2, OCC_WALL: 3 };

export function parseSlicemap(doc) {
  if (!doc || doc.format !== 'slicemap-v1') throw new Error('slicemap-v1 문서가 아닙니다 (format 필드 확인).');
  const { cols, rows, resolution, data } = doc;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) throw new Error('cols/rows가 양의 정수가 아닙니다.');
  if (!(resolution > 0)) throw new Error('resolution이 양수가 아닙니다.');
  if (typeof data !== 'string') throw new Error('data(base64)가 없습니다.');
  const codes = Buffer.from(data, 'base64');
  if (codes.length !== cols * rows) throw new Error(`data 길이 ${codes.length} != cols*rows ${cols * rows}`);
  const origin = Array.isArray(doc.origin) && doc.origin.length >= 2 ? [Number(doc.origin[0]), Number(doc.origin[1])] : [0, 0];
  return { cols, rows, resolution, origin, codes, z: doc.z ?? null, band: doc.band ?? null, sources: doc.sources ?? null };
}

/** 프로젝트 평면 크기(m): 격자 전체. */
export function slicemapSize(slice) {
  return { sizeX: slice.cols * slice.resolution, sizeY: slice.rows * slice.resolution };
}

/**
 * 점유 셀 -> 직사각형 블록 목록 [{ code, c0, c1, r0, r1 }] (c1/r1 exclusive).
 * 행별 run을 만들고 열 범위가 같은 run이 다음 행에 있으면 세로로 확장한다.
 */
export function occupiedRectangles(slice) {
  const { cols, rows, codes } = slice;
  const isOcc = (code) => code === SLICE_CODE.OCC_WALL || code === SLICE_CODE.OCC_FURNITURE;
  const rects = [];
  let open = new Map(); // `${code}:${c0}:${c1}` -> rect still extendable at the current row
  for (let row = 0; row < rows; row++) {
    const next = new Map();
    let col = 0;
    while (col < cols) {
      const code = codes[row * cols + col];
      if (!isOcc(code)) {
        col++;
        continue;
      }
      let end = col + 1;
      while (end < cols && codes[row * cols + end] === code) end++;
      const key = `${code}:${col}:${end}`;
      const prev = open.get(key);
      if (prev && prev.r1 === row) {
        prev.r1 = row + 1;
        next.set(key, prev);
      } else {
        const rect = { code, c0: col, c1: end, r0: row, r1: row + 1 };
        rects.push(rect);
        next.set(key, rect);
      }
      col = end;
    }
    open = next;
  }
  return rects;
}

/**
 * slicemap -> kind:"block" FeatureCollection (미터, 격자 왼쪽-아래 = (0,0)).
 * @param {object} slice parseSlicemap() 결과
 * @param {{ room: string, importedAt?: string }} opts
 */
export function slicemapToObstacles(slice, { room, importedAt = new Date().toISOString() }) {
  const r = slice.resolution;
  const features = occupiedRectangles(slice).map((rect) => {
    const x0 = rect.c0 * r, x1 = rect.c1 * r, y0 = rect.r0 * r, y1 = rect.r1 * r;
    const category = rect.code === SLICE_CODE.OCC_WALL ? 'wall' : 'furniture';
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
      properties: {
        source: 'slicemap-v1',
        room,
        importedAt,
        category,
        kind: 'block',
        area_m2: Math.round((x1 - x0) * (y1 - y0) * 10000) / 10000,
      },
    };
  });
  const counts = features.reduce((acc, f) => ((acc[f.properties.category] = (acc[f.properties.category] ?? 0) + 1), acc), {});
  return {
    featureCollection: {
      type: 'FeatureCollection',
      features,
      slicemap: { resolution: r, cols: slice.cols, rows: slice.rows, origin: slice.origin, z: slice.z, sources: slice.sources },
    },
    counts,
  };
}

/** 프로젝트 이름 -> data/imported/<room>.geojson 파일 이름에 쓸 수 있는 room id. */
export function roomIdFromName(name) {
  const cleaned = String(name).trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || `scan_${Date.now()}`;
}
