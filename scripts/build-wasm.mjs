// pathfinder/wasm(Go, GOOS=js GOARCH=wasm)를 컴파일해서 dist-wasm/pathfinder.wasm +
// 그에 맞는 wasm_exec.js 글루 스크립트(현재 설치된 Go의 GOROOT에서 복사)를 만든다.
// 결과물은 이 저장소에 커밋하지 않는다(.gitignore 참고, dist/와 동일한 취급) --
// pathfinder/wasm/main.go가 진짜 소스이고, 이건 그 빌드 산출물일 뿐이다.
//
// 사용법: node scripts/build-wasm.mjs
// (ros-chromium/robot-os-chromium/packages/planner-wasm/vendor/에 이 결과물을
//  복사해 넣는 걸로 두 저장소를 연결한다 -- doc/architecture-improvements.md 참고)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GO_MODULE_DIR = resolve(__dirname, '../pathfinder');
const OUT_DIR = resolve(__dirname, '../dist-wasm');

mkdirSync(OUT_DIR, { recursive: true });

console.log('GOOS=js GOARCH=wasm go build -o dist-wasm/pathfinder.wasm ./wasm');
execFileSync('go', ['build', '-o', resolve(OUT_DIR, 'pathfinder.wasm'), './wasm'], {
  cwd: GO_MODULE_DIR,
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
  stdio: 'inherit',
});

const goroot = execFileSync('go', ['env', 'GOROOT']).toString().trim();
const wasmExecCandidates = [
  resolve(goroot, 'lib/wasm/wasm_exec.js'), // Go 1.24+
  resolve(goroot, 'misc/wasm/wasm_exec.js'), // older Go
];
const { existsSync } = await import('node:fs');
const wasmExecSrc = wasmExecCandidates.find(existsSync);
if (!wasmExecSrc) {
  throw new Error(`wasm_exec.js를 찾을 수 없습니다 (확인한 경로: ${wasmExecCandidates.join(', ')})`);
}
copyFileSync(wasmExecSrc, resolve(OUT_DIR, 'wasm_exec.js'));

console.log(`완료 -> ${OUT_DIR}/pathfinder.wasm, ${OUT_DIR}/wasm_exec.js (from ${wasmExecSrc})`);
