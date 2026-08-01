// 컬러드 PCD(ASCII, XYZRGB) 파서
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

/**
 * URL에서 PCD 파일을 가져와 파싱한다.
 * @param {string} url
 */
export async function loadPcd(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PCD 로드 실패: ${url} (${res.status})`);
  }
  const text = await res.text();
  return parsePcdAscii(text);
}
