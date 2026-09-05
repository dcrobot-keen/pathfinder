import { LayerThumbList } from 's2m-ui';

function Swatch({ bg }: { bg: string }) {
  return <div style={{ width: '100%', height: '100%', background: bg }} />;
}

export function Default() {
  return (
    <LayerThumbList
      layers={[
        { label: 'Occupancy', sublabel: '흑백 그리드', thumbnail: <Swatch bg="#e7ecf3" /> },
        { label: '컬러 top-down', sublabel: '실제 색상', thumbnail: <Swatch bg="#8a7355" /> },
        { label: '벡터 (GeoJSON)', sublabel: '벽·가구 폴리곤', thumbnail: <Swatch bg="#0f1621" />, active: true },
        { label: '3D 오버레이', sublabel: 'gltf-inspector', thumbnail: <span style={{ color: 'var(--text-faint)', fontSize: 20 }}>▨</span> },
      ]}
    />
  );
}
