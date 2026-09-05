// 운영 › 플릿 보드 -- 운영 화면 왼쪽의 로봇 목록. 한 줄에 상태가 다 읽히게
// (이름·연결·주행 상태·배터리·마지막 수신) 만들고, 행을 누르면 그 로봇이 이동 명령의
// 대상이 된다. 취소/일시정지/재개는 선택된 행에만 보인다. 데이터는 서버의
// /api/vda5050/stream 하나만 구독한다(fleetApi.js). 표 형태의 전체 보기(위치·주문·
// 오류 열)는 M2의 로봇 상세 화면으로 간다.
import { forgetFleetRobot, sendFleetInstantAction, subscribeFleetStream } from './fleetApi.js';
import { listRobots } from '../robots/robotApi.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const CONNECTION_LABEL = { ONLINE: '온라인', OFFLINE: '오프라인', CONNECTIONBROKEN: '연결 끊김', UNKNOWN: '알 수 없음' };

function fmtAge(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return '방금';
  if (ms < 60_000) return `${Math.round(ms / 1000)}초 전`;
  return `${Math.round(ms / 60_000)}분 전`;
}

function detailItem(label, val, isAlert = false) {
  const d = el('div', 'fleet-detail-item');
  d.appendChild(el('span', 'fleet-detail-label', label));
  const b = el('b', 'fleet-detail-val', val);
  if (isAlert) b.style.color = '#e57373';
  d.appendChild(b);
  return d;
}

function renderRobotDetail(r, reg, s) {
  const detail = el('div', 'fleet-row-detail');
  const grid = el('div', 'fleet-detail-grid');

  const x = r.position?.x != null ? `${r.position.x.toFixed(2)}m` : '-';
  const y = r.position?.y != null ? `${r.position.y.toFixed(2)}m` : '-';
  const deg = r.position?.theta != null ? `${((r.position.theta * 180) / Math.PI).toFixed(1)}°` : '-';
  const posInit = r.position?.positionInitialized ? '초기화됨' : '미초기화';
  grid.appendChild(detailItem('위치 (x, y, θ)', `${x}, ${y}, ${deg} (${posInit})`));
  grid.appendChild(detailItem('좌표계 (mapId)', r.position?.mapId ?? 'default'));

  const orderText = s?.orderId ? `${s.orderId} (노드 ${s.lastNodeId ?? '-'}, 잔여 ${s.nodesLeft ?? 0})` : '주문 없음';
  grid.appendChild(detailItem('현재 주문', orderText));
  grid.appendChild(detailItem('운용 모드', s?.operatingMode ?? 'AUTOMATIC'));

  const eStop = s?.safetyState?.eStop ?? 'NONE';
  const safeText = eStop !== 'NONE' ? `E-STOP (${eStop})` : s?.safetyState?.fieldViolation ? '영역 침범' : '정상';
  grid.appendChild(detailItem('안전 상태', safeText, eStop !== 'NONE'));

  const battVolt = s?.batteryVoltage != null ? `${s.batteryVoltage.toFixed(1)}V` : '';
  const battCharge = s?.batteryCharge != null ? `${s.batteryCharge.toFixed(0)}%` : '';
  const battCombined = [battCharge, battVolt].filter(Boolean).join(' · ') || '-';
  grid.appendChild(detailItem('배터리', battCombined));

  if (reg) {
    grid.appendChild(detailItem('모델 / 속도', `${reg.company ?? r.manufacturer} · 최대 ${reg.speedMps ?? '-'}m/s`));
    grid.appendChild(detailItem('알고리즘 / 반경', `${reg.algorithm ?? '-'} · 반경 ${reg.sizeMeters ?? '-'}m`));
  }
  detail.appendChild(grid);

  if (s?.errors && s.errors.length > 0) {
    const errBox = el('div', 'fleet-detail-errors');
    errBox.appendChild(el('div', 'fleet-detail-errors-title', `오류 목록 (${s.errors.length}건)`));
    for (const e of s.errors) {
      const errItem = el('div', `fleet-detail-error-item ${e.errorLevel === 'FATAL' ? 'fatal' : 'warn'}`);
      errItem.textContent = `[${e.errorLevel ?? 'WARN'}] ${e.errorType}: ${e.errorDescription ?? '-'}`;
      errBox.appendChild(errItem);
    }
    detail.appendChild(errBox);
  }

  return detail;
}

/**
 * @param {HTMLElement} containerEl
 * @param {{ onSelect?: (robot|null) => void, onStatus?: (text, isError) => void }} opts
 *   onSelect 로 넘기는 robot 은 플릿 레코드(serialNumber, manufacturer, position, state, ...)에
 *   레지스트리 항목이 있으면 `registry` 필드로 붙는다.
 */
export function createFleetBoard(containerEl, { onSelect = () => {}, onStatus = () => {} } = {}) {
  containerEl.classList.add('fleet-board');
  const header = el('div', 'fleet-board-header');
  const title = el('span', 'fleet-board-title', '로봇');
  const brokerDot = el('span', 'fleet-board-broker', '브로커 확인 중');
  header.append(title, brokerDot);

  const globalActions = el('div', 'fleet-board-globals');
  const stopAllBtn = el('button', 'robot-button robot-button-danger', '전체 정지');
  const pauseAllBtn = el('button', 'robot-button', '전체 일시정지');
  const resumeAllBtn = el('button', 'robot-button', '전체 재개');
  globalActions.append(stopAllBtn, pauseAllBtn, resumeAllBtn);

  const list = el('div', 'fleet-board-list');
  const empty = el('div', 'fleet-board-empty', '수신한 로봇이 없습니다. 설정에서 브로커를 연결하세요.');
  containerEl.append(header, globalActions, list, empty);

  const robots = new Map(); // key -> record
  let registryBySerial = new Map();
  let brokerStatus = { connected: false };
  let staleAfterMs = 5000;
  let selectedSerial = null;

  async function loadRegistry() {
    try {
      const all = await listRobots();
      registryBySerial = new Map(all.filter((r) => r.vda5050Serial).map((r) => [r.vda5050Serial, r]));
    } catch {
      /* 레지스트리 없이도 목록은 뜬다 */
    }
  }

  function decorate(r) {
    return { ...r, registry: registryBySerial.get(r.serialNumber) ?? null };
  }

  function select(serial) {
    selectedSerial = serial;
    render();
    const r = Array.from(robots.values()).find((x) => x.serialNumber === serial);
    onSelect(r ? decorate(r) : null);
  }

  async function action(r, actionType, button) {
    button.disabled = true;
    try {
      await sendFleetInstantAction(r.manufacturer, r.serialNumber, actionType);
      onStatus(`${r.serialNumber}: ${actionType} 전송`, false);
    } catch (err) {
      onStatus(`${r.serialNumber}: ${actionType} 실패 — ${err.message}`, true);
    } finally {
      button.disabled = false;
    }
  }

  stopAllBtn.addEventListener('click', async () => {
    stopAllBtn.disabled = true;
    try {
      const list = Array.from(robots.values()).filter((r) => r.connectionState === 'ONLINE');
      await Promise.all(list.map((r) => sendFleetInstantAction(r.manufacturer, r.serialNumber, 'cancelOrder').catch(() => {})));
      onStatus(`전체 ${list.length}대 비상정지 완료`, false);
    } catch (e) {
      onStatus(`전체 정지 실패: ${e.message}`, true);
    } finally {
      stopAllBtn.disabled = false;
    }
  });

  pauseAllBtn.addEventListener('click', async () => {
    pauseAllBtn.disabled = true;
    try {
      const list = Array.from(robots.values()).filter((r) => r.connectionState === 'ONLINE');
      await Promise.all(list.map((r) => sendFleetInstantAction(r.manufacturer, r.serialNumber, 'stopPause').catch(() => {})));
      onStatus(`전체 ${list.length}대 일시정지 전송`, false);
    } catch (e) {
      onStatus(`전체 일시정지 실패: ${e.message}`, true);
    } finally {
      pauseAllBtn.disabled = false;
    }
  });

  resumeAllBtn.addEventListener('click', async () => {
    resumeAllBtn.disabled = true;
    try {
      const list = Array.from(robots.values()).filter((r) => r.connectionState === 'ONLINE');
      await Promise.all(list.map((r) => sendFleetInstantAction(r.manufacturer, r.serialNumber, 'startPause').catch(() => {})));
      onStatus(`전체 ${list.length}대 재개 전송`, false);
    } catch (e) {
      onStatus(`전체 재개 실패: ${e.message}`, true);
    } finally {
      resumeAllBtn.disabled = false;
    }
  });

  function render() {
    const now = Date.now();
    const rows = Array.from(robots.values()).sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
    title.textContent = `로봇 ${rows.length}`;
    brokerDot.textContent = brokerStatus.connected ? '브로커 연결됨' : '브로커 끊김';
    brokerDot.classList.toggle('on', brokerStatus.connected);
    globalActions.style.display = rows.length > 0 ? 'flex' : 'none';
    empty.hidden = rows.length > 0;

    // 플릿 간 근접 감지 (거리 1.2m 이내면 경고 배지 표시)
    const proximityWarnings = new Map();
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        if (a.position?.x != null && b.position?.x != null && a.connectionState === 'ONLINE' && b.connectionState === 'ONLINE') {
          const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
          if (dist < 1.2) {
            proximityWarnings.set(a.serialNumber, `⚠️ 근접 (${dist.toFixed(2)}m ↔ ${b.serialNumber})`);
            proximityWarnings.set(b.serialNumber, `⚠️ 근접 (${dist.toFixed(2)}m ↔ ${a.serialNumber})`);
          }
        }
      }
    }

    list.replaceChildren();
    for (const r of rows) {
      const reg = registryBySerial.get(r.serialNumber);
      const s = r.state;
      const age = r.lastSeen ? now - r.lastSeen : null;
      const stale = age != null && age > staleAfterMs;
      const online = brokerStatus.connected && r.connectionState === 'ONLINE' && !stale;

      const row = el('div', 'fleet-row');
      row.classList.toggle('selected', r.serialNumber === selectedSerial);
      row.classList.toggle('offline', !online);
      row.tabIndex = 0;
      row.addEventListener('click', () => select(r.serialNumber === selectedSerial ? null : r.serialNumber));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });

      const icon = document.createElement('img');
      icon.className = 'fleet-row-icon';
      if (reg?.icon) icon.src = reg.icon; else icon.hidden = true;

      const main = el('div', 'fleet-row-main');
      main.appendChild(el('div', 'fleet-row-name', reg?.name ?? r.serialNumber));
      const sub = el('div', 'fleet-row-sub');
      const conn = CONNECTION_LABEL[r.connectionState] ?? CONNECTION_LABEL.UNKNOWN;
      const stateText = !online ? conn + (stale && r.connectionState === 'ONLINE' ? ' · 오래됨' : '') : !s ? '온라인' : s.paused ? '일시정지' : s.driving ? `주행 중 · 남은 노드 ${s.nodesLeft ?? '-'}` : s.nodesLeft ? '대기' : '유휴';
      sub.textContent = `${stateText} · ${fmtAge(age)}`;
      main.appendChild(sub);

      const prox = proximityWarnings.get(r.serialNumber);
      if (prox) {
        main.appendChild(el('div', 'fleet-row-prox', prox));
      }

      if (s?.errors?.length) {
        const e = s.errors[s.errors.length - 1];
        const err = el('div', 'fleet-row-error', `${e.errorType}${e.errorLevel === 'FATAL' ? ' (FATAL)' : ''}`);
        err.title = e.errorDescription ?? '';
        main.appendChild(err);
      }

      const side = el('div', 'fleet-row-side');
      const pill = el('span', 'fleet-pill');
      pill.classList.add(!online ? 'off' : s?.paused ? 'paused' : s?.driving ? 'driving' : 'idle');
      pill.textContent = !online ? '●' : s?.paused ? '∥' : s?.driving ? '▶' : '●';
      side.appendChild(pill);
      side.appendChild(el('span', 'fleet-row-batt', s?.batteryCharge != null ? `${s.batteryCharge.toFixed(0)}%` : ''));

      row.append(icon, main, side);

      if (r.serialNumber === selectedSerial) {
        const actions = el('div', 'fleet-row-actions');
        const cancelBtn = el('button', 'robot-button robot-button-danger', '취소');
        cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); action(r, 'cancelOrder', cancelBtn); });
        const pauseBtn = el('button', 'robot-button', s?.paused ? '재개' : '일시정지');
        pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); action(r, s?.paused ? 'startPause' : 'stopPause', pauseBtn); });
        const forgetBtn = el('button', 'robot-button', '목록에서 제거');
        forgetBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await forgetFleetRobot(r.manufacturer, r.serialNumber);
            robots.delete(r.key);
            select(null);
          } catch (err) {
            onStatus(`제거 실패 — ${err.message}`, true);
          }
        });
        cancelBtn.disabled = pauseBtn.disabled = !online;
        actions.append(cancelBtn, pauseBtn, forgetBtn);
        row.appendChild(actions);
        row.appendChild(renderRobotDetail(r, reg, s));
      }
      list.appendChild(row);
    }
  }

  const stream = subscribeFleetStream((msg) => {
    if (msg.type === 'snapshot') {
      brokerStatus = msg.status;
      staleAfterMs = msg.staleAfterMs ?? staleAfterMs;
      robots.clear();
      for (const r of msg.robots) robots.set(r.key, r);
      loadRegistry().then(render);
    } else if (msg.type === 'robot') {
      const isNew = !robots.has(msg.robot.key);
      robots.set(msg.robot.key, msg.robot);
      if (isNew) setTimeout(() => loadRegistry().then(render), 800); // 서버 자동 등록 뒤
      if (msg.robot.serialNumber === selectedSerial) onSelect(decorate(msg.robot));
    } else if (msg.type === 'status') {
      brokerStatus = msg.status;
    } else if (msg.type === 'forget') {
      robots.delete(msg.key);
    }
    render();
  });
  const ageTimer = setInterval(render, 2000);

  return {
    select,
    getSelected: () => { const r = Array.from(robots.values()).find((x) => x.serialNumber === selectedSerial); return r ? decorate(r) : null; },
    robots,
    destroy() { stream.close(); clearInterval(ageTimer); },
  };
}
