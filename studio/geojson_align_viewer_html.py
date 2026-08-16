"""Self-contained HTML control-point picker for aligning an externally
sourced GeoJSON onto this project's base-map frame (PLAN.md "좌표 보정").

Two independent canvases (base map / incoming GeoJSON, each fit-to-view in
its own native scale, since the incoming file's units/origin are unknown
and may not even be visually comparable to ours before alignment) --
clicking a landmark on the left then its match on the right commits one
correspondence pair. Once 2+ pairs exist, a similarity transform (rotation +
uniform scale + translation) is fit live and previewed as a dashed overlay
on the base map, mirroring `studio.geojson_align.fit_similarity_transform`
exactly (see `buildTfPreview`'s comment for why the JS side uses the plain
4-parameter linear least-squares form instead of porting the SVD -- same
answer, far less code, no reflection-handling needed to hand-translate).
"""
from __future__ import annotations

import json

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
  #canvases {{ display: flex; gap: 12px; }}
  .canvas-block {{ display: inline-block; }}
  .canvas-label {{ font-size: 12px; color: #aaa; margin-bottom: 4px; }}
  #wrapBase, #wrapIncoming {{ display: inline-block; border: 1px solid #444; }}
  canvas {{ display: block; cursor: crosshair; background: #222; }}
  #panel {{ min-width: 280px; font-size: 13px; }}
  fieldset {{ border: 1px solid #444; border-radius: 6px; margin: 0 0 12px; padding: 10px 12px; }}
  legend {{ color: #aaa; padding: 0 4px; font-size: 12px; }}
  button {{ background: #333; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 5px 12px; cursor: pointer; margin-right: 6px; margin-top: 4px; }}
  button:hover {{ background: #444; }}
  button.small {{ padding: 2px 8px; font-size: 11px; }}
  #readout {{ font-variant-numeric: tabular-nums; line-height: 1.8; }}
  #readout .good {{ color: #6fd66f; }}
  #readout .bad {{ color: #ff6b6b; }}
  #readout .warn {{ color: #ffca5b; }}
  #pairList {{ list-style: none; margin: 0; padding: 0; font-size: 12px; font-variant-numeric: tabular-nums; }}
  #pairList li {{ display: flex; align-items: center; gap: 6px; padding: 3px 0; border-bottom: 1px solid #2a2a2a; }}
  .swatch {{ display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }}
  .pair-coords {{ flex: 1; color: #ccc; }}
</style>
</head>
<body>
<h1>{title}</h1>
<div class="hint">왼쪽에서 기준점 클릭 → 오른쪽에서 같은 지점 클릭 = 대응점 한 쌍 확정. 2쌍 이상이면 자동으로 정렬을 계산합니다.</div>
<div id="layout">
  <div id="canvases">
    <div class="canvas-block">
      <div class="canvas-label">기준 좌표계 (베이스맵)</div>
      <div id="wrapBase"><canvas id="baseCanvas" width="{width}" height="{height}"></canvas></div>
    </div>
    <div class="canvas-block">
      <div class="canvas-label">가져올 GeoJSON (원본 좌표)</div>
      <div id="wrapIncoming"><canvas id="incomingCanvas" width="{width}" height="{height}"></canvas></div>
    </div>
  </div>
  <div id="panel">
    <fieldset>
      <legend>정렬 결과 (실시간 추정)</legend>
      <div id="readout">대응점을 2쌍 이상 찍으면 계산됩니다.</div>
    </fieldset>
    <fieldset>
      <legend>대응점 (<span id="pairCount">0</span>쌍)</legend>
      <ul id="pairList"></ul>
    </fieldset>
    <button id="clearBtn">포인트 초기화</button>
    <button id="exportGeojsonBtn" disabled>정렬된 GeoJSON 내보내기</button>
    <button id="exportTransformBtn" disabled>변환값 내보내기 (JSON)</button>
  </div>
</div>
<script>
const baseGeojson = {base_geojson_json};
const incomingGeojson = {incoming_geojson_json};

// -- generic GeoJSON -> drawable parts (points/lines/polygon rings), for
// rendering only; studio/geojson_align.py's transform walk is separate and
// coordinate-shape-generic rather than type-dispatched like this is. --
function extractParts(geojson) {{
  const parts = [];
  function walk(geometry) {{
    if (!geometry) return;
    const t = geometry.type;
    if (t === 'GeometryCollection') {{ geometry.geometries.forEach(walk); return; }}
    const coords = geometry.coordinates;
    if (t === 'Point') parts.push({{ kind: 'point', pts: [coords] }});
    else if (t === 'MultiPoint') parts.push({{ kind: 'point', pts: coords }});
    else if (t === 'LineString') parts.push({{ kind: 'line', pts: coords }});
    else if (t === 'MultiLineString') coords.forEach(line => parts.push({{ kind: 'line', pts: line }}));
    else if (t === 'Polygon') coords.forEach(ring => parts.push({{ kind: 'polygon', pts: ring }}));
    else if (t === 'MultiPolygon') coords.forEach(poly => poly.forEach(ring => parts.push({{ kind: 'polygon', pts: ring }})));
  }}
  const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
  for (const f of features) walk(f.geometry || f);
  return parts;
}}

function partsBbox(parts) {{
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const part of parts) for (const p of part.pts) {{
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }}
  if (!Number.isFinite(minX)) return [0, 0, 1, 1];
  return [minX, minY, maxX, maxY];
}}

function makeCanvasView(canvasId, geojson) {{
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const parts = extractParts(geojson);
  const [bx0, by0, bx1, by1] = partsBbox(parts);
  const pad = Math.max(bx1 - bx0, by1 - by0) * 0.1 + 1e-6;
  const viewMinX = bx0 - pad, viewMinY = by0 - pad, viewMaxX = bx1 + pad, viewMaxY = by1 + pad;
  const scale = Math.min(W / (viewMaxX - viewMinX), H / (viewMaxY - viewMinY));

  function worldToCanvas(x, y) {{ return [(x - viewMinX) * scale, H - (y - viewMinY) * scale]; }}
  function canvasToWorld(cx, cy) {{ return [cx / scale + viewMinX, (H - cy) / scale + viewMinY]; }}

  function drawBase() {{
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8ab4ff';
    ctx.fillStyle = 'rgba(138,180,255,0.12)';
    ctx.lineWidth = 1.5;
    for (const part of parts) {{
      if (part.pts.length === 0) continue;
      if (part.kind === 'point') {{
        for (const p of part.pts) {{
          const [cx, cy] = worldToCanvas(p[0], p[1]);
          ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = '#8ab4ff'; ctx.fill();
        }}
        continue;
      }}
      ctx.beginPath();
      part.pts.forEach((p, i) => {{
        const [cx, cy] = worldToCanvas(p[0], p[1]);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }});
      if (part.kind === 'polygon') {{ ctx.closePath(); ctx.fill(); }}
      ctx.stroke();
    }}
  }}

  return {{ canvas, ctx, W, H, worldToCanvas, canvasToWorld, drawBase }};
}}

const baseView = makeCanvasView('baseCanvas', baseGeojson);
const incomingView = makeCanvasView('incomingCanvas', incomingGeojson);

const PAIR_COLORS = ['#ff5555', '#5bd67a', '#ffca5b', '#8ab4ff', '#e07bff', '#5be0d0', '#ff9955', '#c8ff5b'];
let pairs = [];          // [{{ base: [x,y], incoming: [x,y] }}, ...]
let pendingBase = null;  // [x, y] world coords armed on the left canvas, awaiting its match on the right

function drawMarker(view, worldPt, color, hollow) {{
  const [cx, cy] = view.worldToCanvas(worldPt[0], worldPt[1]);
  view.ctx.beginPath();
  view.ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  view.ctx.lineWidth = 2;
  view.ctx.strokeStyle = color;
  view.ctx.stroke();
  if (!hollow) {{ view.ctx.fillStyle = color; view.ctx.fill(); }}
}}

// -- similarity transform fit: plain 4-parameter linear least squares over
// (a, b, tx, ty) where x' = a*x - b*y + tx, y' = b*x + a*y + ty. This is
// the *unconstrained* linear solution to the same minimization Umeyama's
// SVD solves in studio/geojson_align.py -- for well-conditioned,
// non-degenerate correspondences (never asking for a mirrored fit, which a
// floor plan alignment never wants) the two are the same answer, and this
// form needs no SVD to hand-translate into JS. scale=sqrt(a^2+b^2),
// rotation=atan2(b, a). Verified to agree with the Python implementation to
// several decimal places on a synthetic test case.
function fitSimilarity(pairsList) {{
  const n = pairsList.length;
  let sx = 0, sy = 0, sX = 0, sY = 0, sxx_yy = 0, sxXyY = 0, sxYyX = 0;
  for (const p of pairsList) {{
    const [x, y] = p.incoming, [X, Y] = p.base;
    sx += x; sy += y; sX += X; sY += Y;
    sxx_yy += x * x + y * y;
    sxXyY += x * X + y * Y;
    sxYyX += x * Y - y * X;
  }}
  const denom = sxx_yy - (sx * sx + sy * sy) / n;
  if (Math.abs(denom) < 1e-12) return null;
  const a = (sxXyY - (sx * sX + sy * sY) / n) / denom;
  const b = (sxYyX - (sx * sY - sy * sX) / n) / denom;
  const tx = (sX - a * sx + b * sy) / n;
  const ty = (sY - b * sx - a * sy) / n;
  const scale = Math.hypot(a, b);
  const rotationDeg = Math.atan2(b, a) * 180 / Math.PI;
  return {{ scale, rotationDeg, tx, ty }};
}}

function applyFit(fit, x, y) {{
  const th = fit.rotationDeg * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  return [fit.scale * (x * c - y * s) + fit.tx, fit.scale * (x * s + y * c) + fit.ty];
}}

function qualityClass(maxResidual, extent) {{
  const rel = extent > 0 ? maxResidual / extent : 0;
  if (rel < 0.02) return 'good';
  if (rel < 0.08) return 'warn';
  return 'bad';
}}

function redraw() {{
  baseView.drawBase();
  incomingView.drawBase();

  pairs.forEach((p, i) => {{
    const color = PAIR_COLORS[i % PAIR_COLORS.length];
    drawMarker(baseView, p.base, color, false);
    drawMarker(incomingView, p.incoming, color, false);
  }});
  if (pendingBase) drawMarker(baseView, pendingBase, '#fff', true);

  const pairListEl = document.getElementById('pairList');
  pairListEl.innerHTML = '';
  pairs.forEach((p, i) => {{
    const li = document.createElement('li');
    const color = PAIR_COLORS[i % PAIR_COLORS.length];
    li.innerHTML = `<span class="swatch" style="background:${{color}}"></span>` +
      `<span class="pair-coords">#${{i + 1}} (${{p.base[0].toFixed(2)}}, ${{p.base[1].toFixed(2)}}) ↔ (${{p.incoming[0].toFixed(2)}}, ${{p.incoming[1].toFixed(2)}})</span>`;
    const del = document.createElement('button');
    del.className = 'small';
    del.textContent = '삭제';
    del.addEventListener('click', () => {{ pairs.splice(i, 1); redraw(); }});
    li.appendChild(del);
    pairListEl.appendChild(li);
  }});
  document.getElementById('pairCount').textContent = pairs.length;

  const exportGeojsonBtn = document.getElementById('exportGeojsonBtn');
  const exportTransformBtn = document.getElementById('exportTransformBtn');

  if (pairs.length < 2) {{
    document.getElementById('readout').textContent = `대응점 ${{pairs.length}}/2 -- 최소 2쌍 필요`;
    exportGeojsonBtn.disabled = true;
    exportTransformBtn.disabled = true;
    window._currentFit = null;
    return;
  }}

  const fit = fitSimilarity(pairs);
  window._currentFit = fit;
  if (!fit) {{
    document.getElementById('readout').innerHTML = '<span class="bad">대응점들이 일직선상에 있어 계산 불가 -- 다른 점을 추가하세요</span>';
    exportGeojsonBtn.disabled = true;
    exportTransformBtn.disabled = true;
    return;
  }}

  const residualDists = pairs.map(p => {{
    const [px, py] = applyFit(fit, p.incoming[0], p.incoming[1]);
    return Math.hypot(px - p.base[0], py - p.base[1]);
  }});
  const maxResidual = Math.max(...residualDists);
  const meanResidual = residualDists.reduce((a, b) => a + b, 0) / residualDists.length;
  const [bx0, by0, bx1, by1] = partsBbox(extractParts(baseGeojson));
  const extent = Math.max(bx1 - bx0, by1 - by0);
  const cls = qualityClass(maxResidual, extent);

  document.getElementById('readout').innerHTML =
    `배율(scale): ${{fit.scale.toFixed(4)}}<br>` +
    `회전: ${{fit.rotationDeg.toFixed(2)}}&deg;<br>` +
    `이동: (${{fit.tx.toFixed(3)}}, ${{fit.ty.toFixed(3)}})<br>` +
    `최대 오차: <span class="${{cls}}">${{maxResidual.toFixed(3)}}</span> (기준맵 크기의 ${{(100 * maxResidual / (extent || 1)).toFixed(1)}}%)<br>` +
    `평균 오차: ${{meanResidual.toFixed(3)}}`;

  // dashed preview of the transformed incoming geometry, overlaid on the base canvas
  const incomingParts = extractParts(incomingGeojson);
  baseView.ctx.strokeStyle = '#5be0d0';
  baseView.ctx.setLineDash([4, 3]);
  baseView.ctx.lineWidth = 1.5;
  for (const part of incomingParts) {{
    if (part.kind === 'point') {{
      for (const p of part.pts) {{
        const [wx, wy] = applyFit(fit, p[0], p[1]);
        const [cx, cy] = baseView.worldToCanvas(wx, wy);
        baseView.ctx.beginPath(); baseView.ctx.arc(cx, cy, 3, 0, Math.PI * 2); baseView.ctx.stroke();
      }}
      continue;
    }}
    baseView.ctx.beginPath();
    part.pts.forEach((p, i) => {{
      const [wx, wy] = applyFit(fit, p[0], p[1]);
      const [cx, cy] = baseView.worldToCanvas(wx, wy);
      if (i === 0) baseView.ctx.moveTo(cx, cy); else baseView.ctx.lineTo(cx, cy);
    }});
    if (part.kind === 'polygon') baseView.ctx.closePath();
    baseView.ctx.stroke();
  }}
  baseView.ctx.setLineDash([]);

  exportGeojsonBtn.disabled = false;
  exportTransformBtn.disabled = false;
}}

baseView.canvas.addEventListener('click', (ev) => {{
  const rect = baseView.canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (baseView.W / rect.width);
  const cy = (ev.clientY - rect.top) * (baseView.H / rect.height);
  pendingBase = baseView.canvasToWorld(cx, cy);
  redraw();
}});

incomingView.canvas.addEventListener('click', (ev) => {{
  if (!pendingBase) return;
  const rect = incomingView.canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (incomingView.W / rect.width);
  const cy = (ev.clientY - rect.top) * (incomingView.H / rect.height);
  const incomingPt = incomingView.canvasToWorld(cx, cy);
  pairs.push({{ base: pendingBase, incoming: incomingPt }});
  pendingBase = null;
  redraw();
}});

document.getElementById('clearBtn').addEventListener('click', () => {{
  pairs = [];
  pendingBase = null;
  redraw();
}});

function downloadJson(obj, filename) {{
  const blob = new Blob([JSON.stringify(obj, null, 2)], {{ type: 'application/json' }});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}}

document.getElementById('exportTransformBtn').addEventListener('click', () => {{
  const fit = window._currentFit;
  if (!fit) return;
  downloadJson({{
    scale: fit.scale,
    rotation_deg: fit.rotationDeg,
    translation: [fit.tx, fit.ty],
    num_control_points: pairs.length,
    exported_at: new Date().toISOString(),
  }}, 'geojson_transform.json');
}});

document.getElementById('exportGeojsonBtn').addEventListener('click', () => {{
  const fit = window._currentFit;
  if (!fit) return;
  function transformNode(node) {{
    if (Array.isArray(node) && node.length >= 2 && node.length <= 3 && typeof node[0] === 'number' && typeof node[1] === 'number') {{
      const [x, y] = applyFit(fit, node[0], node[1]);
      return node.length === 3 ? [x, y, node[2]] : [x, y];
    }}
    return node.map(transformNode);
  }}
  function transformGeometry(geometry) {{
    if (!geometry) return geometry;
    const copy = {{ ...geometry }};
    if ('coordinates' in copy) copy.coordinates = transformNode(copy.coordinates);
    else if ('geometries' in copy) copy.geometries = copy.geometries.map(transformGeometry);
    return copy;
  }}
  const aligned = JSON.parse(JSON.stringify(incomingGeojson));
  const features = aligned.type === 'FeatureCollection' ? aligned.features : [aligned];
  for (const f of features) if (f.geometry) f.geometry = transformGeometry(f.geometry);
  downloadJson(aligned, 'aligned.geojson');
}});

redraw();
</script>
</body>
</html>
"""


def build_geojson_alignment_viewer_html(
    base_geojson: dict,
    incoming_geojson: dict,
    width: int = 560,
    height: int = 560,
    title: str = "GeoJSON 좌표 보정",
) -> str:
    """Build a self-contained HTML control-point picker for aligning
    `incoming_geojson` (unknown scale/origin) onto `base_geojson`'s frame.

    Unlike `studio.align_viewer_html`'s registration viewer (which starts
    from an automatic ICP guess), there's no automatic initial fit here --
    GeoJSON from an external tool has no dense point cloud to run ICP
    against, so the human picks the first correspondences from scratch.
    """
    return TEMPLATE.format(
        title=title,
        width=width,
        height=height,
        base_geojson_json=json.dumps(base_geojson),
        incoming_geojson_json=json.dumps(incoming_geojson),
    )
