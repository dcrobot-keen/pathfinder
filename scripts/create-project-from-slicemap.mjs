// slicemap-v1 파일(scan-to-map-studio 정합 워크스페이스가 시뮬레이터 worlds/ 에
// publish한 <group>.slicemap.json)로 pathfinder 프로젝트 + 장애물을 만든다 --
// 브라우저의 "스캔 지도로 만들기" 버튼과 같은 API(POST /api/projects/from-slicemap)를
// 스크립트에서 부르는 것. 시뮬레이터에 SIM_WORLD 로 같은 파일을 주면 두 좌표계가
// 그대로 일치한다(server/slicemap.mjs 헤더, doc/vda5050-rcs.md).
//
// 같은 자리에 <stem>.floor.png + <stem>.floor.json(정합 워크스페이스가 함께 publish한 앱 바닥
// 이미지 합성)이 있으면 자동으로 함께 보내 프로젝트 배경으로 깐다. --project <id> 를 주면 새로
// 만들지 않고 그 프로젝트를 갱신한다(정합을 다시 저장한 뒤; id/nodelink 유지).
//
//   node scripts/create-project-from-slicemap.mjs <slicemap.json> [--name <이름>] [--project <id>] [--server http://127.0.0.1:3001]
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const positional = [];
const options = { name: null, server: 'http://127.0.0.1:3001', project: null };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--name') options.name = argv[++i];
  else if (argv[i] === '--project') options.project = argv[++i];
  else if (argv[i] === '--server') options.server = argv[++i];
  else positional.push(argv[i]);
}
const [file] = positional;
if (!file) {
  console.error('사용법: node scripts/create-project-from-slicemap.mjs <slicemap.json> [--name <이름>] [--server http://127.0.0.1:3001]');
  process.exit(1);
}

const slicemap = JSON.parse(await readFile(file, 'utf-8'));
const name = options.name ?? basename(file).replace(/\.slicemap\.json$|\.json$/i, '');
const stem = file.replace(/\.slicemap\.json$|\.json$/i, '');
let floor;
if (existsSync(`${stem}.floor.png`) && existsSync(`${stem}.floor.json`)) {
  floor = { png: (await readFile(`${stem}.floor.png`)).toString('base64'), meta: JSON.parse(await readFile(`${stem}.floor.json`, 'utf-8')) };
  console.log(`  바닥 이미지 포함: ${stem}.floor.png (${floor.meta.width_px}x${floor.meta.height_px})`);
}
const url = options.project
  ? `${options.server}/api/projects/${encodeURIComponent(options.project)}/from-slicemap`
  : `${options.server}/api/projects/from-slicemap`;
const res = await fetch(url, {
  method: options.project ? 'PUT' : 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: options.name ?? (options.project ? undefined : name), slicemap, floor }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`실패 (${res.status}): ${data.error ?? '알 수 없는 오류'}`);
  process.exit(1);
}
console.log(`프로젝트 "${data.name}" ${options.project ? '갱신' : '생성'}: ${data.sizeX} x ${data.sizeY} m, 장애물 ${data.featureCount}개 (${JSON.stringify(data.obstacleCounts)})${data.floorImage ? `, 바닥 이미지 extent ${JSON.stringify(data.floorImage.extent)}` : ''}`);
console.log(`  room: ${data.importedRoom}  id: ${data.id}`);
console.log(`  브라우저: ?project=${data.id} 로 열면 장애물이 자동으로 뜹니다. 시뮬레이터는 SIM_WORLD=<같은 slicemap> 으로.`);
