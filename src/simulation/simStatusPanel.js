// 시뮬레이션 › 오른쪽 상태 패널 -- 시뮬 로봇 상태와 타임라인(플릿 이벤트).
// 데이터는 운영과 같은 /api/vda5050/stream 하나. 시뮬 로봇 = 레지스트리 company 에 'simulator' 가 있거나 시리얼에 'sim' 이 있는 것.
import { subscribeFleetStream, getFleetEvents } from '../fleet/fleetApi.js';
import { listRobots } from '../robots/robotApi.js';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');
const isSim = (serial, reg) => /(^|-)sim(-|$)/i.test(serial) || /simulator/i.test(reg?.company ?? '');

export function createSimStatusPanel(containerEl) {
  containerEl.classList.add('s2m-side');
  const robotsSec = el('section', 's2m-side__section');
  const robotsHead = el('div', 's2m-side__title');
  robotsHead.append(el('span', null, '시뮬 로봇'), el('span', 's2m-side__count', ''));
  const robotsList = el('div', 's2m-side__list');
  robotsSec.append(robotsHead, robotsList);
  const timelineSec = el('section', 's2m-side__section');
  const timelineHead = el('div', 's2m-side__title');
  timelineHead.append(el('span', null, '타임라인'), el('span', 's2m-side__count', '최근 12'));
  const timeline = el('div', 's2m-timeline');
  timelineSec.append(timelineHead, timeline);
  containerEl.append(robotsSec, timelineSec);

  const fleet = new Map();
  let registryBySerial = new Map();
  let events = [];
  listRobots().then((all) => { registryBySerial = new Map(all.filter((r) => r.vda5050Serial).map((r) => [r.vda5050Serial, r])); render(); }).catch(() => {});
  getFleetEvents().then(({ events: list }) => { events = list ?? []; renderTimeline(); }).catch(() => {});

  function renderRobots() {
    const sims = Array.from(fleet.values()).filter((r) => isSim(r.serialNumber, registryBySerial.get(r.serialNumber)));
    robotsHead.querySelector('.s2m-side__count').textContent = String(sims.length);
    robotsList.replaceChildren();
    if (!sims.length) { robotsList.appendChild(el('div', 's2m-side__empty', '시뮬 로봇이 브로커에 없습니다. 컨테이너 스택(npm run stack:up)이 떠 있는지 확인하세요.')); return; }
    for (const r of sims) {
      const st = r.state;
      const card = el('div', 's2m-order');
      const top = el('div', 's2m-order__top');
      top.appendChild(el('span', 's2m-order__robot', registryBySerial.get(r.serialNumber)?.name ?? r.serialNumber));
      const online = r.connectionState === 'ONLINE';
      const eStop = st?.safetyState?.eStop ?? 'NONE';
      const [label, tone] = !online ? ['오프라인', 'finished'] : eStop !== 'NONE' ? ['E-STOP', 'danger'] : st?.paused ? ['일시정지', 'paused'] : st?.driving ? ['주행 중', 'driving'] : ['유휴', 'sent'];
      top.appendChild(el('span', `s2m-tag s2m-tag--${tone}`, label));
      card.appendChild(top);
      const pos = r.position ? `${r.position.x.toFixed(2)}, ${r.position.y.toFixed(2)} · ${((r.position.theta ?? 0) * 180 / Math.PI).toFixed(0)}°` : '위치 없음';
      card.appendChild(el('div', 's2m-order__meta', `${pos}${st?.batteryCharge != null ? ` · 배터리 ${st.batteryCharge.toFixed(0)}%` : ''}`));
      if (st?.orderId && (st.nodesLeft ?? 0) > 0) {
        const total = r.lastOrder?.waypoints ?? 0;
        const done = Math.max(0, total - (st.nodesLeft ?? 0));
        const bar = el('div', 's2m-order__bar'); const fill = el('div', 's2m-order__fill'); fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%'; bar.appendChild(fill);
        card.append(bar, el('div', 's2m-order__meta', `주문 ${String(st.orderId).slice(0, 8)} · 노드 ${done}/${total}`));
      }
      if (st?.errors?.length) card.appendChild(el('div', 's2m-order__meta s2m-order__meta--danger', st.errors.map((e) => e.errorType).join(', ')));
      robotsList.appendChild(card);
    }
  }
  function renderTimeline() {
    timeline.replaceChildren();
    const recent = events.slice(0, 12);
    if (!recent.length) { timeline.appendChild(el('div', 's2m-side__empty', '아직 이벤트가 없습니다.')); return; }
    for (const ev of recent) {
      const row = el('div', `s2m-timeline__row s2m-timeline__row--${(ev.level || 'info').toLowerCase()}`);
      row.append(el('span', 's2m-timeline__time', fmtTime(ev.timestamp)), el('span', 's2m-timeline__bot', registryBySerial.get(ev.serialNumber)?.name ?? ev.serialNumber ?? ''), el('span', 's2m-timeline__msg', `${ev.type ?? ''} ${ev.message ?? ''}`.trim()));
      timeline.appendChild(row);
    }
  }
  function render() { renderRobots(); renderTimeline(); }

  const stream = subscribeFleetStream((msg) => {
    if (msg.type === 'snapshot') { fleet.clear(); for (const r of msg.robots) fleet.set(r.serialNumber, r); if (msg.events?.length) events = msg.events; render(); }
    else if (msg.type === 'robot') { fleet.set(msg.robot.serialNumber, msg.robot); renderRobots(); }
    else if (msg.type === 'event' && msg.event) { events = [msg.event, ...events].slice(0, 300); renderTimeline(); }
    else if (msg.type === 'forget') { for (const s of fleet.keys()) if (msg.key?.endsWith(`/${s}`)) fleet.delete(s); renderRobots(); }
  });
  render();
  return { destroy() { stream.close(); } };
}
