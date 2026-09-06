// 로봇 SLAM 지도(ROS map_server: <name>.pgm + <name>.yaml) -> slicemap-v1 -> 현장 프로젝트.
// 가져오기 대화상자의 'robotmap' 분기. 서버는 slicemap-v1 만 받으므로 여기서 변환한다.
//   yaml: image, resolution (m/px), origin [x, y, yaw], negate, occupied_thresh, free_thresh
//   pgm : P5(바이너리) 또는 P2(아스키), 행 0 = 이미지 위 = 최대 y  ->  slicemap 행 0 = 최소 y (뒤집는다)
//   코드: 점유 -> 3(wall), 자유 -> 1(free), 나머지 -> 0(unknown). yaw 가 0 이 아니면 회전은 무시하고 알린다.
import { createProjectFromSlicemap } from '../projects/projectApi.js';

/** 아주 작은 YAML 파서: map_server 가 쓰는 평면 키/값과 [a, b, c] 배열만 */
export function parseMapYaml(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    let val = valRaw.trim();
    if (val.startsWith('[')) {
      out[key] = val.replace(/^\[|\]$/g, '').split(',').map((v) => Number(v.trim()));
    } else if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(val)) {
      out[key] = Number(val);
    } else if (val === 'true' || val === 'false') {
      out[key] = val === 'true';
    } else {
      out[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

/** PGM (P5 binary / P2 ascii) -> { width, height, maxval, data: Uint8Array } */
export function parsePgm(buffer) {
  const bytes = new Uint8Array(buffer);
  let pos = 0;
  const tokens = [];
  const isSpace = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
  while (tokens.length < 4 && pos < bytes.length) {
    while (pos < bytes.length && isSpace(bytes[pos])) pos++;
    if (bytes[pos] === 0x23) { while (pos < bytes.length && bytes[pos] !== 0x0a) pos++; continue; } // # 주석
    let start = pos;
    while (pos < bytes.length && !isSpace(bytes[pos])) pos++;
    tokens.push(String.fromCharCode(...bytes.subarray(start, pos)));
  }
  const [magic, w, h, maxv] = tokens;
  const width = Number(w), height = Number(h), maxval = Number(maxv);
  if (!(width > 0 && height > 0)) throw new Error('PGM 헤더를 읽을 수 없습니다.');
  pos++; // 헤더 뒤 공백 하나
  const data = new Uint8Array(width * height);
  if (magic === 'P5') {
    const bytesPer = maxval > 255 ? 2 : 1;
    for (let i = 0; i < width * height; i++) {
      const v = bytesPer === 1 ? bytes[pos + i] : (bytes[pos + 2 * i] << 8) | bytes[pos + 2 * i + 1];
      data[i] = Math.round((v / maxval) * 255);
    }
  } else if (magic === 'P2') {
    const text = new TextDecoder().decode(bytes.subarray(pos));
    const nums = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < width * height; i++) data[i] = Math.round((Number(nums[i]) / maxval) * 255);
  } else {
    throw new Error(`지원하지 않는 PGM 형식: ${magic} (P2/P5 만)`);
  }
  return { width, height, maxval, data };
}

/** map_server 지도 -> slicemap-v1 문서 (+ 경고 목록) */
export function robotMapToSlicemap(pgm, yaml, { name }) {
  const res = Number(yaml.resolution);
  if (!(res > 0)) throw new Error('yaml 의 resolution 이 없습니다.');
  const origin = Array.isArray(yaml.origin) ? yaml.origin : [0, 0, 0];
  const negate = yaml.negate === 1 || yaml.negate === true;
  const occ = Number(yaml.occupied_thresh ?? 0.65), free = Number(yaml.free_thresh ?? 0.196);
  const warnings = [];
  if (Math.abs(Number(origin[2] ?? 0)) > 1e-6) warnings.push(`origin yaw ${origin[2]} rad 는 무시했습니다 (회전된 지도는 지원 예정)`);
  const { width: cols, height: rows, data } = pgm;
  const codes = new Uint8Array(cols * rows);
  let nOcc = 0, nFree = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = data[row * cols + col] / 255;
      const p = negate ? v : 1 - v; // 점유 확률 (map_server 규약)
      const code = p > occ ? 3 : p < free ? 1 : 0;
      if (code === 3) nOcc++; else if (code === 1) nFree++;
      codes[(rows - 1 - row) * cols + col] = code; // 이미지 위 = 최대 y -> 행 0 = 최소 y
    }
  }
  let bin = '';
  for (let i = 0; i < codes.length; i += 0x8000) bin += String.fromCharCode(...codes.subarray(i, i + 0x8000));
  return {
    slicemap: {
      format: 'slicemap-v1', z: 0, band: 0, resolution: res, origin: [Number(origin[0]) || 0, Number(origin[1]) || 0], cols, rows,
      data: btoa(bin),
      sources: [{ scan: name, method: 'robot_map', image: yaml.image ?? null, occupied_thresh: occ, free_thresh: free }],
    },
    stats: { cols, rows, occupied: nOcc, free: nFree, unknown: cols * rows - nOcc - nFree },
    warnings,
  };
}

/**
 * @param {File[]} files  .pgm + .yaml
 * @returns {Promise<{ project: object, stats: object, warnings: string[] }>}
 */
export async function importRobotMapFiles(files) {
  const list = Array.from(files);
  const pgmFile = list.find((f) => /\.pgm$/i.test(f.name));
  const yamlFile = list.find((f) => /\.ya?ml$/i.test(f.name));
  if (!pgmFile || !yamlFile) throw new Error('.pgm 과 .yaml 을 함께 골라야 합니다.');
  const yaml = parseMapYaml(await yamlFile.text());
  const pgm = parsePgm(await pgmFile.arrayBuffer());
  const name = yamlFile.name.replace(/\.ya?ml$/i, '');
  const { slicemap, stats, warnings } = robotMapToSlicemap(pgm, yaml, { name });
  const project = await createProjectFromSlicemap({ name, slicemap });
  return { project, stats, warnings };
}
