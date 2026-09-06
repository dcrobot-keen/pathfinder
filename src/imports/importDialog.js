// 지도 › 가져오기 -- 진입점 하나, 형식은 자동 판별, 결과는 레이어/현장.
//
// 예전엔 파일 형식마다 버튼이 있었다("스캔 가져오기", "슬라이스맵 파일", "PCD 업로드"). 이 프로젝트에서만
// 통하는 배치라, GIS/CAD 도구처럼 "가져오기" 하나 + 드래그앤드롭으로 바꾼다. 파일 이름으로 종류를 나누고,
// 처리가 필요한 종류(iPhone 스캔)만 스캔 위저드로 넘긴다. 아직 못 받는 형식은 숨기지 않고 "지원 예정"으로 보여 준다.
//
// 종류: scan(.zip/.usdz) · slicemap(.slicemap.json + .floor.png/.json) · pcd(.pcd) ·
//       pointcloud-other(.ply/.las/.laz, 예정) · robotmap(.pgm+.yaml → 현장) · image(.png/.jpg + 축척 → 바닥만 있는 현장) · unknown

const KIND_LABEL = {
  scan: 'iPhone 스캔',
  slicemap: '슬라이스맵',
  pcd: '포인트클라우드 (PCD)',
  'pointcloud-other': '포인트클라우드',
  robotmap: '로봇 SLAM 지도',
  image: '도면 이미지',
  unknown: '알 수 없는 형식',
};

/**
 * 파일 목록 -> 소스 목록. File 객체의 name 만 본다 (테스트 가능).
 * @param {{ name: string }[]} fileList
 * @returns {{ kind: string, files: any[], label: string, supported: boolean, note?: string }[]}
 */
export function detectSources(fileList) {
  const files = Array.from(fileList ?? []);
  const used = new Set();
  const out = [];
  const lower = (f) => f.name.toLowerCase();
  const take = (pred) => files.filter((f) => !used.has(f) && pred(lower(f)));

  // 슬라이스맵 (+ 같은 이름의 바닥 이미지 두 파일)
  for (const sm of take((n) => n.endsWith('.slicemap.json'))) {
    const stem = lower(sm).replace(/\.slicemap\.json$/, '');
    const png = files.find((f) => lower(f) === `${stem}.floor.png`);
    const json = files.find((f) => lower(f) === `${stem}.floor.json`);
    const group = [sm, png, json].filter(Boolean);
    group.forEach((f) => used.add(f));
    out.push({ kind: 'slicemap', files: group, label: `${KIND_LABEL.slicemap} · ${sm.name}${png && json ? ' + 바닥 이미지' : ''}`, supported: true, note: '현장 프로젝트 + 스캔 장애물을 만든다' });
  }
  // 짝 없는 바닥 이미지 사이드카는 단독으로 의미가 없다
  for (const f of take((n) => n.endsWith('.floor.png') || n.endsWith('.floor.json'))) {
    used.add(f);
    out.push({ kind: 'unknown', files: [f], label: `바닥 이미지 사이드카 · ${f.name}`, supported: false, note: '같은 이름의 .slicemap.json 과 함께 골라야 한다' });
  }
  for (const f of take((n) => n.endsWith('.zip') || n.endsWith('.usdz'))) {
    used.add(f);
    out.push({ kind: 'scan', files: [f], label: `${KIND_LABEL.scan} · ${f.name}`, supported: true, note: '스캔 위저드에서 처리(천장 제거 → 슬라이스맵 → 다중 스캔이면 정합)' });
  }
  for (const f of take((n) => n.endsWith('.pcd'))) {
    used.add(f);
    out.push({ kind: 'pcd', files: [f], label: `${KIND_LABEL.pcd} · ${f.name}`, supported: true, note: '3D 포인트와 높이 슬라이스 레이어' });
  }
  for (const f of take((n) => /\.(ply|las|laz|e57)$/.test(n))) {
    used.add(f);
    out.push({ kind: 'pointcloud-other', files: [f], label: `${KIND_LABEL['pointcloud-other']} · ${f.name}`, supported: false, note: '지원 예정 -- 지금은 PCD 로 변환해서 가져오세요' });
  }
  const pgm = take((n) => n.endsWith('.pgm'));
  const yaml = take((n) => n.endsWith('.yaml') || n.endsWith('.yml'));
  if (pgm.length || yaml.length) {
    [...pgm, ...yaml].forEach((f) => used.add(f));
    const complete = pgm.length > 0 && yaml.length > 0;
    out.push({ kind: 'robotmap', files: [...pgm, ...yaml], label: `${KIND_LABEL.robotmap} · ${[...pgm, ...yaml].map((f) => f.name).join(', ')}`, supported: complete, note: complete ? 'ROS map_server 지도 → 점유 셀을 벽으로 한 현장 프로젝트 (origin yaw 는 무시)' : '.pgm 과 .yaml 을 함께 골라야 한다' });
  }
  for (const f of take((n) => /\.(png|jpe?g|webp)$/.test(n))) {
    used.add(f);
    out.push({ kind: 'image', files: [f], label: `${KIND_LABEL.image} · ${f.name}`, supported: true, needsScale: true, metersPerPixel: 0.05, note: '축척을 입력하면 바닥 이미지만 있는 현장을 만든다 (원점 = 이미지 왼쪽 아래)' });
  }
  // 나머지 .json 은 이름이 다른 슬라이스맵일 수 있다 (내용은 가져올 때 검증)
  for (const f of take((n) => n.endsWith('.json'))) {
    used.add(f);
    out.push({ kind: 'slicemap', files: [f], label: `${KIND_LABEL.slicemap}? · ${f.name}`, supported: true, note: 'slicemap-v1 인지 내용으로 확인한다' });
  }
  for (const f of files.filter((f) => !used.has(f))) {
    out.push({ kind: 'unknown', files: [f], label: `${KIND_LABEL.unknown} · ${f.name}`, supported: false });
  }
  return out;
}

const ICON_IMPORT = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>';

/**
 * 가져오기 대화상자. open(files?) 로 열고, 지원되는 항목을 순서대로 처리한다.
 * @param {{ onScan: (file: File) => void|Promise<void>, onSlicemap: (files: File[]) => Promise<unknown>, onPcd: (file: File) => Promise<unknown>,
 *           onRobotMap?: (files: File[]) => Promise<unknown>, onImage?: (file: File, metersPerPixel: number) => Promise<unknown>, onToast?: (msg: string) => void }} handlers
 */
export function createImportDialog({ onScan, onSlicemap, onPcd, onRobotMap, onImage, onToast = () => {} }) {
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div class="import-dialog__head">
        <div><div id="import-title" class="import-dialog__title">가져오기</div><div class="import-dialog__sub">파일을 놓으면 종류를 알아보고, 처리가 필요한 것만 위저드로 이어집니다.</div></div>
        <button class="robot-button" data-act="close" aria-label="닫기">닫기</button>
      </div>
      <div class="import-drop" tabindex="0">
        <span class="import-drop__icon">${ICON_IMPORT}</span>
        <div><b>여기에 파일을 놓거나 클릭해서 선택</b><div class="import-drop__hint">iPhone 스캔 .zip/.usdz · 슬라이스맵 .slicemap.json (+ .floor.png/.json) · 포인트클라우드 .pcd · 로봇 지도 .pgm+.yaml · 도면 .png/.jpg</div></div>
        <input type="file" multiple hidden accept=".zip,.usdz,.json,.png,.jpg,.jpeg,.pcd,.ply,.las,.laz,.pgm,.yaml,.yml">
      </div>
      <div class="import-list"></div>
      <div class="import-dialog__foot">
        <span class="import-dialog__status"></span>
        <button class="robot-button" data-act="close">취소</button>
        <button class="robot-button robot-button-primary" data-act="run" disabled>가져오기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  const listEl = $('.import-list');
  const runBtn = $('[data-act="run"]');
  const statusEl = $('.import-dialog__status');
  const input = $('input[type=file]');
  const drop = $('.import-drop');
  let sources = [];

  function render() {
    listEl.replaceChildren();
    for (const s of sources) {
      const row = document.createElement('div');
      row.className = `import-item${s.supported ? '' : ' import-item--unsupported'}`;
      row.innerHTML = `<span class="import-item__kind">${s.supported ? '가져옴' : '지원 예정'}</span><div><div class="import-item__label">${s.label}</div>${s.note ? `<div class="import-item__note">${s.note}</div>` : ''}</div>`;
      if (s.needsScale) {
        const scale = document.createElement('label');
        scale.className = 'import-item__scale';
        scale.innerHTML = `축척 <input type="number" min="0.001" step="0.005" value="${s.metersPerPixel}"> m/px`;
        scale.querySelector('input').addEventListener('input', (e) => { s.metersPerPixel = Number(/** @type {HTMLInputElement} */ (e.target).value); });
        row.querySelector('div').appendChild(scale);
      }
      listEl.appendChild(row);
    }
    runBtn.disabled = !sources.some((s) => s.supported);
    statusEl.textContent = sources.length ? `${sources.filter((s) => s.supported).length}개 가져옴 · ${sources.filter((s) => !s.supported).length}개 지원 예정` : '';
  }
  function setFiles(files) {
    sources = detectSources(files);
    render();
  }
  function close() { overlay.hidden = true; }
  function open(files) {
    sources = [];
    render();
    overlay.hidden = false;
    if (files && files.length) setFiles(files);
  }

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files?.length) setFiles(input.files); input.value = ''; });
  for (const evt of ['dragenter', 'dragover']) drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  for (const evt of ['dragleave', 'drop']) drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove('dragover'); });
  drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) setFiles(e.dataTransfer.files); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  for (const b of overlay.querySelectorAll('[data-act="close"]')) b.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (!overlay.hidden && e.key === 'Escape') close(); });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    const todo = sources.filter((s) => s.supported);
    let done = 0;
    try {
      for (const s of todo) {
        statusEl.textContent = `${s.label} 처리 중…`;
        if (s.kind === 'scan') { close(); await onScan(s.files[0]); return; } // 위저드가 이어받는다
        if (s.kind === 'slicemap') await onSlicemap(s.files);
        if (s.kind === 'pcd') await onPcd(s.files[0]);
        if (s.kind === 'robotmap' && onRobotMap) await onRobotMap(s.files);
        if (s.kind === 'image' && onImage) await onImage(s.files[0], s.metersPerPixel);
        done++;
      }
      onToast(`${done}개 가져왔습니다`);
      close();
    } catch (err) {
      statusEl.textContent = `실패: ${err.message}`;
      runBtn.disabled = false;
    }
  });

  return { open, close, detectSources };
}

/** 화면 전체에 드롭을 받아 대화상자로 넘긴다 (지도 워크스페이스에서만). */
export function attachDropTarget(el, dialog, { isActive = () => true } = {}) {
  let depth = 0;
  el.addEventListener('dragenter', (e) => { if (!isActive()) return; e.preventDefault(); depth++; el.classList.add('drop-active'); });
  el.addEventListener('dragover', (e) => { if (!isActive()) return; e.preventDefault(); });
  el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (depth === 0) el.classList.remove('drop-active'); });
  el.addEventListener('drop', (e) => {
    if (!isActive()) return;
    e.preventDefault(); depth = 0; el.classList.remove('drop-active');
    if (e.dataTransfer?.files?.length) dialog.open(e.dataTransfer.files);
  });
}
