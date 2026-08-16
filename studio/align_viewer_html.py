"""Self-contained HTML registration-alignment viewer (PLAN.md "정합 UI" —
lets a human visually verify and manually fine-tune the ICP-estimated rigid
transform between a robot occupancy grid and the LiDAR base map, instead of
trusting automatic ICP blindly.

Why manual fine-tuning on top of automatic ICP: real indoor maps only
partially overlap (the robot hasn't explored everywhere the LiDAR scan
covers) and floor plans have a lot of locally-symmetric structure (parallel
corridors, repeated room shapes) that can pull ICP into a locally-plausible
but globally wrong alignment -- the RMSE number alone can't reveal that, but
a human glancing at the overlay catches it instantly.

The auto ICP result is used as the initial pose; dragging translates,
shift-dragging rotates around the robot map's own centroid (so it spins in
place rather than swinging across the screen), and a live nearest-neighbor
overlap estimate (computed against a simple spatial hash of the base map, no
server needed) gives instant feedback on fit quality. "내보내기" downloads
the final {rotation_deg, translation} as JSON for feeding back into the
pipeline (e.g. scripts/register_maps.py or scripts/studio.py).
"""
from __future__ import annotations

import json

import numpy as np

TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #1e1e1e; color: #eee; margin: 0; padding: 16px; }}
  h1 {{ font-size: 16px; font-weight: 600; margin: 0 0 4px; }}
  .hint {{ color: #999; font-size: 12.5px; margin-bottom: 12px; }}
  #layout {{ display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }}
  #wrap {{ display: inline-block; border: 1px solid #444; touch-action: none; }}
  canvas {{ display: block; cursor: grab; background: #222; }}
  canvas.rotating {{ cursor: crosshair; }}
  #panel {{ min-width: 260px; font-size: 13px; }}
  fieldset {{ border: 1px solid #444; border-radius: 6px; margin: 0 0 12px; padding: 10px 12px; }}
  legend {{ color: #aaa; padding: 0 4px; font-size: 12px; }}
  label {{ display: block; margin: 6px 0 2px; color: #ccc; }}
  input[type=range] {{ width: 100%; }}
  input[type=number] {{ width: 80px; background: #2a2a2a; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 3px 6px; }}
  button {{ background: #333; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 5px 12px; cursor: pointer; margin-right: 6px; margin-top: 4px; }}
  button:hover {{ background: #444; }}
  #readout {{ font-variant-numeric: tabular-nums; line-height: 1.8; }}
  #readout .good {{ color: #6fd66f; }}
  #readout .bad {{ color: #ff6b6b; }}
  #readout .warn {{ color: #ffca5b; }}
  .row {{ display: flex; gap: 8px; }}
  .swatch {{ display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }}
</style>
</head>
<body>
<h1>{title}</h1>
<div class="hint">드래그: 이동 &nbsp;|&nbsp; Shift+드래그: 제자리 회전 &nbsp;|&nbsp; <span class="swatch" style="background:#9a9a9a"></span>베이스맵(고정) &nbsp; <span class="swatch" style="background:#ff3b3b"></span>로봇맵(조정 대상)</div>
<div id="layout">
  <div id="wrap"><canvas id="view" width="{width}" height="{height}"></canvas></div>
  <div id="panel">
    <fieldset>
      <legend>정합 품질 (실시간 추정)</legend>
      <div id="readout"></div>
    </fieldset>
    <fieldset>
      <legend>회전</legend>
      <input type="range" id="rotSlider" min="-180" max="180" step="0.1" value="0">
      <label>각도 (deg) <input type="number" id="rotInput" step="0.1"></label>
    </fieldset>
    <fieldset>
      <legend>이동 (world, m)</legend>
      <div class="row">
        <label>X <input type="number" id="txInput" step="0.01"></label>
        <label>Y <input type="number" id="tyInput" step="0.01"></label>
      </div>
    </fieldset>
    <button id="resetBtn">자동 정렬(ICP)로 리셋</button>
    <button id="exportBtn">변환값 내보내기 (JSON)</button>
  </div>
</div>
<script>
const basePoints = {base_points_json};
const robotPoints = {robot_points_json};
const initRotationDeg = {init_rot};
const initTx = {init_tx};
const initTy = {init_ty};
const initRmse = {init_rmse};
const cellSize = {cell_size};
const overlapThresholdM = {overlap_threshold};
const baseCountShown = basePoints.length;
const robotCountShown = robotPoints.length;
const baseCountTotal = {base_count_total};
const robotCountTotal = {robot_count_total};

function centroidOf(pts) {{
  let sx = 0, sy = 0;
  for (const p of pts) {{ sx += p[0]; sy += p[1]; }}
  return [sx / pts.length, sy / pts.length];
}}
const robotCentroid = robotPoints.length ? centroidOf(robotPoints) : [0, 0];

function centerFromRT(rotDeg, tx, ty) {{
  const th = rotDeg * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  return [
    cos * robotCentroid[0] - sin * robotCentroid[1] + tx,
    sin * robotCentroid[0] + cos * robotCentroid[1] + ty,
  ];
}}

// UI state: rotate-in-place around robotCentroid, drag freely moves `center`
// (the world point robotCentroid currently maps to). Both fully determine a
// standard rotation+translation transform (see currentTransform()) -- the
// pivot choice is just a UI convenience, not a constraint on the exported
// result.
let state = {{ rotationDeg: initRotationDeg, center: centerFromRT(initRotationDeg, initTx, initTy) }};

function currentTransform() {{
  const th = state.rotationDeg * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const tx = state.center[0] - (cos * robotCentroid[0] - sin * robotCentroid[1]);
  const ty = state.center[1] - (sin * robotCentroid[0] + cos * robotCentroid[1]);
  return {{ cos, sin, tx, ty }};
}}

function transformPoint(p, tr) {{
  return [p[0] * tr.cos - p[1] * tr.sin + tr.tx, p[0] * tr.sin + p[1] * tr.cos + tr.ty];
}}

// -- spatial hash of the (fixed) base map, for a fast live overlap estimate --
const hash = new Map();
function cellKey(cx, cy) {{ return cx + '_' + cy; }}
for (const p of basePoints) {{
  const cx = Math.floor(p[0] / cellSize), cy = Math.floor(p[1] / cellSize);
  const k = cellKey(cx, cy);
  if (!hash.has(k)) hash.set(k, []);
  hash.get(k).push(p);
}}
function nearestDist(p) {{
  const cx = Math.floor(p[0] / cellSize), cy = Math.floor(p[1] / cellSize);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {{
    const arr = hash.get(cellKey(cx + dx, cy + dy));
    if (!arr) continue;
    for (const q of arr) {{
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best) best = d;
    }}
  }}
  return best;
}}

// -- fixed view fit (computed once from the initial alignment, doesn't rescale while dragging) --
function bbox(pointLists) {{
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of pointLists) for (const p of pts) {{
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }}
  return [minX, minY, maxX, maxY];
}}
const initTr = currentTransform();
const initRobotWorld = robotPoints.map(p => transformPoint(p, initTr));
const [bx0, by0, bx1, by1] = basePoints.length ? bbox([basePoints, initRobotWorld]) : bbox([initRobotWorld]);
const pad = Math.max(bx1 - bx0, by1 - by0) * 0.08 + 0.3;
const viewMinX = bx0 - pad, viewMinY = by0 - pad, viewMaxX = bx1 + pad, viewMaxY = by1 + pad;

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const scale = Math.min(W / (viewMaxX - viewMinX), H / (viewMaxY - viewMinY));

function worldToCanvas(x, y) {{ return [(x - viewMinX) * scale, H - (y - viewMinY) * scale]; }}
function canvasToWorld(cx, cy) {{ return [cx / scale + viewMinX, (H - cy) / scale + viewMinY]; }}

function qualityClass(overlapPct) {{
  if (overlapPct >= 70) return 'good';
  if (overlapPct >= 40) return 'warn';
  return 'bad';
}}

function draw() {{
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#9a9a9a';
  for (const p of basePoints) {{
    const [cx, cy] = worldToCanvas(p[0], p[1]);
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }}

  const tr = currentTransform();
  let hits = 0, distSum = 0, distN = 0;
  ctx.fillStyle = 'rgba(255,59,59,0.8)';
  for (const p of robotPoints) {{
    const wp = transformPoint(p, tr);
    const d = nearestDist(wp);
    if (Number.isFinite(d)) {{ distSum += Math.min(d, cellSize * 3); distN++; if (d < overlapThresholdM) hits++; }}
    const [cx, cy] = worldToCanvas(wp[0], wp[1]);
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }}
  // pivot marker
  const [pcx, pcy] = worldToCanvas(state.center[0], state.center[1]);
  ctx.strokeStyle = '#3ba0ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(pcx, pcy, 4, 0, Math.PI * 2); ctx.stroke();

  const overlapPct = distN ? (100 * hits / distN) : 0;
  const meanNn = distN ? (distSum / distN) : NaN;
  const cls = qualityClass(overlapPct);
  document.getElementById('readout').innerHTML =
    `겹침(${{overlapThresholdM.toFixed(2)}}m 이내): <span class="${{cls}}">${{overlapPct.toFixed(1)}}%</span><br>` +
    `평균 최근접 거리: ${{meanNn.toFixed(3)}} m<br>` +
    `자동 ICP 초기 RMSE: ${{initRmse.toFixed(3)}} m<br>` +
    `회전: ${{state.rotationDeg.toFixed(2)}}&deg;<br>` +
    `베이스 포인트: ${{baseCountShown.toLocaleString()}}` + (baseCountShown < baseCountTotal ? ` / ${{baseCountTotal.toLocaleString()}} (표시용 다운샘플)` : '') + `<br>` +
    `로봇 포인트: ${{robotCountShown.toLocaleString()}}` + (robotCountShown < robotCountTotal ? ` / ${{robotCountTotal.toLocaleString()}} (표시용 다운샘플)` : '');

  rotSlider.value = Math.max(-180, Math.min(180, state.rotationDeg));
  rotInput.value = state.rotationDeg.toFixed(2);
  txInput.value = currentTransform().tx.toFixed(3);
  tyInput.value = currentTransform().ty.toFixed(3);
}}

// -- interaction: drag = translate, shift+drag = rotate around state.center --
let dragMode = null;
let dragStart = null;
let stateStart = null;

canvas.addEventListener('mousedown', (ev) => {{
  const rect = canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (W / rect.width);
  const cy = (ev.clientY - rect.top) * (H / rect.height);
  const world = canvasToWorld(cx, cy);
  stateStart = {{ rotationDeg: state.rotationDeg, center: [...state.center] }};
  if (ev.shiftKey) {{
    dragMode = 'rotate';
    canvas.classList.add('rotating');
    dragStart = {{ angle: Math.atan2(world[1] - state.center[1], world[0] - state.center[0]) }};
  }} else {{
    dragMode = 'translate';
    dragStart = {{ world }};
  }}
}});

window.addEventListener('mousemove', (ev) => {{
  if (!dragMode) return;
  const rect = canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (W / rect.width);
  const cy = (ev.clientY - rect.top) * (H / rect.height);
  const world = canvasToWorld(cx, cy);
  if (dragMode === 'translate') {{
    state.center = [
      stateStart.center[0] + (world[0] - dragStart.world[0]),
      stateStart.center[1] + (world[1] - dragStart.world[1]),
    ];
  }} else if (dragMode === 'rotate') {{
    const angle = Math.atan2(world[1] - state.center[1], world[0] - state.center[0]);
    const deltaDeg = (angle - dragStart.angle) * 180 / Math.PI;
    state.rotationDeg = stateStart.rotationDeg + deltaDeg;
  }}
  draw();
}});

window.addEventListener('mouseup', () => {{
  dragMode = null;
  canvas.classList.remove('rotating');
}});

const rotSlider = document.getElementById('rotSlider');
const rotInput = document.getElementById('rotInput');
const txInput = document.getElementById('txInput');
const tyInput = document.getElementById('tyInput');

rotSlider.addEventListener('input', () => {{ state.rotationDeg = parseFloat(rotSlider.value); draw(); }});
rotInput.addEventListener('change', () => {{ state.rotationDeg = parseFloat(rotInput.value) || 0; draw(); }});
txInput.addEventListener('change', () => {{
  const tx = parseFloat(txInput.value) || 0, ty = parseFloat(tyInput.value) || 0;
  state.center = centerFromRT(state.rotationDeg, tx, ty);
  draw();
}});
tyInput.addEventListener('change', () => txInput.dispatchEvent(new Event('change')));

document.getElementById('resetBtn').addEventListener('click', () => {{
  state = {{ rotationDeg: initRotationDeg, center: centerFromRT(initRotationDeg, initTx, initTy) }};
  draw();
}});

document.getElementById('exportBtn').addEventListener('click', () => {{
  const tr = currentTransform();
  const payload = {{
    rotation_deg: state.rotationDeg,
    translation: [tr.tx, tr.ty],
    manually_adjusted: state.rotationDeg !== initRotationDeg || Math.abs(tr.tx - initTx) > 1e-9 || Math.abs(tr.ty - initTy) > 1e-9,
    exported_at: new Date().toISOString(),
  }};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {{ type: 'application/json' }});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'registration_transform.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}});

draw();
</script>
</body>
</html>
"""


def _downsample(points: np.ndarray, max_n: int, seed: int = 0) -> np.ndarray:
    if len(points) <= max_n:
        return points
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(points), size=max_n, replace=False)
    return points[idx]


def _points_json(points: np.ndarray) -> str:
    return json.dumps([[round(float(x), 4), round(float(y), 4)] for x, y in points])


def build_alignment_viewer_html(
    base_points: np.ndarray,
    robot_points: np.ndarray,
    initial_rotation_deg: float,
    initial_translation: tuple[float, float],
    initial_rmse: float,
    resolution: float = 0.05,
    max_base_points: int = 15000,
    max_robot_points: int = 4000,
    width: int = 820,
    height: int = 820,
    title: str = "정합 정렬 확인/조정",
) -> str:
    """Build a self-contained HTML page for visually verifying and manually
    fine-tuning a robot-map-to-base-map registration.

    `initial_rotation_deg`/`initial_translation` should come from
    `studio.registration.icp_2d_multistart` (its `rotation_deg` and
    `translation`) -- used as the starting pose; the page lets a human
    correct it and export the final transform as JSON.
    """
    base_shown = _downsample(base_points, max_base_points, seed=0)
    robot_shown = _downsample(robot_points, max_robot_points, seed=1)

    cell_size = round(max(resolution * 4.0, 0.15), 4)
    overlap_threshold = round(max(resolution * 6.0, 0.3), 4)

    return TEMPLATE.format(
        title=title,
        width=width,
        height=height,
        base_points_json=_points_json(base_shown),
        robot_points_json=_points_json(robot_shown),
        init_rot=float(initial_rotation_deg),
        init_tx=float(initial_translation[0]),
        init_ty=float(initial_translation[1]),
        init_rmse=float(initial_rmse),
        cell_size=cell_size,
        overlap_threshold=overlap_threshold,
        base_count_total=len(base_points),
        robot_count_total=len(robot_points),
    )
