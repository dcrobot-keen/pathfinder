"""Self-contained HTML workspace for aligning several scans' slicemaps by hand
(drag / pivot-rotate / keyboard nudges / pin pairs) with live quality gauges,
and saving the result as a scan-group-alignment-v1 file.

Phase 1 of the alignment strategy: everything runs in the page, no server.
The ICP button is present but locked until the FastAPI endpoint exists
(Phase 2); the page already computes the overlap gauge that will gate it.

Data flow
    slicemaps + alignment  -->  build_alignment_workspace_html()  -->  one .html
    (person aligns, approves)  -->  "저장" downloads group_alignment.json
    -->  scripts/merge_slicemaps.py <that file> ...  -->  merged slicemap/world

The JS mirrors studio/scan_alignment_metrics.py (overlap/inlier/conflict,
pin fit) and merge_slicemaps.ScanAlignment (the ARKit (x, z) <-> slice
(x, -z) mapping). Keep the three in step; tests/test_align_workspace.py pins
the Python side, and the page shows the same numbers for the loaded pose so
a mismatch is visible on open.
"""
from __future__ import annotations

import base64
import json
from typing import Iterable

import numpy as np

from studio.merge_slicemaps import GroupAlignment, Slice
from studio.scan_alignment_metrics import CONFLICT_MARGIN_CELLS, evaluate


def _slice_payload(scan_id: str, s: Slice) -> dict:
    return {
        "id": scan_id,
        "cols": s.cols,
        "rows": s.rows,
        "resolution": s.resolution,
        "origin": [s.origin[0], s.origin[1]],
        "z": s.z,
        "data": base64.b64encode(np.ascontiguousarray(s.codes, dtype=np.uint8).tobytes()).decode("ascii"),
    }


def workspace_payload(
    slices: dict[str, Slice],
    ga: GroupAlignment,
    title: str = "스캔 정합 워크스페이스",
    order: Iterable[str] | None = None,
    api: dict | None = None,
    floors: dict | None = None,
) -> dict:
    """Everything the alignment UI needs: per-scan slice cells (b64), current alignment,
    metrics, the app floor image (data URL), gates and API urls. Embedded into the
    standalone page (build_alignment_workspace_html) and served as JSON to Fleet Studio's
    native workspace (GET /api/groups/{name}/workspace)."""
    ids = list(order) if order is not None else [ga.reference] + [k for k in slices if k != ga.reference]
    if ga.reference not in slices:
        raise ValueError(f"reference {ga.reference!r} has no slicemap")

    layers = []
    for sid in ids:
        a = ga.get(sid)
        others = [(slices[o], ga.get(o)) for o in ids if o != sid]
        m = evaluate(slices[sid], a, others) if sid != ga.reference else None
        fp = floors.get(sid) if floors else None
        layers.append({
            **_slice_payload(sid, slices[sid]),
            "alignment": {"offsetX": a.offsetX, "offsetZ": a.offsetZ, "yawRadians": a.yawRadians, "method": a.method},
            "metrics": m.to_json() if m else None,
            "floor": fp.payload() if fp is not None else None,
        })

    return {
        "title": title,
        "group": ga.group,
        "reference": ga.reference,
        "layers": layers,
        "gates": {"overlapLockM": 1.5, "inlierMin": 0.60, "conflictMax": 0.12, "corrDist": 0.15, "coarseDist": 0.5,
                  "conflictMargin": CONFLICT_MARGIN_CELLS},
        "api": api,
    }


def build_alignment_workspace_html(
    slices: dict[str, Slice],
    ga: GroupAlignment,
    title: str = "스캔 정합 워크스페이스",
    order: Iterable[str] | None = None,
    api: dict | None = None,
    floors: dict | None = None,
) -> str:
    """`api` (from studio/groups.py when served): {"save": PUT url, "icp": POST
    url, "merged": png url, "status": url}. With it the page saves to the
    server (which rebuilds + publishes the merged slicemap) and the ICP
    button works; without it the page is the offline file (download save).
    `floors` (scan id -> studio.floorplan.FloorPlan): the app's floor images,
    drawn under each slice with the same alignment so the operator lines up
    real floor texture, not just wall cells."""
    payload = workspace_payload(slices, ga, title=title, order=order, api=api, floors=floors)
    data_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    return _TEMPLATE.replace("__TITLE__", title).replace("__DATA__", data_json)


_TEMPLATE = r"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
  :root{--bg:#F3F4F0;--paper:#FBFBF8;--ink:#1C2024;--muted:#68717A;--line:#CFD4CF;--ref:#2F7F74;--cand:#C9741F;--danger:#A8443A;--ok:#3F6B52;--code:#ECEEE8}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.5 'IBM Plex Sans KR','Malgun Gothic',system-ui,sans-serif;color:var(--ink);background:var(--bg);height:100vh;display:grid;grid-template-rows:auto 1fr;overflow:hidden}
  header{display:flex;align-items:baseline;gap:16px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--paper)}
  header h1{font-size:15px;margin:0;font-weight:600}
  header .sub{color:var(--muted);font-size:12.5px;font-family:'IBM Plex Mono',Consolas,monospace}
  main{display:grid;grid-template-columns:250px 1fr 280px;min-height:0}
  aside{background:var(--paper);border-right:1px solid var(--line);padding:12px;overflow:auto}
  aside.right{border-right:none;border-left:1px solid var(--line)}
  h2{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px;font-weight:500;font-family:'IBM Plex Mono',Consolas,monospace}
  h2:first-child{margin-top:0}
  .layer{display:grid;grid-template-columns:14px 1fr auto;gap:8px;align-items:center;padding:7px 8px;border:1px solid var(--line);margin-bottom:6px;cursor:pointer;background:#fff}
  .layer.sel{border-color:var(--cand);background:#F6E4D0}
  .layer.ref{border-color:var(--ref)}
  .layer .sw{width:12px;height:12px;border-radius:2px}
  .layer .name{font-family:'IBM Plex Mono',Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .layer .meta{font-size:11px;color:var(--muted)}
  .layer input{margin:0}
  #wrap{position:relative;min-width:0;min-height:0;background:var(--bg)}
  canvas{display:block;width:100%;height:100%;cursor:grab}
  canvas.pin{cursor:crosshair}
  #hint{position:absolute;left:12px;bottom:10px;font-size:12px;color:var(--muted);background:rgba(251,251,248,.85);padding:4px 8px;border:1px solid var(--line);font-family:'IBM Plex Mono',Consolas,monospace}
  #status{position:absolute;left:12px;top:10px;font-size:12.5px;color:var(--ink);background:rgba(251,251,248,.92);padding:4px 8px;border:1px solid var(--line);display:none}
  .kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:12.5px;align-items:center}
  .kv input{width:100%;font:inherit;padding:3px 6px;border:1px solid var(--line);background:#fff;text-align:right}
  .gauge{margin:6px 0 10px}
  .gauge .lbl{display:flex;justify-content:space-between;font-family:'IBM Plex Mono',Consolas,monospace;font-size:12px;color:var(--muted)}
  .gauge .bar{height:8px;background:var(--code);position:relative;margin-top:3px}
  .gauge .bar i{position:absolute;left:0;top:0;bottom:0;background:var(--ref)}
  .gauge .bar i.bad{background:var(--danger)}
  .gauge .bar b{position:absolute;top:-2px;bottom:-2px;width:1px;background:var(--ink);opacity:.5}
  button{font:inherit;width:100%;padding:7px 10px;margin:4px 0;border:1px solid var(--line);background:#fff;cursor:pointer;text-align:left}
  button:hover{border-color:var(--ink)}
  button.primary{border-color:var(--cand);background:#F6E4D0}
  button.ok{border-color:var(--ref);background:#D9ECE8}
  button.on{outline:2px solid var(--cand)}
  button:disabled{color:var(--muted);cursor:not-allowed;background:var(--code)}
  .note{font-size:12px;color:var(--muted);margin:4px 0 8px}
  .note.warn{color:var(--danger)}
  label.chk{display:flex;gap:8px;align-items:center;font-size:13px;margin:8px 0}
  #pins{font-family:'IBM Plex Mono',Consolas,monospace;font-size:12px;color:var(--muted);margin:4px 0}
  #pins div{display:flex;justify-content:space-between}
</style>
</head>
<body>
<header>
  <h1>__TITLE__</h1>
  <span class="sub" id="groupName"></span>
  <span class="sub" style="margin-left:auto">기준 <span id="refName"></span></span>
</header>
<main>
  <aside>
    <h2>스캔</h2>
    <div id="layers"></div>
    <label class="chk" id="floorRow" style="display:none"><input type="checkbox" id="chkFloor" checked> 바닥 이미지 (앱 floorplan) &nbsp;<input id="floorAlpha" type="range" min="0.1" max="1" step="0.1" value="0.9" style="width:70px;vertical-align:middle"></label>
    <div class="note">기준 스캔은 고정. 다른 스캔을 골라 가운데에서 끌어 움직입니다. 체크박스로 표시를 끕니다.</div>
    <h2>범례</h2>
    <div class="note"><span style="color:var(--ref)">■</span> 기준 · <span style="color:var(--cand)">■</span> 선택 · <span style="color:#7d848a">■</span> 나머지 · <span style="color:var(--danger)">■</span> conflict(상대가 바닥으로 본 자리의 벽)</div>
  </aside>
  <div id="wrap">
    <canvas id="c"></canvas>
    <div id="status"></div>
    <div id="hint">드래그: 선택 스캔 이동(빈 곳은 화면 이동) · 휠: 확대 · Alt+휠 / [ ]: 회전 · 방향키: 1 cm(Shift 10 cm) · F: 전체 보기</div>
  </div>
  <aside class="right">
    <h2>선택 스캔</h2>
    <div class="kv">
      <span>스캔</span><span id="selName" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">–</span>
      <span>출처</span><span id="selMethod">–</span>
      <span>offsetX</span><input id="inX" type="number" step="0.01">
      <span>offsetZ</span><input id="inZ" type="number" step="0.01">
      <span>yaw °</span><input id="inYaw" type="number" step="0.5">
    </div>
    <h2>품질</h2>
    <div class="gauge"><div class="lbl"><span>겹침 벽 길이</span><span id="gOverlap">–</span></div><div class="bar"><i id="bOverlap"></i><b style="left:15%"></b></div></div>
    <div class="gauge"><div class="lbl"><span>inlier</span><span id="gInlier">–</span></div><div class="bar"><i id="bInlier"></i><b style="left:60%"></b></div></div>
    <div class="gauge"><div class="lbl"><span>conflict</span><span id="gConflict">–</span></div><div class="bar"><i id="bConflict" class="bad"></i><b style="left:12%"></b></div></div>
    <div class="note" id="verdict">스캔을 고르세요.</div>
    <h2>동작</h2>
    <button id="btnPin" class="primary">기준점 쌍 찍기</button>
    <div id="pins"></div>
    <button id="btnFit" disabled>기준점 쌍으로 맞추기</button>
    <button id="btnIcp" disabled>ICP 마무리</button>
    <div class="note" id="icpNote"></div>
    <button id="btnIcpUndo" hidden>ICP 결과 취소</button>
    <button id="btnRevert">불러온 값으로 되돌리기</button>
    <h2>확정</h2>
    <label class="chk"><input type="checkbox" id="chkApprove"> 이 스캔 승인</label>
    <button id="btnSave" class="ok">group_alignment.json 저장</button>
    <div class="note" id="saveNote">저장한 파일을 <code>scripts/merge_slicemaps.py</code>에 넘기면 합성 slicemap과 시뮬레이터 월드가 갱신됩니다.</div>
    <div id="saveResult" class="note" hidden></div>
  </aside>
</main>
<script>
const DATA = __DATA__;
const G = DATA.gates;
const $ = (id) => document.getElementById(id);
const COLORS = { ref: [47,127,116], sel: [201,116,31], other: [125,132,138] };

// ---------------- alignment math (== merge_slicemaps.ScanAlignment) ----------------
// slice plane (x, y) = (x_arkit, -z_arkit); apply = CCW rotate by yaw, then translate (offsetX, -offsetZ)
function applyXY(a, x, y) { const c = Math.cos(a.yaw), s = Math.sin(a.yaw); return [c*x - s*y + a.ox, s*x + c*y - a.oz]; }
function inverseXY(a, x, y) { const c = Math.cos(a.yaw), s = Math.sin(a.yaw); const dx = x - a.ox, dy = y + a.oz; return [c*dx + s*dy, -s*dx + c*dy]; }

// ---------------- layers ----------------
const b64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const layers = DATA.layers.map((L) => {
  const codes = b64(L.data);
  // every occupied cell (wall or furniture tag) -- the classifier's wall tag is not
  // trusted as a filter (== scan_alignment_metrics.wall_points)
  const walls = [];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    const v = codes[r * L.cols + c];
    if (v === 3 || v === 2) walls.push(L.origin[0] + (c + 0.5) * L.resolution, L.origin[1] + (r + 0.5) * L.resolution);
  }
  // deepFree: FREE cells >= conflictMargin 4-connected steps from any non-free cell
  // (== scan_alignment_metrics.deep_free_mask, scipy binary_erosion with the cross
  // element applied `margin` times). Conflict is only counted on these cells.
  let deepFree = new Uint8Array(codes.length);
  for (let i = 0; i < codes.length; i++) deepFree[i] = codes[i] === 1 ? 1 : 0;
  for (let it = 0; it < G.conflictMargin; it++) {
    const next = new Uint8Array(codes.length);
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      const i = r * L.cols + c;
      if (!deepFree[i]) continue;
      const up = r > 0 ? deepFree[i - L.cols] : 0, down = r < L.rows - 1 ? deepFree[i + L.cols] : 0;
      const left = c > 0 ? deepFree[i - 1] : 0, right = c < L.cols - 1 ? deepFree[i + 1] : 0;
      next[i] = (up && down && left && right) ? 1 : 0;
    }
    deepFree = next;
  }
  const a = L.alignment;
  const al = { ox: a.offsetX, oz: a.offsetZ, yaw: a.yawRadians };
  return {
    id: L.id, cols: L.cols, rows: L.rows, res: L.resolution, origin: L.origin, codes, deepFree,
    walls: new Float64Array(walls), visible: true,
    align: { ...al }, loaded: { ...al }, method: a.method, loadedMethod: a.method,
    approved: false, dirty: false, imgs: {},
    isRef: L.id === DATA.reference,
    floor: L.floor, floorImg: null,
  };
});
// 앱 바닥 이미지(floorplan.png)를 레이어마다 비동기로 올린다 -- 로드되는 대로 다시 그림.
let showFloor = true, floorAlpha = 0.9;
for (const L of layers) {
  if (!L.floor) continue;
  const img = new Image();
  img.onload = () => draw();
  img.src = L.floor.dataUrl;
  L.floorImg = img;
}
if (layers.some((l) => l.floor)) {
  $('floorRow').style.display = '';
  $('chkFloor').addEventListener('change', (e) => { showFloor = e.target.checked; draw(); });
  $('floorAlpha').addEventListener('input', (e) => { floorAlpha = Number(e.target.value); draw(); });
}
const refLayer = layers.find((l) => l.isRef);
let selected = layers.find((l) => !l.isRef) || null;

function layerImage(L, role) {
  if (L.imgs[role]) return L.imgs[role];
  const cv = document.createElement('canvas'); cv.width = L.cols; cv.height = L.rows;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(L.cols, L.rows);
  const [R, Gc, B] = COLORS[role];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    const v = L.codes[r * L.cols + c];
    const o = ((L.rows - 1 - r) * L.cols + c) * 4;   // row 0 (min y) drawn at the bottom
    let alpha = 0;
    if (v === 1) alpha = 28; else if (v === 2) alpha = 150; else if (v === 3) alpha = 235;
    img.data[o] = R; img.data[o + 1] = Gc; img.data[o + 2] = B; img.data[o + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  L.imgs[role] = cv; return cv;
}

// ---------------- view ----------------
const canvas = $('c'), ctx = canvas.getContext('2d');
const view = { scale: 60, x0: 0, y0: 0 };  // px per metre, world coords of the bottom-left corner
function resize() { const r = canvas.parentElement.getBoundingClientRect(); canvas.width = r.width; canvas.height = r.height; draw(); }
function fitAll() {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const L of layers) {
    const x0 = L.origin[0], y0 = L.origin[1], x1 = x0 + L.cols * L.res, y1 = y0 + L.rows * L.res;
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const [px, py] = applyXY(L.align, x, y); minx = Math.min(minx, px); maxx = Math.max(maxx, px); miny = Math.min(miny, py); maxy = Math.max(maxy, py); }
  }
  const pad = 0.5;
  view.scale = Math.min(canvas.width / (maxx - minx + 2 * pad), canvas.height / (maxy - miny + 2 * pad));
  view.x0 = (minx + maxx) / 2 - canvas.width / view.scale / 2;
  view.y0 = (miny + maxy) / 2 - canvas.height / view.scale / 2;
  draw();
}
const toCanvas = (x, y) => [(x - view.x0) * view.scale, canvas.height - (y - view.y0) * view.scale];
const toWorld = (px, py) => [px / view.scale + view.x0, (canvas.height - py) / view.scale + view.y0];

function draw() {
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  // 0.5 m grid
  ctx.strokeStyle = '#E3E6E0'; ctx.lineWidth = 1;
  const step = view.scale >= 40 ? 0.5 : (view.scale >= 12 ? 1 : 5);
  const gx0 = Math.floor(view.x0 / step) * step, gy0 = Math.floor(view.y0 / step) * step;
  ctx.beginPath();
  for (let x = gx0; x < view.x0 + W / view.scale; x += step) { const [px] = toCanvas(x, 0); ctx.moveTo(px, 0); ctx.lineTo(px, H); }
  for (let y = gy0; y < view.y0 + H / view.scale; y += step) { const [, py] = toCanvas(0, y); ctx.moveTo(0, py); ctx.lineTo(W, py); }
  ctx.stroke();
  // axes of the reference frame
  ctx.strokeStyle = '#AEB6B0'; ctx.lineWidth = 1.5; ctx.beginPath();
  { const [ox, oy] = toCanvas(0, 0); ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy); ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8); } ctx.stroke();

  const V = new DOMMatrix([view.scale, 0, 0, -view.scale, -view.scale * view.x0, H + view.scale * view.y0]);
  const ordered = [...layers.filter((l) => l !== selected), ...(selected ? [selected] : [])];
  for (const L of ordered) {
    if (!L.visible) continue;
    const role = L.isRef ? 'ref' : (L === selected ? 'sel' : 'other');
    const a = L.align, c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    const A = new DOMMatrix([c, s, -s, c, a.ox, -a.oz]);
    const Lm = new DOMMatrix([L.res, 0, 0, -L.res, L.origin[0], L.origin[1] + L.rows * L.res]);
    if (showFloor && L.floorImg && L.floorImg.complete && L.floorImg.naturalWidth > 0) {
      // floorplan pixel (col,row) -> slice plane (originX + col*res, -(originTopZ + row*res)):
      // top row = max y, i.e. the image is already the right way up.
      const f = L.floor;
      const Fm = new DOMMatrix([f.resolution, 0, 0, -f.resolution, f.originX, -f.originTopZ]);
      const MF = V.multiply(A).multiply(Fm);
      ctx.setTransform(MF.a, MF.b, MF.c, MF.d, MF.e, MF.f);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = floorAlpha * ((L === selected || L.isRef) ? 1 : 0.7);
      ctx.drawImage(L.floorImg, 0, 0, f.width, f.height);
    }
    const M = V.multiply(A).multiply(Lm);
    ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = (L === selected || L.isRef) ? 1 : 0.7;
    ctx.drawImage(layerImage(L, role), 0, 0, L.cols, L.rows);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;

  // conflict points of the selected scan + pivot + pins
  if (selected && lastMetrics && lastMetrics.conflictPts) {
    ctx.fillStyle = '#A8443A';
    for (const [x, y] of lastMetrics.conflictPts) { const [px, py] = toCanvas(x, y); ctx.fillRect(px - 1.5, py - 1.5, 3, 3); }
  }
  if (selected) {
    const [cx, cy] = centroidRef(selected); const [px, py] = toCanvas(cx, cy);
    ctx.strokeStyle = '#C9741F'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke();
  }
  pins.forEach((p, i) => {
    if (p.src) { const [x, y] = applyXY(selected ? selected.align : {ox:0,oz:0,yaw:0}, p.src[0], p.src[1]); const [px, py] = toCanvas(x, y); dot(px, py, '#C9741F', String(i + 1)); }
    if (p.ref) { const [px, py] = toCanvas(p.ref[0], p.ref[1]); dot(px, py, '#2F7F74', String(i + 1)); }
    if (p.src && p.ref) { const [x, y] = applyXY(selected.align, p.src[0], p.src[1]); const [ax, ay] = toCanvas(x, y); const [bx, by] = toCanvas(p.ref[0], p.ref[1]); ctx.strokeStyle = '#1C2024'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
  });
}
function dot(px, py, color, label) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#1C2024'; ctx.font = '11px IBM Plex Mono, monospace'; ctx.fillText(label, px + 7, py - 6); }

function centroidRef(L) {
  let sx = 0, sy = 0, n = L.walls.length / 2;
  for (let i = 0; i < L.walls.length; i += 2) { sx += L.walls[i]; sy += L.walls[i + 1]; }
  return applyXY(L.align, sx / n, sy / n);
}

// ---------------- metrics (== scan_alignment_metrics.evaluate) ----------------
let lastMetrics = null;
function computeMetrics(L) {
  if (!L || L.isRef) return null;
  const others = layers.filter((o) => o !== L && o.visible);
  // hash cell = the coarse radius, so a 3x3 neighbourhood covers every point within it
  const cell = G.coarseDist, hash = new Map();
  const key = (x, y) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663);
  for (const o of others) for (let i = 0; i < o.walls.length; i += 2) {
    const [x, y] = applyXY(o.align, o.walls[i], o.walls[i + 1]); const k = key(x, y);
    let arr = hash.get(k); if (!arr) hash.set(k, (arr = [])); arr.push(x, y);
  }
  // overlap is measured at the coarse radius (ICP's reach); inlier/rmse at the tight
  // one (aligned or not). Ratios are over the OBSERVED subset: source walls that land
  // where some other scan actually looked (free or occupied). Walls in the others'
  // unknown area say nothing either way (== scan_alignment_metrics.evaluate).
  const n = L.walls.length / 2; let inl = 0, coarse = 0, inlObs = 0, obs = 0, sq = 0; const conflictPts = [];
  for (let i = 0; i < L.walls.length; i += 2) {
    const [x, y] = applyXY(L.align, L.walls[i], L.walls[i + 1]);
    let best = Infinity;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = hash.get(((cx + dx) * 73856093) ^ ((cy + dy) * 19349663)); if (!arr) continue;
      for (let j = 0; j < arr.length; j += 2) { const d = Math.hypot(arr[j] - x, arr[j + 1] - y); if (d < best) best = d; }
    }
    if (best <= cell) coarse++;
    const matched = best <= G.corrDist;
    if (matched) { inl++; sq += best * best; }
    let observed = false, conflict = false;
    for (const o of others) {
      const [lx, ly] = inverseXY(o.align, x, y);
      const c = Math.floor((lx - o.origin[0]) / o.res), r = Math.floor((ly - o.origin[1]) / o.res);
      if (c < 0 || c >= o.cols || r < 0 || r >= o.rows) continue;
      const v = o.codes[r * o.cols + c];
      if (v !== 0) observed = true;
      if (o.deepFree[r * o.cols + c]) conflict = true;
    }
    if (observed) { obs++; if (matched) inlObs++; if (conflict) conflictPts.push([x, y]); }
  }
  return { n, observed: obs, overlapM: coarse * L.res, inlier: obs ? inlObs / obs : 0, conflict: obs ? conflictPts.length / obs : 0, rmse: inl ? Math.sqrt(sq / inl) : null, conflictPts };
}
function updatePanel() {
  if (!selected) { $('selName').textContent = '–'; $('verdict').textContent = '스캔을 고르세요.'; return; }
  const L = selected, a = L.align;
  $('selName').textContent = L.id; $('selName').title = L.id;
  $('selMethod').textContent = L.method + (L.dirty ? ' (수정됨)' : '');
  $('inX').value = a.ox.toFixed(3); $('inZ').value = a.oz.toFixed(3); $('inYaw').value = (a.yaw * 180 / Math.PI).toFixed(2);
  const m = lastMetrics = computeMetrics(L);
  $('gOverlap').textContent = m.overlapM.toFixed(2) + ' m'; $('bOverlap').style.width = Math.min(100, m.overlapM / 10 * 100) + '%';
  $('gInlier').textContent = m.inlier.toFixed(2); $('bInlier').style.width = (m.inlier * 100) + '%';
  $('gConflict').textContent = m.conflict.toFixed(2); $('bConflict').style.width = (m.conflict * 100) + '%';
  const locked = m.overlapM < G.overlapLockM;
  const pass = !locked && m.inlier >= G.inlierMin && m.conflict <= G.conflictMax;
  const v = $('verdict'); v.className = 'note' + (pass ? '' : ' warn');
  v.textContent = locked ? `겹치는 벽이 ${m.overlapM.toFixed(2)} m라 ICP로 맞출 근거가 없습니다. 기준점 쌍(문틀 모서리 등)으로 놓으세요.`
    : pass ? `통과 기준 안: inlier ≥ ${G.inlierMin}, conflict ≤ ${G.conflictMax}.`
    : m.conflict > G.conflictMax ? `벽이 상대 스캔의 바닥 위에 ${(m.conflict * 100).toFixed(0)}% 놓여 있습니다. 자리가 틀렸을 가능성이 큽니다.`
    : `대응 비율이 ${(m.inlier * 100).toFixed(0)}%로 낮습니다. 더 가깝게 놓고 다시 보세요.`;
  const icpAvailable = !!(DATA.api && DATA.api.icp);
  $('btnIcp').disabled = locked || !icpAvailable;
  $('icpNote').textContent = locked ? `ICP 잠김: 겹치는 벽 ${m.overlapM.toFixed(2)} m < ${G.overlapLockM} m`
    : icpAvailable ? '현재 자리를 초기값으로 서버 ICP(0.5 → 0.25 → 0.15 m)를 돌립니다. 결과는 게이지로 확인 후 취소할 수 있습니다.'
    : 'ICP는 서버에서 연 페이지(/groups/…)에서만 동작합니다.';
  $('chkApprove').checked = L.approved;
  renderLayerList();
}

// ---------------- layer list ----------------
function renderLayerList() {
  const box = $('layers'); box.innerHTML = '';
  for (const L of layers) {
    const el = document.createElement('div');
    el.className = 'layer' + (L.isRef ? ' ref' : '') + (L === selected ? ' sel' : '');
    const role = L.isRef ? 'ref' : (L === selected ? 'sel' : 'other'); const [r, g, b] = COLORS[role];
    el.innerHTML = `<span class="sw" style="background:rgb(${r},${g},${b})"></span>
      <span><div class="name" title="${L.id}">${L.id}</div>
      <div class="meta">${L.isRef ? '기준 (고정)' : L.method + (L.approved ? ' · 승인' : '') + (L.dirty ? ' · 수정됨' : '')}</div></span>
      <input type="checkbox" ${L.visible ? 'checked' : ''} title="표시">`;
    el.querySelector('input').addEventListener('change', (e) => { L.visible = e.target.checked; updatePanel(); draw(); });
    el.querySelector('input').addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('click', () => { if (!L.isRef) { selected = L; pins = []; pinMode = false; $('btnPin').classList.remove('on'); canvas.classList.remove('pin'); renderPins(); updatePanel(); draw(); } });
    box.appendChild(el);
  }
}

// ---------------- interaction ----------------
let drag = null, pinMode = false, pins = [];
function nearestWall(L, x, y, maxD) {  // x, y in ref frame -> nearest wall point (ref frame) of L
  let best = null, bd = maxD;
  for (let i = 0; i < L.walls.length; i += 2) { const [px, py] = applyXY(L.align, L.walls[i], L.walls[i + 1]); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = [px, py]; } }
  return best;
}
function markDirty(method) { if (!selected) return; selected.dirty = true; selected.method = method; selected.approved = false; }
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect(); const [x, y] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  if (pinMode && selected) {
    const cur = pins[pins.length - 1];
    if (!cur || (cur.src && cur.ref)) {   // new pair: first click = point on the SELECTED scan
      const snap = nearestWall(selected, x, y, 0.25) || [x, y];
      pins.push({ src: inverseXY(selected.align, snap[0], snap[1]), ref: null });
    } else {                                 // second click = same physical spot on any OTHER scan
      let snap = null;
      for (const o of layers) if (o !== selected && o.visible) { const s = nearestWall(o, x, y, 0.25); if (s) { snap = s; break; } }
      cur.ref = snap || [x, y];
    }
    renderPins(); draw(); return;
  }
  if (selected && selected.visible && nearestWall(selected, x, y, 0.35)) drag = { kind: 'layer', x, y, ox: selected.align.ox, oz: selected.align.oz };
  else drag = { kind: 'pan', px: e.clientX, py: e.clientY, x0: view.x0, y0: view.y0 };
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (drag.kind === 'pan') { view.x0 = drag.x0 - (e.clientX - drag.px) / view.scale; view.y0 = drag.y0 + (e.clientY - drag.py) / view.scale; draw(); return; }
  const rect = canvas.getBoundingClientRect(); const [x, y] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  selected.align.ox = drag.ox + (x - drag.x); selected.align.oz = drag.oz - (y - drag.y);  // slice dy = -d(offsetZ)
  markDirty('manual'); updatePanel(); draw();
});
window.addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.altKey && selected) { rotateSelected(-Math.sign(e.deltaY) * 0.5 * Math.PI / 180); return; }
  const rect = canvas.getBoundingClientRect(); const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; view.scale *= f;
  const [nx, ny] = toWorld(e.clientX - rect.left, e.clientY - rect.top); view.x0 += wx - nx; view.y0 += wy - ny; draw();
}, { passive: false });
function rotateSelected(dyaw) {   // about the selected scan's wall centroid, so it doesn't fly away
  const L = selected; const [cx, cy] = centroidRef(L);
  L.align.yaw += dyaw;
  const [nx, ny] = centroidRef(L); L.align.ox += cx - nx; L.align.oz -= cy - ny;
  markDirty('manual'); updatePanel(); draw();
}
function nudge(dx, dy) { selected.align.ox += dx; selected.align.oz -= dy; markDirty('manual'); updatePanel(); draw(); }
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'f' || e.key === 'F') { fitAll(); return; }
  if (e.key === 'Escape') { pinMode = false; $('btnPin').classList.remove('on'); canvas.classList.remove('pin'); draw(); return; }
  if (!selected) return;
  const step = e.shiftKey ? 0.10 : 0.01, rot = (e.shiftKey ? 5 : 0.5) * Math.PI / 180;
  if (e.key === 'ArrowLeft') nudge(-step, 0); else if (e.key === 'ArrowRight') nudge(step, 0);
  else if (e.key === 'ArrowUp') nudge(0, step); else if (e.key === 'ArrowDown') nudge(0, -step);
  else if (e.key === '[') rotateSelected(rot); else if (e.key === ']') rotateSelected(-rot); else return;
  e.preventDefault();
});
for (const [id, k] of [['inX', 'ox'], ['inZ', 'oz'], ['inYaw', 'yaw']]) $(id).addEventListener('change', (e) => {
  if (!selected) return; let v = parseFloat(e.target.value); if (!isFinite(v)) return; if (k === 'yaw') v = v * Math.PI / 180;
  selected.align[k] = v; markDirty('manual'); updatePanel(); draw();
});

// ---------------- pins (== scan_alignment_metrics.pin_fit, 2-D Kabsch closed form) ----------------
$('btnPin').addEventListener('click', () => { if (!selected) return; pinMode = !pinMode; $('btnPin').classList.toggle('on', pinMode); canvas.classList.toggle('pin', pinMode); if (pinMode) $('status').textContent = ''; });
function renderPins() {
  const box = $('pins'); box.innerHTML = '';
  const complete = pins.filter((p) => p.src && p.ref);
  pins.forEach((p, i) => {
    const row = document.createElement('div');
    let res = '';
    if (p.src && p.ref && selected) { const [x, y] = applyXY(selected.align, p.src[0], p.src[1]); res = Math.hypot(x - p.ref[0], y - p.ref[1]).toFixed(3) + ' m'; }
    row.innerHTML = `<span>pin ${i + 1} ${p.ref ? '' : '(상대 스캔의 같은 지점을 클릭)'}</span><span>${res}</span>`;
    box.appendChild(row);
  });
  if (pins.length) { const clr = document.createElement('div'); clr.innerHTML = '<a href="#" id="clearPins">핀 지우기</a>'; box.appendChild(clr); $('clearPins').addEventListener('click', (e) => { e.preventDefault(); pins = []; renderPins(); draw(); }); }
  $('btnFit').disabled = complete.length < 2;
}
$('btnFit').addEventListener('click', () => {
  const pairs = pins.filter((p) => p.src && p.ref); if (pairs.length < 2 || !selected) return;
  let sx = 0, sy = 0, tx = 0, ty = 0; for (const p of pairs) { sx += p.src[0]; sy += p.src[1]; tx += p.ref[0]; ty += p.ref[1]; }
  sx /= pairs.length; sy /= pairs.length; tx /= pairs.length; ty /= pairs.length;
  let num = 0, den = 0;
  for (const p of pairs) { const ax = p.src[0] - sx, ay = p.src[1] - sy, bx = p.ref[0] - tx, by = p.ref[1] - ty; num += ax * by - ay * bx; den += ax * bx + ay * by; }
  const yaw = Math.atan2(num, den), c = Math.cos(yaw), s = Math.sin(yaw);
  const ox = tx - (c * sx - s * sy), oy = ty - (s * sx + c * sy);
  selected.align = { ox, oz: -oy, yaw };
  markDirty('pins'); renderPins(); updatePanel(); draw();
});

// ---------------- ICP (server) ----------------
let icpUndo = null;
$('btnIcp').addEventListener('click', async () => {
  if (!selected || !DATA.api || !DATA.api.icp) return;
  const L = selected;
  const others = {}; for (const o of layers) if (o !== L) others[o.id] = { offsetX: o.align.ox, offsetZ: o.align.oz, yawRadians: o.align.yaw };
  $('btnIcp').disabled = true; $('icpNote').textContent = 'ICP 계산 중…';
  try {
    const r = await fetch(DATA.api.icp, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan: L.id, alignment: { offsetX: L.align.ox, offsetZ: L.align.oz, yawRadians: L.align.yaw }, others }) });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const res = await r.json();
    icpUndo = { layer: L, align: { ...L.align }, method: L.method };
    L.align = { ox: res.alignment.offsetX, oz: res.alignment.offsetZ, yaw: res.alignment.yawRadians };
    markDirty('icp'); updatePanel(); draw();
    const a = res.after, b = res.before;
    const worse = a.conflict > b.conflict + 0.05 || a.inlier < b.inlier - 0.1;
    $('icpNote').textContent = `ICP: ${(res.moved_m * 100).toFixed(0)} cm, ${res.rotated_deg.toFixed(1)}° 이동 · inlier ${b.inlier.toFixed(2)}→${a.inlier.toFixed(2)}, conflict ${b.conflict.toFixed(2)}→${a.conflict.toFixed(2)}` + (worse ? ' — 나빠졌습니다. 취소를 권합니다.' : '');
    $('btnIcpUndo').hidden = false;
  } catch (e) { $('icpNote').textContent = `ICP 실패: ${e.message}`; updatePanel(); }
});
$('btnIcpUndo').addEventListener('click', () => {
  if (!icpUndo) return; const u = icpUndo; icpUndo = null;
  u.layer.align = { ...u.align }; u.layer.method = u.method; $('btnIcpUndo').hidden = true; updatePanel(); draw();
});

// ---------------- revert / approve / save ----------------
$('btnRevert').addEventListener('click', () => { if (!selected) return; selected.align = { ...selected.loaded }; selected.method = selected.loadedMethod; selected.dirty = false; selected.approved = false; pins = []; icpUndo = null; $('btnIcpUndo').hidden = true; renderPins(); updatePanel(); draw(); });
$('chkApprove').addEventListener('change', (e) => { if (selected) { selected.approved = e.target.checked; renderLayerList(); } });
function buildAlignmentDoc() {
  const out = { format: 'scan-group-alignment-v1', group: DATA.group, reference: DATA.reference, up_axis_convention: 'top = -z', alignments: {} };
  const now = new Date().toISOString();
  for (const L of layers) {
    if (L.isRef) continue;
    const m = computeMetrics(L);
    out.alignments[L.id] = {
      offsetX: +L.align.ox.toFixed(4), offsetZ: +L.align.oz.toFixed(4), yawRadians: +L.align.yaw.toFixed(6),
      method: L.method,
      metrics: { overlap_m: +m.overlapM.toFixed(3), inlier: +m.inlier.toFixed(4), conflict: +m.conflict.toFixed(4), rmse_m: m.rmse == null ? null : +m.rmse.toFixed(4) },
      approved: L.approved, ...(L.approved ? { approved_at: now } : {}),
    };
  }
  return out;
}
if (DATA.api && DATA.api.save) {
  $('btnSave').textContent = '서버에 저장 → 합성 반영';
  $('saveNote').textContent = '저장하면 서버가 group_alignment.json을 쓰고 합성 slicemap을 다시 만들어 시뮬레이터 worlds/로 내보냅니다.';
}
$('btnSave').addEventListener('click', async () => {
  const out = buildAlignmentDoc();
  const pending = layers.filter((L) => !L.isRef && !L.approved).length;
  const pendingMsg = pending ? ` 승인 안 된 스캔 ${pending}개가 남아 있습니다.` : ' 모든 스캔 승인.';
  if (DATA.api && DATA.api.save) {
    $('btnSave').disabled = true; $('saveResult').hidden = false; $('saveResult').textContent = '저장 중…';
    try {
      const r = await fetch(DATA.api.save, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const res = await r.json();
      for (const L of layers) { L.loaded = { ...L.align }; L.loadedMethod = L.method; L.dirty = false; }
      renderLayerList();
      $('saveResult').innerHTML = `저장됨.${pendingMsg}<br>합성: ${res.merged_summary}<br>` +
        (res.published ? `시뮬레이터로 내보냄: <code>${res.published}</code>` : '시뮬레이터 내보내기 경로(STUDIO_PUBLISH_DIR)가 설정되지 않아 합성 파일만 썼습니다.') +
        `<br><img src="${DATA.api.merged}?t=${Date.now()}" style="max-width:100%;margin-top:6px;border:1px solid var(--line)">`;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'scan-studio:saved',
          group: DATA.group,
          published: res.published,
          mergedSummary: res.merged_summary,
        }, '*');
      }
    } catch (e) { $('saveResult').textContent = `저장 실패: ${e.message}`; }
    $('btnSave').disabled = false;
    return;
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'group_alignment.json'; a.click();
  $('status').style.display = 'block';
  $('status').textContent = '저장됨 —' + pendingMsg;
});

// ---------------- boot ----------------
$('groupName').textContent = DATA.group ? `프로젝트 ${DATA.group}` : '';
$('refName').textContent = DATA.reference;
window.addEventListener('resize', resize);
resize(); fitAll(); renderPins(); updatePanel();
</script>
</body>
</html>
"""
