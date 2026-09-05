// server/vda5050.mjs(:3001, Vite가 /api 프록시) 호출용 클라이언트 -- 플릿 (RCS) 탭.
async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

/** { config, status, supportedInstantActions } */
export function getFleetConfig() {
  return request('/api/vda5050/config');
}

/** 설정 저장 -> 서버가 즉시 브로커에 재접속한다. { config, status } */
export function putFleetConfig(config) {
  return request('/api/vda5050/config', { method: 'PUT', body: config });
}

/** { robots, status, staleAfterMs } */
export function listFleetRobots() {
  return request('/api/vda5050/robots');
}

export function forgetFleetRobot(manufacturer, serialNumber) {
  return request(`/api/vda5050/robots/${encodeURIComponent(manufacturer)}/${encodeURIComponent(serialNumber)}`, { method: 'DELETE' });
}

/** 경로 -> VDA5050 order. { orderId, orderUpdateId, topic, nodes } */
export function sendFleetOrder(manufacturer, serialNumber, path, { mapId, updatePrevious = false } = {}) {
  return request(`/api/vda5050/robots/${encodeURIComponent(manufacturer)}/${encodeURIComponent(serialNumber)}/order`, {
    method: 'POST',
    body: { path, mapId, updatePrevious },
  });
}

/** actionType: cancelOrder | stopPause | startPause */
export function sendFleetInstantAction(manufacturer, serialNumber, actionType) {
  return request(`/api/vda5050/robots/${encodeURIComponent(manufacturer)}/${encodeURIComponent(serialNumber)}/instant-actions`, {
    method: 'POST',
    body: { actionType },
  });
}

/**
 * /api/vda5050/stream 구독. 첫 메시지는 { type: 'snapshot', status, robots },
 * 이후 { type: 'robot', robot } / { type: 'status', status } / { type: 'forget', key }.
 * @returns {{ close: () => void }}
 */
export function subscribeFleetStream(onMessage, { reconnectDelayMs = 2000 } = {}) {
  let ws = null;
  let closed = false;
  function connect() {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/api/vda5050/stream`);
    ws.addEventListener('message', (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (err) {
        console.error('플릿 스트림 메시지 처리 실패', err);
      }
    });
    ws.addEventListener('close', () => {
      if (!closed) setTimeout(connect, reconnectDelayMs);
    });
    ws.addEventListener('error', () => ws.close());
  }
  connect();
  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
