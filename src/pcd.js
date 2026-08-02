// 컬러드 PCD(ASCII/binary, XYZRGB) 파서
// PCL 표준에 따라 rgb 필드는 float로 저장되지만 비트 패턴은 0x00RRGGBB 정수를 담고 있다.
function unpackRgbFloat(rgbFloat) {
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = rgbFloat;
  const packed = new Int32Array(buf)[0];
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  };
}

/**
 * ASCII PCD 텍스트를 파싱해 포인트 배열로 반환한다.
 * 지원 필드: x y z (필수), rgb 또는 (r,g,b) (선택, 없으면 흰색)
 * @param {string} text
 * @returns {{ points: Array<{x:number,y:number,z:number,r:number,g:number,b:number}>, fields: string[] }}
 */
export function parsePcdAscii(text) {
  const lines = text.split('\n');
  let dataStart = -1;
  let fields = [];
  let dataFormat = 'ascii';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('FIELDS')) {
      fields = line.split(/\s+/).slice(1);
    } else if (line.startsWith('DATA')) {
      dataFormat = line.split(/\s+/)[1];
      dataStart = i + 1;
      break;
    }
  }

  if (dataStart === -1) {
    throw new Error('PCD 헤더에서 DATA 라인을 찾지 못했습니다.');
  }
  if (dataFormat !== 'ascii') {
    throw new Error(`지원하지 않는 PCD DATA 형식입니다: ${dataFormat} (ascii만 지원)`);
  }

  const xi = fields.indexOf('x');
  const yi = fields.indexOf('y');
  const zi = fields.indexOf('z');
  const rgbi = fields.indexOf('rgb');
  const ri = fields.indexOf('r');
  const gi = fields.indexOf('g');
  const bi = fields.indexOf('b');

  if (xi === -1 || yi === -1 || zi === -1) {
    throw new Error('PCD FIELDS에 x, y, z가 모두 있어야 합니다.');
  }

  const points = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/).map(Number);

    let r = 255;
    let g = 255;
    let b = 255;
    if (rgbi !== -1) {
      ({ r, g, b } = unpackRgbFloat(parts[rgbi]));
    } else if (ri !== -1 && gi !== -1 && bi !== -1) {
      r = parts[ri];
      g = parts[gi];
      b = parts[bi];
    }

    points.push({
      x: parts[xi],
      y: parts[yi],
      z: parts[zi],
      r,
      g,
      b,
    });
  }

  return { points, fields };
}

// 헤더는 항상 순수 ASCII 텍스트이므로, 전체(수백만 바이트일 수 있는) 버퍼를
// 텍스트로 디코딩하지 않고 앞부분 일부만 latin1로 디코딩해 헤더 필드와
// "DATA" 라인이 끝나는 바이트 오프셋을 찾는다(latin1은 1바이트=1문자라
// 문자 길이가 곧 바이트 길이다).
function parsePcdHeader(buffer) {
  const preview = new TextDecoder('latin1').decode(buffer.slice(0, 4096));
  let fields = [];
  let sizes = [];
  let types = [];
  let counts = [];
  let dataFormat = null;
  let consumed = 0;

  for (const line of preview.split('\n')) {
    consumed += line.length + 1; // 잘려나간 개행 문자 포함
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('FIELDS')) {
      fields = trimmed.split(/\s+/).slice(1);
    } else if (trimmed.startsWith('SIZE')) {
      sizes = trimmed.split(/\s+/).slice(1).map(Number);
    } else if (trimmed.startsWith('TYPE')) {
      types = trimmed.split(/\s+/).slice(1);
    } else if (trimmed.startsWith('COUNT')) {
      counts = trimmed.split(/\s+/).slice(1).map(Number);
    } else if (trimmed.startsWith('DATA')) {
      dataFormat = trimmed.split(/\s+/)[1];
      break;
    }
  }

  if (!dataFormat) {
    throw new Error('PCD 헤더에서 DATA 라인을 찾지 못했습니다.');
  }
  return { fields, sizes, types, counts, dataFormat, headerByteLength: consumed };
}

function readScalar(view, offset, size, type) {
  if (type === 'F') {
    if (size === 4) return view.getFloat32(offset, true);
    if (size === 8) return view.getFloat64(offset, true);
  } else if (type === 'U') {
    if (size === 1) return view.getUint8(offset);
    if (size === 2) return view.getUint16(offset, true);
    if (size === 4) return view.getUint32(offset, true);
  } else if (type === 'I') {
    if (size === 1) return view.getInt8(offset);
    if (size === 2) return view.getInt16(offset, true);
    if (size === 4) return view.getInt32(offset, true);
  }
  throw new Error(`지원하지 않는 PCD 필드 타입/크기: ${type}${size}`);
}

/**
 * binary PCD를 파싱해 포인트 배열로 반환한다. FIELDS/SIZE/TYPE/COUNT 헤더를
 * 그대로 따라 각 포인트 레코드의 바이트 레이아웃을 계산한다(리틀 엔디안).
 * @param {ArrayBuffer} buffer
 */
export function parsePcdBinary(buffer) {
  const { fields, sizes, types, counts, dataFormat, headerByteLength } = parsePcdHeader(buffer);
  if (dataFormat !== 'binary') {
    throw new Error(`parsePcdBinary는 binary 포맷 전용입니다 (실제: ${dataFormat}).`);
  }

  const layout = {};
  let pointStride = 0;
  for (let i = 0; i < fields.length; i++) {
    layout[fields[i]] = { offset: pointStride, size: sizes[i], type: types[i] };
    pointStride += sizes[i] * counts[i];
  }

  const xField = layout.x;
  const yField = layout.y;
  const zField = layout.z;
  if (!xField || !yField || !zField) {
    throw new Error('PCD FIELDS에 x, y, z가 모두 있어야 합니다.');
  }
  const rgbField = layout.rgb;
  const rField = layout.r;
  const gField = layout.g;
  const bField = layout.b;

  const view = new DataView(buffer, headerByteLength);
  const pointCount = Math.floor((buffer.byteLength - headerByteLength) / pointStride);

  const points = [];
  for (let i = 0; i < pointCount; i++) {
    const base = i * pointStride;

    let r = 255;
    let g = 255;
    let b = 255;
    if (rgbField) {
      const rgbFloat = readScalar(view, base + rgbField.offset, rgbField.size, rgbField.type);
      ({ r, g, b } = unpackRgbFloat(rgbFloat));
    } else if (rField && gField && bField) {
      r = readScalar(view, base + rField.offset, rField.size, rField.type);
      g = readScalar(view, base + gField.offset, gField.size, gField.type);
      b = readScalar(view, base + bField.offset, bField.size, bField.type);
    }

    points.push({
      x: readScalar(view, base + xField.offset, xField.size, xField.type),
      y: readScalar(view, base + yField.offset, yField.size, yField.type),
      z: readScalar(view, base + zField.offset, zField.size, zField.type),
      r,
      g,
      b,
    });
  }

  return { points, fields };
}

/**
 * PCD 파일(ArrayBuffer)을 헤더의 DATA 포맷에 맞춰 ascii/binary 어느 쪽이든
 * 파싱한다. 업로드/URL 로드 양쪽에서 이 함수 하나로 처리한다.
 * @param {ArrayBuffer} buffer
 */
export function parsePcd(buffer) {
  const { dataFormat } = parsePcdHeader(buffer);
  if (dataFormat === 'binary') {
    return parsePcdBinary(buffer);
  }
  if (dataFormat === 'ascii') {
    return parsePcdAscii(new TextDecoder('utf-8').decode(buffer));
  }
  throw new Error(`지원하지 않는 PCD DATA 형식입니다: ${dataFormat} (ascii/binary만 지원)`);
}

/**
 * URL에서 PCD 파일을 가져와 파싱한다.
 * @param {string} url
 */
export async function loadPcd(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PCD 로드 실패: ${url} (${res.status})`);
  }
  const buffer = await res.arrayBuffer();
  return parsePcd(buffer);
}
