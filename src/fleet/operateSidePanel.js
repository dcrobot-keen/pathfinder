// 운영 › 오른쪽 사이드 패널 -- 주문 목록과 현장 요약. 플릿 스튜디오 디자인(목업)의
// SidePanel/StatGrid 를 실제 데이터로 채운다. 데이터는 tab.js 가 이미 구독하는
// /api/vda5050/stream 한 줄(robot/status/order/order_update)에서 그대로 받는다.
//   update({ robots, brokerConnected, registryBySerial })  플릿 레코드 배열 -> 요약/주문 상태 갱신
//   upsertOrder(order)                                     스트림의 order/order_update 반영
//   loadHistory(serials)                                   시작 시 /api/vda5050/orders/:serial 로 이력 채움
import { getRobotOrders } from './fleetApi.js';

const ORDERS_SHOWN = 5;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STATUS_LABEL = {
  SENT: ['전송', 'sent'],
  ACTIVE: ['진행', 'sent'],
  DRIVING: ['주행 중', 'driving'],
  PAUSED: ['일시정지', 'paused'],
  FINISHED: ['완료', 'finished'],
  CANCELLED: ['취소', 'danger'],
  ABORTED: ['중단', 'danger'],
  FAILED: ['실패', 'danger'],
};

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function createOperateSidePanel(containerEl) {
  containerEl.classList.add('s2m-side');

  // --- 주문 목록 ---
  const ordersSec = el('section', 's2m-side__section');
  const ordersHead = el('div', 's2m-side__title');
  ordersHead.append(el('span', null, '주문 목록'), el('span', 's2m-side__count', '0'));
  const ordersList = el('div', 's2m-side__list');
  ordersList.appendChild(el('div', 's2m-side__empty', '아직 보낸 주문이 없습니다. 지도에서 목적지를 지정하세요.'));
  ordersSec.append(ordersHead, ordersList);

  // --- 현장 요약 ---
  const statsSec = el('section', 's2m-side__section');
  const statsHead = el('div', 's2m-side__title');
  statsHead.append(el('span', null, '현장 요약'), el('span', 's2m-side__count s2m-side__broker', '브로커 확인 중'));
  const statGrid = el('div', 's2m-stats');
  statsSec.append(statsHead, statGrid);

  containerEl.append(ordersSec, statsSec);

  const orders = new Map(); // orderId -> 주문 기록(서버 orderHistory 항목)
  let robots = [];
  let brokerConnected = false;
  let registryBySerial = new Map();

  function robotName(serial) {
    return registryBySerial.get(serial)?.name ?? serial;
  }

  function stat(label, value, tone) {
    const box = el('div', 's2m-stat');
    box.appendChild(el('div', 's2m-stat__label', label));
    const v = el('div', `s2m-stat__val${tone ? ` s2m-stat__val--${tone}` : ''}`, String(value));
    box.appendChild(v);
    return box;
  }

  function renderStats() {
    const online = robots.filter((r) => r.connectionState === 'ONLINE');
    const driving = online.filter((r) => r.state?.driving).length;
    const paused = online.filter((r) => r.state?.paused).length;
    const errors = robots.reduce((n, r) => n + (r.state?.errors?.length ?? 0), 0);
    const estop = online.filter((r) => (r.state?.safetyState?.eStop ?? 'NONE') !== 'NONE').length;
    const activeOrders = online.filter((r) => r.state?.orderId && (r.state.nodesLeft ?? 0) > 0).length;
    const battery = online.map((r) => r.state?.batteryCharge).filter((b) => typeof b === 'number');
    const battAvg = battery.length ? `${Math.round(battery.reduce((a, b) => a + b, 0) / battery.length)}%` : '-';

    statGrid.replaceChildren(
      stat('로봇', robots.length),
      stat('온라인', online.length, online.length ? 'accent' : robots.length ? 'warn' : null),
      stat('주행 중', driving, driving ? 'success' : null),
      stat('진행 주문', activeOrders, activeOrders ? 'accent' : null),
      stat('일시정지', paused, paused ? 'warn' : null),
      stat('오류 / E-STOP', `${errors} / ${estop}`, errors || estop ? 'danger' : null),
      stat('평균 배터리', battAvg),
      stat('브로커', brokerConnected ? '연결' : '끊김', brokerConnected ? 'success' : 'danger'),
    );
    const brokerTag = statsHead.querySelector('.s2m-side__broker');
    brokerTag.textContent = brokerConnected ? 'MQTT 연결됨' : 'MQTT 끊김';
    brokerTag.classList.toggle('on', brokerConnected);
  }

  function renderOrders() {
    const list = Array.from(orders.values()).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
    ordersHead.querySelector('.s2m-side__count').textContent = String(list.length);
    ordersList.replaceChildren();
    if (list.length === 0) {
      ordersList.appendChild(el('div', 's2m-side__empty', '아직 보낸 주문이 없습니다. 지도에서 목적지를 지정하세요.'));
      return;
    }
    for (const o of list.slice(0, ORDERS_SHOWN)) {
      const row = el('div', 's2m-order');
      const top = el('div', 's2m-order__top');
      top.appendChild(el('span', 's2m-order__robot', robotName(o.serialNumber)));
      const [label, tone] = STATUS_LABEL[o.status] ?? [o.status ?? '-', 'sent'];
      top.appendChild(el('span', `s2m-tag s2m-tag--${tone}`, label));
      row.appendChild(top);

      const total = o.nodeCount ?? 0;
      const left = o.nodesLeft ?? (o.status === 'FINISHED' ? 0 : total);
      const done = Math.max(0, total - left);
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      if (total > 0 && o.status !== 'FINISHED' && o.status !== 'ABORTED' && o.status !== 'CANCELLED') {
        const bar = el('div', 's2m-order__bar');
        const fill = el('div', 's2m-order__fill');
        fill.style.width = `${pct}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
      }
      row.appendChild(
        el('div', 's2m-order__meta', `${String(o.orderId).slice(0, 8)} · 노드 ${done}/${total} · ${o.lastNodeId ? `마지막 ${o.lastNodeId} · ` : ''}${fmtTime(o.sentAt)}`),
      );
      if (o.abortReason) row.appendChild(el('div', 's2m-order__meta s2m-order__meta--danger', `중단 사유: ${o.abortReason}${o.abortDescription ? ` — ${o.abortDescription}` : ''}`));
      ordersList.appendChild(row);
    }
  }

  function upsertOrder(order) {
    if (!order?.orderId) return;
    orders.set(order.orderId, { ...(orders.get(order.orderId) ?? {}), ...order });
    renderOrders();
  }

  async function loadHistory(serials) {
    await Promise.all(
      (serials ?? []).map((serial) =>
        getRobotOrders(serial)
          .then(({ orders: list }) => { for (const o of list ?? []) orders.set(o.orderId, { ...(orders.get(o.orderId) ?? {}), ...o }); })
          .catch(() => {}),
      ),
    );
    renderOrders();
  }

  function update(next) {
    if (next.robots) robots = next.robots;
    if (typeof next.brokerConnected === 'boolean') brokerConnected = next.brokerConnected;
    if (next.registryBySerial) registryBySerial = next.registryBySerial;
    renderStats();
    renderOrders(); // 이름(레지스트리) 반영
  }

  renderStats();
  return { update, upsertOrder, loadHistory };
}
