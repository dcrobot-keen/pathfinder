"""Self-contained HTML overlay-playback viewer generation (PLAN.md section
3.4 / Phase 4). Shared by scripts/build_overlay_viewer.py and
scripts/studio.py so there's one template to maintain.
"""
from __future__ import annotations

import base64
import json
from io import BytesIO

import numpy as np

from studio.rasterize import FREE, OCCUPIED
from studio.trajectory import Pose

TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #1e1e1e; color: #eee; margin: 0; padding: 16px; }}
  h1 {{ font-size: 16px; font-weight: 600; margin: 0 0 12px; }}
  #wrap {{ display: inline-block; border: 1px solid #444; }}
  canvas {{ display: block; max-width: 90vw; image-rendering: pixelated; background: #333; }}
  #controls {{ margin-top: 10px; display: flex; align-items: center; gap: 10px; max-width: 90vw; }}
  #timeline {{ flex: 1; }}
  #info {{ font-variant-numeric: tabular-nums; font-size: 13px; color: #ccc; white-space: nowrap; }}
  button {{ background: #333; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px 10px; cursor: pointer; }}
  button:hover {{ background: #444; }}
</style>
</head>
<body>
<h1>{title}</h1>
<div id="wrap"><canvas id="map" width="{width}" height="{height}"></canvas></div>
<div id="controls">
  <button id="playBtn">재생</button>
  <input type="range" id="timeline" min="0" max="{max_t}" step="any" value="0">
  <span id="info"></span>
</div>
<script>
const mapImageDataUri = "data:image/png;base64,{map_b64}";
const trajectory = {trajectory_json};
const origin = [{origin_x}, {origin_y}];
const resolution = {resolution};
const gridHeight = {height};

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const img = new Image();
let mapLoaded = false;
img.onload = () => {{ mapLoaded = true; draw(currentT); }};
img.src = mapImageDataUri;

function worldToCanvas(x, y) {{
  const col = (x - origin[0]) / resolution;
  const rowFromBottom = (y - origin[1]) / resolution;
  const rowFromTop = gridHeight - rowFromBottom;
  return [col, rowFromTop];
}}

function poseAtTime(t) {{
  if (trajectory.length === 0) return null;
  if (t <= trajectory[0].t) return trajectory[0];
  if (t >= trajectory[trajectory.length - 1].t) return trajectory[trajectory.length - 1];
  let lo = 0, hi = trajectory.length - 1;
  while (hi - lo > 1) {{
    const mid = (lo + hi) >> 1;
    if (trajectory[mid].t <= t) lo = mid; else hi = mid;
  }}
  const a = trajectory[lo], b = trajectory[hi];
  const frac = (t - a.t) / (b.t - a.t || 1);
  return {{
    t, x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac,
    theta: a.theta + (b.theta - a.theta) * frac,
  }};
}}

function draw(t) {{
  if (!mapLoaded) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  if (trajectory.length > 1) {{
    ctx.strokeStyle = '#3ba0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    trajectory.forEach((p, i) => {{
      const [cx, cy] = worldToCanvas(p.x, p.y);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }});
    ctx.stroke();
  }}

  const pose = poseAtTime(t);
  if (pose) {{
    const [cx, cy] = worldToCanvas(pose.x, pose.y);
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    const headingLen = 12;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + headingLen * Math.cos(pose.theta), cy - headingLen * Math.sin(pose.theta));
    ctx.stroke();

    document.getElementById('info').textContent =
      `t=${{pose.t.toFixed(1)}}s  x=${{pose.x.toFixed(2)}}m  y=${{pose.y.toFixed(2)}}m  θ=${{(pose.theta * 180 / Math.PI).toFixed(0)}}°`;
  }}
}}

let currentT = 0;
let playing = false;
let lastFrameTime = null;
const timeline = document.getElementById('timeline');
const playBtn = document.getElementById('playBtn');
const maxT = trajectory.length ? trajectory[trajectory.length - 1].t : 0;

timeline.addEventListener('input', () => {{
  currentT = parseFloat(timeline.value);
  playing = false;
  playBtn.textContent = '재생';
  draw(currentT);
}});

playBtn.addEventListener('click', () => {{
  playing = !playing;
  playBtn.textContent = playing ? '일시정지' : '재생';
  lastFrameTime = null;
  if (playing) requestAnimationFrame(tick);
}});

function tick(now) {{
  if (!playing) return;
  if (lastFrameTime !== null) {{
    currentT += (now - lastFrameTime) / 1000;
    if (currentT >= maxT) {{
      currentT = maxT;
      playing = false;
      playBtn.textContent = '재생';
    }}
    timeline.value = currentT;
    draw(currentT);
  }}
  lastFrameTime = now;
  if (playing) requestAnimationFrame(tick);
}}

draw(0);
</script>
</body>
</html>
"""


def render_occupancy_png_base64(occ) -> str:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rgb = np.zeros((*occ.grid.shape, 3), dtype=np.uint8)
    rgb[occ.grid == FREE] = (255, 255, 255)
    rgb[occ.grid == OCCUPIED] = (20, 20, 20)
    rgb[occ.grid == -1] = (140, 140, 140)

    buf = BytesIO()
    plt.imsave(buf, np.flipud(rgb), format="png")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def build_overlay_viewer_html(occ, poses: list[Pose], title: str) -> str:
    height, width = occ.grid.shape
    map_b64 = render_occupancy_png_base64(occ)
    trajectory_json = json.dumps([{"t": p.t, "x": p.x, "y": p.y, "theta": p.theta} for p in poses])

    return TEMPLATE.format(
        title=title,
        width=width,
        height=height,
        map_b64=map_b64,
        trajectory_json=trajectory_json,
        origin_x=occ.origin[0],
        origin_y=occ.origin[1],
        resolution=occ.resolution,
        max_t=poses[-1].t if poses else 0,
    )
