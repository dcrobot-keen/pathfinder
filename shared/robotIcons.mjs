// 로봇 타입별 기본 아이콘. 이미지 생성 도구가 없어 손으로 그린 단순 플랫 스타일
// SVG 도형으로 대체했다 (실제 로고/사진이 아닌 개략적인 형태 아이콘).
// 서버(시드 데이터)와 브라우저(폼 미리보기) 양쪽에서 그대로 재사용한다.

export const ROBOT_ICON_SVG = {
  humanoid: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <circle cx="32" cy="12" r="8" fill="#4a90e2"/>
    <rect x="24" y="22" width="16" height="20" rx="4" fill="#4a90e2"/>
    <rect x="10" y="24" width="8" height="18" rx="3" fill="#357abd" transform="rotate(-15 14 24)"/>
    <rect x="46" y="24" width="8" height="18" rx="3" fill="#357abd" transform="rotate(15 50 24)"/>
    <rect x="24" y="42" width="7" height="18" rx="3" fill="#357abd"/>
    <rect x="33" y="42" width="7" height="18" rx="3" fill="#357abd"/>
  </svg>`,

  quadruped: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <rect x="14" y="22" width="36" height="16" rx="6" fill="#f5a623"/>
    <rect x="46" y="18" width="10" height="8" rx="3" fill="#d4880f"/>
    <rect x="16" y="36" width="6" height="16" rx="2" fill="#d4880f"/>
    <rect x="26" y="36" width="6" height="16" rx="2" fill="#d4880f"/>
    <rect x="36" y="36" width="6" height="16" rx="2" fill="#d4880f"/>
    <rect x="46" y="36" width="6" height="16" rx="2" fill="#d4880f"/>
  </svg>`,

  wheeled_nonholonomic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <rect x="14" y="18" width="36" height="28" rx="6" fill="#7e57c2"/>
    <circle cx="18" cy="18" r="6" fill="#4b2e83"/>
    <circle cx="46" cy="18" r="6" fill="#4b2e83"/>
    <circle cx="18" cy="46" r="6" fill="#4b2e83"/>
    <circle cx="46" cy="46" r="6" fill="#4b2e83"/>
  </svg>`,

  agv_amr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <rect x="10" y="34" width="44" height="14" rx="4" fill="#26a69a"/>
    <circle cx="20" cy="50" r="5" fill="#1b6f66"/>
    <circle cx="44" cy="50" r="5" fill="#1b6f66"/>
    <rect x="28" y="18" width="8" height="16" rx="2" fill="#1b6f66"/>
    <circle cx="32" cy="14" r="5" fill="#26a69a"/>
  </svg>`,

  unknown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <circle cx="32" cy="32" r="26" fill="#78909c"/>
    <text x="32" y="43" font-family="sans-serif" font-size="30" font-weight="bold" fill="#fff" text-anchor="middle">?</text>
  </svg>`,
};

/** SVG 마크업을 <img src>에 바로 쓸 수 있는 data URI로 변환한다 (Node/브라우저 공용). */
export function svgToDataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const ROBOT_ICON_DATA_URI = Object.fromEntries(
  Object.entries(ROBOT_ICON_SVG).map(([type, svg]) => [type, svgToDataUri(svg)])
);
