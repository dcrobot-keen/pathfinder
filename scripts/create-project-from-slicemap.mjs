// slicemap-v1 파일(scan-to-map-studio 정합 워크스페이스가 시뮬레이터 worlds/ 에
// publish한 <group>.slicemap.json)로 pathfinder 프로젝트 + 장애물을 만든다 --
// 브라우저의 "스캔 지도로 만들기" 버튼과 같은 API(POST /api/projects/from-slicemap)를
// 스크립트에서 부르는 것. 시뮬레이터에 SIM_WORLD 로 같은 파일을 주면 두 좌표계가
// 그대로 일치한다(server/slicemap.mjs 헤더, doc/vda5050-rcs.md).
//
//   node scripts/create-project-from-slicemap.mjs <slicemap.json> [--name <이름>] [--server http://127.0.0.1:3001]
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const positional = [];
const options = { name: null, server: 'http://127.0.0.1:3001' };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--name') options.name = argv[++i];
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
const res = await fetch(`${options.server}/api/projects/from-slicemap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, slicemap }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`실패 (${res.status}): ${data.error ?? '알 수 없는 오류'}`);
  process.exit(1);
}
console.log(`프로젝트 "${data.name}" 생성: ${data.sizeX} x ${data.sizeY} m, 장애물 ${data.featureCount}개 (${JSON.stringify(data.obstacleCounts)})`);
console.log(`  room: ${data.importedRoom}  id: ${data.id}`);
console.log(`  브라우저: ?project=${data.id} 로 열면 장애물이 자동으로 뜹니다. 시뮬레이터는 SIM_WORLD=<같은 slicemap> 으로.`);
