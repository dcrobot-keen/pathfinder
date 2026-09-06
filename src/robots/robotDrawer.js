// 로봇 상세 드로어 -- 로봇 › 기기 카드를 누르면 오른쪽에서 열린다.
// 프로필(레지스트리) · VDA5050 상태(플릿 스트림, 실시간) · 오류 · 최근 주문(/api/vda5050/orders) · 구독 토픽 · 연결 진단.
import { subscribeFleetStream, getRobotOrders } from '../fleet/fleetApi.js';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const CONNECTION_LABEL = { ONLINE: '온라인', OFFLINE: '오프라인', CONNECTIONBROKEN: '연결 끊김', UNKNOWN: '알 수 없음' };
const STATUS_LABEL = { SENT: ['전송', 'sent'], ACTIVE: ['진행', 'sent'], DRIVING: ['주행 중', 'driving'], PAUSED: ['일시정지', 'paused'], FINISHED: ['완료', 'finished'], CANCELLED: ['취소', 'danger'], ABORTED: ['중단', 'danger'] };
const fmtAge = (ms) => (ms == null ? '-' : ms < 1000 ? '방금' : ms < 60000 ? `${Math.round(ms / 1000)}초 전` : `${Math.round(ms / 60000)}분 전`);
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');

let singleton = null;

export function openRobotDrawer(robot) {
  if (!singleton) singleton = createRobotDrawer();
  singleton.open(robot);
}

export function createRobotDrawer() {
  const overlay = el('div', 's2m-drawer-overlay');
  overlay.hidden = true;
  const drawer = el('aside', 's2m-drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.innerHTML = `
    <div class="s2m-drawer__head">
      <div><div class="s2m-drawer__title"></div><div class="s2m-drawer__sub"></div></div>
      <button class="robot-button" data-act="close" aria-label="닫기">닫기</button>
    </div>
    <div class="s2m-drawer__body">
      <section class="s2m-drawer__section"><div class="align-ws__title">프로필</div><div class="s2m-kv" data-sec="profile"></div></section>
      <section class="s2m-drawer__section"><div class="align-ws__title">VDA5050 상태 <span class="align-ws__count" data-sec="live"></span></div><div class="s2m-stats" data-sec="state"></div></section>
      <section class="s2m-drawer__section"><div class="align-ws__title">오류</div><div data-sec="errors" class="align-ws__note"></div></section>
      <section class="s2m-drawer__section"><div class="align-ws__title">최근 주문 <span class="align-ws__count" data-sec="ordersCount"></span></div><div data-sec="orders" class="s2m-side__list"></div></section>
      <section class="s2m-drawer__section"><div class="align-ws__title">연결 진단</div><div class="s2m-kv" data-sec="diag"></div></section>
      <section class="s2m-drawer__section"><div class="align-ws__title">구독 토픽</div><div data-sec="topics" class="s2m-topics"></div></section>
    </div>`;
  overlay.appendChild(drawer);
  document.body.appendChild(overlay);
  const $ = (sec) => drawer.querySelector(`[data-sec="${sec}"]`);

  let robot = null;
  let record = null;
  let brokerConnected = false;
  const fleet = new Map();
  const stream = subscribeFleetStream((msg) => {
    if (msg.type === 'snapshot') { brokerConnected = msg.status?.connected === true; fleet.clear(); for (const r of msg.robots) fleet.set(r.serialNumber, r); }
    else if (msg.type === 'robot') fleet.set(msg.robot.serialNumber, msg.robot);
    else if (msg.type === 'status') brokerConnected = msg.status?.connected === true;
    else if ((msg.type === 'order' || msg.type === 'order_update') && robot && msg.serialNumber === robot.vda5050Serial) loadOrders();
    if (!overlay.hidden && robot) renderLive();
  });

  function kv(container, rows) {
    container.replaceChildren();
    for (const [k, v] of rows) {
      const row = el('div', 's2m-kv__row');
      row.append(el('span', 's2m-kv__k', k), el('span', 's2m-kv__v', v ?? '-'));
      container.appendChild(row);
    }
  }
  function stat(label, value, tone) {
    const box = el('div', 's2m-stat');
    box.append(el('div', 's2m-stat__label', label), el('div', `s2m-stat__val${tone ? ` s2m-stat__val--${tone}` : ''}`, value));
    return box;
  }

  function renderProfile() {
    drawer.querySelector('.s2m-drawer__title').textContent = robot.name;
    drawer.querySelector('.s2m-drawer__sub').textContent = [robot.modelName || robot.model?.name, robot.vda5050Serial ? `${robot.vda5050Manufacturer ?? '?'} / ${robot.vda5050Serial}` : 'VDA5050 미연결'].filter(Boolean).join(' · ');
    kv($('profile'), [
      ['모델', robot.modelName || robot.model?.name || '미지정'],
      ['제조/소속', robot.company || '-'],
      ['반경 · 최대 속도', `${robot.sizeMeters ?? '-'} m · ${robot.speedMps ?? '-'} m/s`],
      ['경로 알고리즘', robot.algorithm || '-'],
      ['설명', robot.description || '-'],
    ]);
    const topics = $('topics');
    topics.replaceChildren();
    if (robot.vda5050Serial) {
      const base = `uagv/v2/${robot.vda5050Manufacturer ?? '?'}/${robot.vda5050Serial}`;
      for (const [name, dir] of [['connection', '로봇 →'], ['state', '로봇 →'], ['visualization', '로봇 →'], ['order', '→ 로봇'], ['instantActions', '→ 로봇']]) {
        const row = el('div', 's2m-topics__row');
        row.append(el('span', 's2m-topics__dir', dir), el('code', null, `${base}/${name}`));
        topics.appendChild(row);
      }
    } else {
      topics.appendChild(el('div', 'align-ws__note', '이 기기는 VDA5050 시리얼이 없어 브로커 토픽이 없습니다.'));
    }
  }

  function renderLive() {
    record = robot.vda5050Serial ? fleet.get(robot.vda5050Serial) ?? null : null;
    const st = record?.state;
    const online = brokerConnected && record?.connectionState === 'ONLINE';
    $('live').textContent = record ? (online ? '실시간' : CONNECTION_LABEL[record.connectionState] ?? '') : '스트림에 없음';
    const box = $('state');
    box.replaceChildren();
    if (!record) { box.appendChild(el('div', 'align-ws__note', brokerConnected ? '브로커에서 이 시리얼의 메시지를 아직 받지 못했습니다.' : 'MQTT 브로커에 연결되어 있지 않습니다 (설정 › 연결).')); }
    else {
      const eStop = st?.safetyState?.eStop ?? 'NONE';
      box.append(
        stat('연결', CONNECTION_LABEL[record.connectionState] ?? '-', online ? 'success' : 'danger'),
        stat('주행', !st ? '-' : eStop !== 'NONE' ? `E-STOP ${eStop}` : st.paused ? '일시정지' : st.driving ? `주행 · 남은 노드 ${st.nodesLeft ?? '-'}` : '유휴', eStop !== 'NONE' ? 'danger' : st?.paused ? 'warn' : st?.driving ? 'success' : null),
        stat('배터리', st?.batteryCharge != null ? `${st.batteryCharge.toFixed(0)}%${st.batteryVoltage != null ? ` · ${st.batteryVoltage.toFixed(1)} V` : ''}` : '-'),
        stat('위치', record.position ? `${record.position.x.toFixed(2)}, ${record.position.y.toFixed(2)} · ${((record.position.theta ?? 0) * 180 / Math.PI).toFixed(0)}°` : '-'),
        stat('지도 (mapId)', record.position?.mapId ?? '-'),
        stat('운용 모드', st?.operatingMode ?? '-'),
      );
    }
    const errors = $('errors');
    errors.replaceChildren();
    if (st?.errors?.length) {
      for (const e of st.errors) errors.appendChild(el('div', `s2m-order__meta${e.errorLevel === 'FATAL' ? ' s2m-order__meta--danger' : ''}`, `[${e.errorLevel ?? 'WARN'}] ${e.errorType}: ${e.errorDescription ?? '-'}`));
    } else errors.textContent = record ? '오류 없음' : '-';
    kv($('diag'), [
      ['브로커', brokerConnected ? '연결됨' : '끊김'],
      ['마지막 수신', record?.lastSeen ? `${fmtAge(Date.now() - record.lastSeen)} (${fmtTime(record.lastSeen)})` : '-'],
      ['마지막 state', record?.lastStateAt ? fmtAge(Date.now() - record.lastStateAt) : '-'],
      ['마지막 주문', record?.lastOrder ? `${String(record.lastOrder.orderId).slice(0, 8)} · 노드 ${record.lastOrder.waypoints} · ${fmtTime(record.lastOrder.sentAt)}` : '-'],
    ]);
  }

  async function loadOrders() {
    const box = $('orders');
    if (!robot?.vda5050Serial) { box.replaceChildren(el('div', 'align-ws__note', '-')); $('ordersCount').textContent = ''; return; }
    try {
      const { orders } = await getRobotOrders(robot.vda5050Serial);
      $('ordersCount').textContent = String(orders.length);
      box.replaceChildren();
      if (!orders.length) box.appendChild(el('div', 'align-ws__note', '기록된 주문이 없습니다.'));
      for (const o of orders.slice(0, 8)) {
        const row = el('div', 's2m-order');
        const top = el('div', 's2m-order__top');
        const [label, tone] = STATUS_LABEL[o.status] ?? [o.status ?? '-', 'sent'];
        top.append(el('span', 's2m-order__robot', String(o.orderId).slice(0, 8)), el('span', `s2m-tag s2m-tag--${tone}`, label));
        row.appendChild(top);
        const total = o.nodeCount ?? 0, left = o.nodesLeft ?? (o.status === 'FINISHED' ? 0 : total);
        row.appendChild(el('div', 's2m-order__meta', `노드 ${Math.max(0, total - left)}/${total}${o.lastNodeId ? ` · 마지막 ${o.lastNodeId}` : ''} · ${fmtTime(o.sentAt)}`));
        if (o.abortReason) row.appendChild(el('div', 's2m-order__meta s2m-order__meta--danger', `중단 사유: ${o.abortReason}`));
        box.appendChild(row);
      }
    } catch (err) { box.replaceChildren(el('div', 'align-ws__note', `주문 이력 조회 실패: ${err.message}`)); }
  }

  function close() { overlay.hidden = true; }
  function open(r) {
    robot = r;
    renderProfile();
    renderLive();
    loadOrders();
    overlay.hidden = false;
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  drawer.querySelector('[data-act="close"]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (!overlay.hidden && e.key === 'Escape') close(); });
  const ticker = setInterval(() => { if (!overlay.hidden && robot) renderLive(); }, 5000); // "n초 전" 갱신

  return { open, close, destroy() { stream.close(); clearInterval(ticker); overlay.remove(); } };
}
