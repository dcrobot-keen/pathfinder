// 시뮬레이션 탭의 3D 뷰어 iframe + 로봇 시점 버튼. 예전에는 index.html 에 tb3-sim-01/02 와 :8767 이 그대로
// 박혀 있었다 -- 현장마다 로봇 구성·시뮬레이터 포트가 달라지므로(설정 › 시뮬레이터 카드, 여러 현장을 동시에
// 띄울 수 있다) 이 현장의 상태(server/simControl.mjs, GET /api/sim/status/:projectId)에서 매번 다시 그린다.
import { getSimStatus } from './simControlApi.js';

const POLL_MS = 5000;

export function createSimViewerFrame({ projectId }) {
  const buttonsEl = document.getElementById('sim-bot-buttons');
  const frame = document.getElementById('sim-frame');
  const empty = document.getElementById('sim-frame-empty');
  const extLink = document.getElementById('link-sim-external');
  if (!buttonsEl || !frame) return { destroy() {} };

  let robots = [];
  let activeId = null;

  const urlFor = (port, robotId) => `http://localhost:${port}/?view=3d&embed=1&robot=${encodeURIComponent(robotId)}`;

  function renderButtons() {
    buttonsEl.replaceChildren();
    for (const r of robots) {
      const btn = document.createElement('button');
      btn.className = `sim-bot-btn${r.id === activeId ? ' active' : ''}`;
      btn.textContent = r.id;
      btn.addEventListener('click', () => {
        activeId = r.id;
        renderButtons();
        updateFrame();
      });
      buttonsEl.appendChild(btn);
    }
  }

  let currentPort = null;
  function updateFrame() {
    if (currentPort && activeId) {
      frame.src = urlFor(currentPort, activeId);
      frame.hidden = false;
      empty.hidden = true;
      if (extLink) {
        extLink.href = `http://localhost:${currentPort}/?view=3d`;
        extLink.hidden = false;
      }
    } else {
      frame.hidden = true;
      empty.hidden = false;
      if (extLink) extLink.hidden = true;
    }
  }

  async function poll() {
    try {
      const status = await getSimStatus(projectId);
      robots = status.robots ?? [];
      if (!activeId || !robots.some((r) => r.id === activeId)) activeId = robots[0]?.id ?? null;
      const nextPort = status.simulator === 'running' ? status.ports?.viewer ?? null : null;
      if (nextPort !== currentPort) {
        currentPort = nextPort;
        updateFrame();
      }
      renderButtons();
    } catch {
      /* 폴링 실패는 조용히 무시 -- 다음 tick 에 다시 시도 */
    }
  }

  poll();
  const timer = setInterval(poll, POLL_MS);
  return { destroy() { clearInterval(timer); } };
}
