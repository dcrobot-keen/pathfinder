// scan-engine(FastAPI)의 OpenAPI 스키마 -> TypeScript 타입. Fleet Studio 의 클라이언트
// (src/scanStudio/scanStudioApi.js, openapi-fetch) 가 이 타입으로 경로·메서드·파라미터·요청 본문을
// 검사받는다 (`npm run check:api` = tsc --noEmit, checkJs). 엔진 쪽 라우트를 바꾸면 여기서 다시 생성:
//
//   npm run gen:scan-engine-api
//
// 1) scan-engine/.venv 파이썬으로 server.app:app 의 app.openapi() 를 scan-engine/openapi.json 에 덤프
//    (서버를 띄우지 않고 import 만 한다), 2) openapi-typescript 로 src/scanStudio/scanEngine.gen.d.ts 생성.
// 두 산출물은 커밋한다 -- 리뷰에서 API 변화가 diff 로 보이고, 파이썬 환경 없이도 타입 검사가 된다.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const engineDir = join(root, 'scan-engine');
const isWin = process.platform === 'win32';
const python = join(engineDir, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
const specPath = join(engineDir, 'openapi.json');
const outPath = join(root, 'src', 'scanStudio', 'scanEngine.gen.d.ts');

if (existsSync(python)) {
  const dump = [
    'import json, sys',
    "sys.path.insert(0, '.')",
    'from server.app import app',
    "json.dump(app.openapi(), open('openapi.json', 'w', encoding='utf-8'), indent=2, ensure_ascii=False)",
  ].join('\n');
  const r = spawnSync(python, ['-c', dump], { cwd: engineDir, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[gen-scan-engine-api] openapi dump failed');
    process.exit(r.status ?? 1);
  }
  console.log(`[gen-scan-engine-api] wrote ${specPath}`);
} else {
  console.warn(`[gen-scan-engine-api] no scan-engine venv (${python}); reusing the committed ${specPath}`);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const ast = await openapiTS(spec, {
  // FastAPI `-> dict` responses come out as free-form objects; keep them `unknown`-valued, never `never`
  emptyObjectsUnknown: true,
});
const header = `// 자동 생성 -- 편집 금지. \`npm run gen:scan-engine-api\` (scripts/gen-scan-engine-api.mjs) 가
// scan-engine/openapi.json (FastAPI server.app:app) 에서 만든다.
// eslint-disable
`;
writeFileSync(outPath, header + astToString(ast), 'utf8');
console.log(`[gen-scan-engine-api] wrote ${outPath} (${Object.keys(spec.paths).length} paths)`);
