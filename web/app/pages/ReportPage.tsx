import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ScreenHeader,
  LayerThumbList,
  ToggleLegend,
  SidePanel,
  SidePanelSection,
  StatGrid,
  RegistrationSummary,
  LinksList,
  Button,
  type Layer,
} from '../../src/index';
import { fileUrl, getReport, type ReportJson } from '../api';

interface LayerDef {
  key: string;
  label: string;
  sublabel: string;
  kind: 'image' | 'link';
  path: string;
}

export function ReportPage() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportJson | null>(null);
  const [totalRoomArea, setTotalRoomArea] = useState<number | null>(null);
  const [selected, setSelected] = useState('occupancy');

  useEffect(() => {
    getReport(name).then(setReport).catch(() => setReport(null));
    fetch(fileUrl(name, 'output.geojson'))
      .then((r) => (r.ok ? r.json() : null))
      .then((geojson) => {
        if (!geojson) return;
        const area = geojson.features
          .filter((f: any) => f.properties?.category === 'room')
          .reduce((sum: number, f: any) => sum + (f.properties?.area_m2 ?? 0), 0);
        setTotalRoomArea(area);
      })
      .catch(() => {});
  }, [name]);

  const layerDefs: LayerDef[] = [
    { key: 'occupancy', label: 'Occupancy', sublabel: '흑백 그리드', kind: 'image', path: 'map/map.png' },
    { key: 'color', label: '컬러 top-down', sublabel: '실제 색상', kind: 'image', path: 'map/map_color.png' },
    ...(report?.class_counts
      ? ([{ key: 'classified', label: '분류 top-down', sublabel: '바닥·벽·가구', kind: 'image', path: 'map/classified_topdown.png' }] as LayerDef[])
      : []),
    { key: 'geojson', label: '벡터 (GeoJSON)', sublabel: '파일 열기', kind: 'link', path: 'output.geojson' },
    { key: '3d', label: '3D 오버레이', sublabel: 'gltf-inspector', kind: 'link', path: 'overlay.glb' },
  ];

  const layers: Layer[] = layerDefs.map((def) => ({
    label: def.label,
    sublabel: def.sublabel,
    active: def.key === selected,
    thumbnail:
      def.kind === 'image' ? (
        <img src={fileUrl(name, def.path)} alt={def.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ color: 'var(--text-faint)', fontSize: 20 }}>▨</span>
      ),
    onClick: () => (def.kind === 'image' ? setSelected(def.key) : window.open(fileUrl(name, def.path), '_blank')),
  }));

  const selectedDef = layerDefs.find((d) => d.key === selected);

  return (
    <div style={{ background: 'var(--bg)', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ScreenHeader
        crumb={['프로젝트', name]}
        pillText="✓ 처리 완료"
        pillTone="success"
        actions={
          <>
            <Button onClick={() => navigate('/')}>대시보드로</Button>
            <Button variant="primary" onClick={() => window.open(fileUrl(name, 'overlay.glb'), '_blank')}>
              3D로 보기 (gltf-inspector)
            </Button>
          </>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LayerThumbList layers={layers} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <ToggleLegend
            items={[
              { color: 'var(--wall)', label: `벽 (${report?.num_wall_planes ?? '-'})` },
              { color: 'var(--furniture)', label: `가구 (${report?.num_furniture ?? '-'})` },
              { color: 'var(--traj)', label: '로봇 궤적' },
              { color: 'var(--danger)', label: '정합 오버레이', round: true, on: !!report?.registration },
            ]}
          />
          <div
            style={{
              flex: 1,
              background: '#0f1621',
              backgroundImage:
                'repeating-linear-gradient(0deg, #151c26 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, #151c26 0 1px, transparent 1px 24px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {selectedDef?.kind === 'image' ? (
              <img
                src={fileUrl(name, selectedDef.path)}
                alt={selectedDef.label}
                style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
              />
            ) : null}
          </div>
        </div>
        <SidePanel>
          <SidePanelSection title="요약">
            <StatGrid
              stats={[
                { value: report ? report.num_base_points.toLocaleString() : '-', label: '포인트 (전처리 후)' },
                { value: totalRoomArea != null ? `${totalRoomArea.toFixed(1)}㎡` : '-', label: '실내 면적' },
                { value: report?.num_wall_planes != null ? String(report.num_wall_planes) : '-', label: '벽 평면' },
                { value: report ? String(report.num_furniture) : '-', label: '가구 폴리곤' },
              ]}
            />
          </SidePanelSection>

          {report?.registration ? (
            <RegistrationSummary
              rows={[
                ['회전', `${report.registration.rotation_deg.toFixed(1)}°`],
                ['이동', `${report.registration.translation[0].toFixed(2)}, ${report.registration.translation[1].toFixed(2)} m`],
                ['RMSE', `${report.registration.rmse.toFixed(3)} m`],
              ]}
            />
          ) : null}

          <SidePanelSection title="산출물">
            <LinksList
              links={[
                { label: 'base_map.ply', href: fileUrl(name, 'base_map.ply') },
                { label: 'map.pgm', href: fileUrl(name, 'map/map.pgm') },
                { label: 'map.yaml', href: fileUrl(name, 'map/map.yaml') },
                ...(report?.class_counts ? [{ label: 'classified.ply', href: fileUrl(name, 'classified.ply') }] : []),
                { label: 'output.geojson', href: fileUrl(name, 'output.geojson') },
                { label: 'viewer.html (2D 재생)', href: fileUrl(name, 'viewer.html') },
                { label: 'overlay.glb (3D)', href: fileUrl(name, 'overlay.glb') },
                { label: 'report.html (원본 리포트)', href: fileUrl(name, 'report.html') },
              ]}
            />
          </SidePanelSection>
        </SidePanel>
      </div>
    </div>
  );
}
