// `npm run dev` 의 scan-engine 프로세스: scan-engine/ (구 scan-to-map-studio) 의 FastAPI 서버를
// 그 폴더의 가상환경으로 띄운다. 파이썬 계산부(RANSAC 천장 제거·ICP·래스터화·usdz 임포트)는
// 그대로 파이썬에 두고, 화면은 Fleet Studio(이 저장소의 Vite 앱)가 맡는다 -- 저장소만 하나로 합쳤다.
//
//   scan-engine/.env (없으면 .env.example 참고):
//     STUDIO_GROUPS_DIR   앱이 내보낸 다중 스캔 그룹 폴더 (예: ../vps-system/data)
//     STUDIO_PUBLISH_DIR  정합 저장 시 합성 slicemap 을 복사할 곳 (기본: ../deploy/worlds, fleet-studio 컨테이너 스택이 마운트)
//     SCAN_ENGINE_PORT    기본 8000 (Vite 프록시 /api/scan-studio, /scan-files 가 이 포트를 본다)
//
// 가상환경이 없으면 만드는 방법을 알려주고 끝난다(다른 프로세스는 계속 뜬다).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const engineDir = join(here, '..', 'scan-engine');
const isWin = process.platform === 'win32';
const python = join(engineDir, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');

if (!existsSync(python)) {
  console.error(
    `[scan-engine] 가상환경이 없습니다: ${python}\n` +
      `  cd scan-engine && python -m venv .venv && ${isWin ? '.venv\\Scripts\\pip' : '.venv/bin/pip'} install -r requirements.txt -r requirements-server.txt`,
  );
  process.exit(0);
}

const env = { ...process.env };
const envFile = join(engineDir, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
// `--test`: 서버 대신 scan-engine 의 자체 테스트 스크립트(개별 실행형)를 같은 가상환경으로 돌린다 (npm run test:scan-engine)
if (process.argv.includes('--test')) {
  const tests = ['tests/test_groups.py', 'tests/test_merge_slicemaps.py', 'tests/test_align_workspace.py', 'tests/test_preprocess.py'];
  let failed = 0;
  for (const t of tests) {
    const r = spawnSync(python, [t], { cwd: engineDir, env, stdio: 'inherit' });
    if (r.status !== 0) failed++;
  }
  console.log(failed ? `[scan-engine] ${failed} test file(s) failed` : `[scan-engine] all ${tests.length} test files passed`);
  process.exit(failed ? 1 : 0);
}

const port = env.SCAN_ENGINE_PORT || '8000';
console.log(`[scan-engine] uvicorn server.app:app --port ${port} (groups: ${env.STUDIO_GROUPS_DIR ?? 'scan-engine/groups'}, publish: ${env.STUDIO_PUBLISH_DIR ?? '(unset)'})`);

const child = spawn(python, ['-m', 'uvicorn', 'server.app:app', '--port', port], { cwd: engineDir, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
