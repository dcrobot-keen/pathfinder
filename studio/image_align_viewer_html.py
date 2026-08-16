"""Self-contained HTML control-point picker for georeferencing an
externally sourced raster image (a scanned/photographed floor plan) onto
this project's base-map frame (PLAN.md "좌표 보정").

Same two-canvas control-point UX as `studio.geojson_align_viewer_html`
(left = base GeoJSON, right = the incoming asset, click a landmark on each
to commit a correspondence pair, live similarity-transform preview) --
reused verbatim where the logic doesn't differ. What's different here:

- The right canvas draws an `<img>` instead of vector geometry, and a
  picked point is an (col, row) *pixel* coordinate, not a world coordinate.
- Pixel row increases downward but world y increases upward, so the pixel
  row is negated before fitting -- see `studio.image_align`'s docstring for
  why (Umeyama's fit explicitly forbids the reflection this axis flip would
  otherwise look like).
- Export offers a standard ESRI world file (the 6-line .pgw/.jgw/.tfw/...
  sidecar every GIS/CAD tool reads) instead of a transformed copy of the
  asset -- georeferencing a raster is conventionally done by *pointing at
  where it sits*, never by resampling its pixels.
- The embedded image may be a downscaled copy of the original (see
  `scripts/align_image.py` -- real floor plan scans can be huge and we
  don't want to inline the full-resolution file into an HTML page just for
  on-screen picking). `display_scale` (embedded/original size ratio) is
  used to convert a click's canvas position back to the *original* image's
  pixel grid, since the world file must describe the original file, not the
  shrunk copy: `original_px = displayed_px / display_scale`.
"""
from __future__ import annotations

import base64
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
  #wrapBase, #wrapImage {{ display: inline-block; border: 1px solid #444; }}
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
<div class="hint">왼쪽에서 기준점 클릭 → 오른쪽 이미지에서 같은 지점 클릭 = 대응점 한 쌍 확정. 2쌍 이상이면 자동으로 정렬을 계산합니다.</div>
<div id="layout">
  <div id="canvases">
    <div class="canvas-block">
      <div class="canvas-label">기준 좌표계 (베이스맵)</div>
      <div id="wrapBase"><canvas id="baseCanvas" width="{width}" height="{height}"></canvas></div>
    </div>
    <div class="canvas-block">
      <div class="canvas-label">가져올 이미지 (원본 픽셀)</div>
      <div id="wrapImage"><canvas id="imageCanvas" width="{width}" height="{height}"></canvas></div>
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
    <button id="exportWorldFileBtn" disabled>월드 파일 내보내기 ({world_file_ext})</button>
    <button id="exportTransformBtn" disabled>변환값 내보내기 (JSON)</button>
  </div>
</div>
<script>
const baseGeojson = {base_geojson_json};
const imageDataUri = "data:{image_mime};base64,{image_b64}";
const displayScale = {display_scale};
const worldFileExt = {world_file_ext_json};

// -- base canvas: identical rendering approach to studio/geojson_align_viewer_html.py --
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

const baseParts = extractParts(baseGeojson);
const baseCanvas = document.getElementById('baseCanvas');
const baseCtx = baseCanvas.getContext('2d');
const BW = baseCanvas.width, BH = baseCanvas.height;
const [bx0, by0, bx1, by1] = partsBbox(baseParts);
const basePad = Math.max(bx1 - bx0, by1 - by0) * 0.1 + 1e-6;
const baseViewMinX = bx0 - basePad, baseViewMinY = by0 - basePad;
const baseScale = Math.min(BW / (bx1 - bx0 + 2 * basePad), BH / (by1 - by0 + 2 * basePad));

function worldToCanvas(x, y) {{ return [(x - baseViewMinX) * baseScale, BH - (y - baseViewMinY) * baseScale]; }}
function canvasToWorld(cx, cy) {{ return [cx / baseScale + baseViewMinX, (BH - cy) / baseScale + baseViewMinY]; }}

function drawBase() {{
  baseCtx.fillStyle = '#222';
  baseCtx.fillRect(0, 0, BW, BH);
  baseCtx.strokeStyle = '#8ab4ff';
  baseCtx.fillStyle = 'rgba(138,180,255,0.12)';
  baseCtx.lineWidth = 1.5;
  for (const part of baseParts) {{
    if (part.pts.length === 0) continue;
    if (part.kind === 'point') {{
      for (const p of part.pts) {{
        const [cx, cy] = worldToCanvas(p[0], p[1]);
        baseCtx.beginPath(); baseCtx.arc(cx, cy, 3, 0, Math.PI * 2); baseCtx.fillStyle = '#8ab4ff'; baseCtx.fill();
      }}
      continue;
    }}
    baseCtx.beginPath();
    part.pts.forEach((p, i) => {{
      const [cx, cy] = worldToCanvas(p[0], p[1]);
      if (i === 0) baseCtx.moveTo(cx, cy); else baseCtx.lineTo(cx, cy);
    }});
    if (part.kind === 'polygon') {{ baseCtx.closePath(); baseCtx.fill(); }}
    baseCtx.stroke();
  }}
}}

// -- image canvas: fit the (possibly downscaled) embedded image into the
// canvas viewport, and remember the canvas<->displayed-image-pixel scale so
// clicks can be converted to pixel coordinates. --
const imageCanvas = document.getElementById('imageCanvas');
const imageCtx = imageCanvas.getContext('2d');
const IW = imageCanvas.width, IH = imageCanvas.height;
const img = new Image();
let imgFitScale = 1, imgOffsetX = 0, imgOffsetY = 0;
let imgLoaded = false;

img.onload = () => {{
  imgFitScale = Math.min(IW / img.naturalWidth, IH / img.naturalHeight);
  imgOffsetX = (IW - img.naturalWidth * imgFitScale) / 2;
  imgOffsetY = (IH - img.naturalHeight * imgFitScale) / 2;
  imgLoaded = true;
  drawImage();
}};
img.src = imageDataUri;

function drawImage() {{
  imageCtx.fillStyle = '#222';
  imageCtx.fillRect(0, 0, IW, IH);
  if (imgLoaded) imageCtx.drawImage(img, imgOffsetX, imgOffsetY, img.naturalWidth * imgFitScale, img.naturalHeight * imgFitScale);
}}

// canvas pixel -> ORIGINAL (full-resolution) image pixel: undo the
// canvas-fit scale to get the *displayed* (possibly downscaled) image's
// pixel coordinate, then undo displayScale to reach the original file's
// pixel grid, which is what the world file must describe.
function canvasToOriginalPixel(cx, cy) {{
  const dispCol = (cx - imgOffsetX) / imgFitScale;
  const dispRow = (cy - imgOffsetY) / imgFitScale;
  return [dispCol / displayScale, dispRow / displayScale];
}}
function originalPixelToCanvas(col, row) {{
  const dispCol = col * displayScale, dispRow = row * displayScale;
  return [dispCol * imgFitScale + imgOffsetX, dispRow * imgFitScale + imgOffsetY];
}}

const PAIR_COLORS = ['#ff5555', '#5bd67a', '#ffca5b', '#8ab4ff', '#e07bff', '#5be0d0', '#ff9955', '#c8ff5b'];
let pairs = [];          // [{{ base: [x,y] world, pixel: [col,row] ORIGINAL image pixels }}, ...]
let pendingBase = null;  // [x, y] world coords armed on the left canvas, awaiting its match on the image

function drawMarkerAt(ctx, cx, cy, color, hollow) {{
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (!hollow) {{ ctx.fillStyle = color; ctx.fill(); }}
}}

// -- fit: same linear-least-squares form as studio/geojson_align_viewer_html.py,
// but the pixel side's row is negated first (source x=col, y=-row) so the
// pixel-row-down vs world-y-up flip isn't mistaken for a reflection -- the
// exact JS mirror of studio.image_align.fit_pixel_to_world_transform. --
function fitSimilarity(pairsList) {{
  const n = pairsList.length;
  let sx = 0, sy = 0, sX = 0, sY = 0, sxx_yy = 0, sxXyY = 0, sxYyX = 0;
  for (const p of pairsList) {{
    const x = p.pixel[0], y = -p.pixel[1];
    const [X, Y] = p.base;
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

function applyFitToPixel(fit, col, row) {{
  const x = col, y = -row;
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
  drawBase();
  drawImage();

  pairs.forEach((p, i) => {{
    const color = PAIR_COLORS[i % PAIR_COLORS.length];
    const [bcx, bcy] = worldToCanvas(p.base[0], p.base[1]);
    drawMarkerAt(baseCtx, bcx, bcy, color, false);
    const [icx, icy] = originalPixelToCanvas(p.pixel[0], p.pixel[1]);
    drawMarkerAt(imageCtx, icx, icy, color, false);
  }});
  if (pendingBase) {{
    const [cx, cy] = worldToCanvas(pendingBase[0], pendingBase[1]);
    drawMarkerAt(baseCtx, cx, cy, '#fff', true);
  }}

  const pairListEl = document.getElementById('pairList');
  pairListEl.innerHTML = '';
  pairs.forEach((p, i) => {{
    const li = document.createElement('li');
    const color = PAIR_COLORS[i % PAIR_COLORS.length];
    li.innerHTML = `<span class="swatch" style="background:${{color}}"></span>` +
      `<span class="pair-coords">#${{i + 1}} (${{p.base[0].toFixed(2)}}, ${{p.base[1].toFixed(2)}}) ↔ px(${{p.pixel[0].toFixed(0)}}, ${{p.pixel[1].toFixed(0)}})</span>`;
    const del = document.createElement('button');
    del.className = 'small';
    del.textContent = '삭제';
    del.addEventListener('click', () => {{ pairs.splice(i, 1); redraw(); }});
    li.appendChild(del);
    pairListEl.appendChild(li);
  }});
  document.getElementById('pairCount').textContent = pairs.length;

  const exportWorldFileBtn = document.getElementById('exportWorldFileBtn');
  const exportTransformBtn = document.getElementById('exportTransformBtn');

  if (pairs.length < 2) {{
    document.getElementById('readout').textContent = `대응점 ${{pairs.length}}/2 -- 최소 2쌍 필요`;
    exportWorldFileBtn.disabled = true;
    exportTransformBtn.disabled = true;
    window._currentFit = null;
    return;
  }}

  const fit = fitSimilarity(pairs);
  window._currentFit = fit;
  if (!fit) {{
    document.getElementById('readout').innerHTML = '<span class="bad">대응점들이 일직선상에 있어 계산 불가 -- 다른 점을 추가하세요</span>';
    exportWorldFileBtn.disabled = true;
    exportTransformBtn.disabled = true;
    return;
  }}

  const residualDists = pairs.map(p => {{
    const [px, py] = applyFitToPixel(fit, p.pixel[0], p.pixel[1]);
    return Math.hypot(px - p.base[0], py - p.base[1]);
  }});
  const maxResidual = Math.max(...residualDists);
  const meanResidual = residualDists.reduce((a, b) => a + b, 0) / residualDists.length;
  const extent = Math.max(bx1 - bx0, by1 - by0);
  const cls = qualityClass(maxResidual, extent);

  document.getElementById('readout').innerHTML =
    `배율(scale): ${{fit.scale.toExponential(4)}} world/px<br>` +
    `회전: ${{fit.rotationDeg.toFixed(2)}}&deg;<br>` +
    `이동: (${{fit.tx.toFixed(3)}}, ${{fit.ty.toFixed(3)}})<br>` +
    `최대 오차: <span class="${{cls}}">${{maxResidual.toFixed(3)}}</span> (기준맵 크기의 ${{(100 * maxResidual / (extent || 1)).toFixed(1)}}%)<br>` +
    `평균 오차: ${{meanResidual.toFixed(3)}}`;

  // dashed preview: the image's own outer rectangle (original pixel
  // corners), transformed into world coordinates -- shows at a glance
  // whether the image's footprint lines up with the base map.
  if (imgLoaded) {{
    const w = img.naturalWidth / displayScale, h = img.naturalHeight / displayScale;
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    baseCtx.strokeStyle = '#5be0d0';
    baseCtx.setLineDash([4, 3]);
    baseCtx.lineWidth = 1.5;
    baseCtx.beginPath();
    corners.forEach((p, i) => {{
      const [wx, wy] = applyFitToPixel(fit, p[0], p[1]);
      const [cx, cy] = worldToCanvas(wx, wy);
      if (i === 0) baseCtx.moveTo(cx, cy); else baseCtx.lineTo(cx, cy);
    }});
    baseCtx.closePath();
    baseCtx.stroke();
    baseCtx.setLineDash([]);
  }}

  exportWorldFileBtn.disabled = false;
  exportTransformBtn.disabled = false;
}}

baseCanvas.addEventListener('click', (ev) => {{
  const rect = baseCanvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (BW / rect.width);
  const cy = (ev.clientY - rect.top) * (BH / rect.height);
  pendingBase = canvasToWorld(cx, cy);
  redraw();
}});

imageCanvas.addEventListener('click', (ev) => {{
  if (!pendingBase || !imgLoaded) return;
  const rect = imageCanvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (IW / rect.width);
  const cy = (ev.clientY - rect.top) * (IH / rect.height);
  const pixelPt = canvasToOriginalPixel(cx, cy);
  pairs.push({{ base: pendingBase, pixel: pixelPt }});
  pendingBase = null;
  redraw();
}});

document.getElementById('clearBtn').addEventListener('click', () => {{
  pairs = [];
  pendingBase = null;
  redraw();
}});

function downloadText(text, filename) {{
  const blob = new Blob([text], {{ type: 'text/plain' }});
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
  downloadText(JSON.stringify({{
    scale: fit.scale,
    rotation_deg: fit.rotationDeg,
    translation: [fit.tx, fit.ty],
    pixel_convention: 'row_negated -- fit against (col, -row); apply the same negation before reusing this transform on raw pixel coordinates',
    num_control_points: pairs.length,
    exported_at: new Date().toISOString(),
  }}, null, 2), 'image_transform.json');
}});

document.getElementById('exportWorldFileBtn').addEventListener('click', () => {{
  const fit = window._currentFit;
  if (!fit) return;
  const th = fit.rotationDeg * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const a = fit.scale * c, b = fit.scale * s;
  const lines = [a, b, b, -a, fit.tx, fit.ty].map(v => v.toFixed(8)).join('\\n') + '\\n';
  downloadText(lines, 'image' + worldFileExt);
}});

redraw();
</script>
</body>
</html>
"""


def build_image_alignment_viewer_html(
    base_geojson: dict,
    image_bytes: bytes,
    image_mime: str,
    display_scale: float = 1.0,
    world_file_ext: str = ".wld",
    width: int = 560,
    height: int = 560,
    title: str = "이미지 좌표 보정 (지오레퍼런싱)",
) -> str:
    """Build a self-contained HTML control-point picker for georeferencing
    `image_bytes` (embedded inline, possibly a downscaled copy -- see
    `display_scale`) onto `base_geojson`'s frame.

    `image_bytes`/`image_mime` are embedded as-is; the original image's true
    pixel dimensions are read client-side from the loaded `<img>` (via
    `naturalWidth`/`naturalHeight`) rather than passed in separately, so
    there's one source of truth for that number instead of two that could
    drift out of sync.
    """
    return TEMPLATE.format(
        title=title,
        width=width,
        height=height,
        base_geojson_json=json.dumps(base_geojson),
        image_mime=image_mime,
        image_b64=base64.b64encode(image_bytes).decode("ascii"),
        display_scale=display_scale,
        world_file_ext=world_file_ext,
        world_file_ext_json=json.dumps(world_file_ext),
    )
