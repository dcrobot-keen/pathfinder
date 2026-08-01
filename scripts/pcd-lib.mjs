// PCD(ASCII, XYZRGB) 샘플 생성 스크립트들이 공유하는 유틸리티.
import { writeFileSync } from 'node:fs';

export function rgbToFloat(r, g, b) {
  const packed = (r << 16) | (g << 8) | b;
  const buf = new ArrayBuffer(4);
  new Int32Array(buf)[0] = packed;
  return new Float32Array(buf)[0];
}

export function jitter(amount) {
  return (Math.random() - 0.5) * 2 * amount;
}

export function colorJitter([r, g, b], amount = 8) {
  const clamp = (v) => Math.min(255, Math.max(0, Math.round(v)));
  return [
    clamp(r + jitter(amount)),
    clamp(g + jitter(amount)),
    clamp(b + jitter(amount)),
  ];
}

/**
 * 점 배열({x,y,z,r,g,b}[])을 ASCII PCD 텍스트로 직렬화해 파일로 저장한다.
 * @param {Array<{x:number,y:number,z:number,r:number,g:number,b:number}>} points
 * @param {string|URL} outPath
 */
export function writePcdAscii(points, outPath) {
  const header = [
    '# .PCD v0.7 - Point Cloud Data file format',
    'VERSION 0.7',
    'FIELDS x y z rgb',
    'SIZE 4 4 4 4',
    'TYPE F F F F',
    'COUNT 1 1 1 1',
    `WIDTH ${points.length}`,
    'HEIGHT 1',
    'VIEWPOINT 0 0 0 1 0 0 0',
    `POINTS ${points.length}`,
    'DATA ascii',
  ].join('\n');

  const body = points
    .map((p) => {
      const rgbFloat = rgbToFloat(p.r, p.g, p.b);
      return `${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)} ${rgbFloat}`;
    })
    .join('\n');

  writeFileSync(outPath, `${header}\n${body}\n`);
}
