#!/usr/bin/env node
// 컬러드 PCD 파일을 3D 메쉬(PLY)로 변환하는 커맨드라인 도구.
// 사용법: node scripts/pcd-to-mesh.mjs <input.pcd> [--out=output.ply] [--voxel=0.08] [--iso=0.5]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { parsePcdAscii } from '../src/pcd.js';
import { pointsToMesh } from '../src/meshify.js';
import { meshToPlyText } from '../src/ply.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) {
      args[m[1]] = m[2];
    } else {
      args._.push(raw);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const inputPath = args._[0];

if (!inputPath) {
  console.error(
    '사용법: node scripts/pcd-to-mesh.mjs <input.pcd> [--out=output.ply] [--voxel=0.08] [--iso=0.5]'
  );
  process.exit(1);
}

const voxelSize = args.voxel ? Number(args.voxel) : 0.08;
const isoLevel = args.iso ? Number(args.iso) : 0.5;
const outPath =
  args.out ??
  join(dirname(resolve(inputPath)), `${basename(inputPath, extname(inputPath))}.mesh.ply`);

console.log(`입력: ${inputPath}`);
const text = readFileSync(resolve(inputPath), 'utf-8');
const { points } = parsePcdAscii(text);
console.log(`포인트 수: ${points.length}`);

console.log(`복셀 크기: ${voxelSize}m, iso: ${isoLevel} 로 메쉬 생성 중...`);
const mesh = pointsToMesh(points, { voxelSize, isoLevel });
console.log(
  `격자: ${mesh.grid.nx}x${mesh.grid.ny}x${mesh.grid.nz}, 삼각형 수: ${mesh.triangleCount}`
);

const plyText = meshToPlyText(mesh);
writeFileSync(resolve(outPath), plyText);
console.log(`저장 완료: ${outPath}`);
