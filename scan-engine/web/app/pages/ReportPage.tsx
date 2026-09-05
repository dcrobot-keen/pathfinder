import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
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
  Dropzone,
  Button,
  type Layer,
} from '../../src/index';
import { alignGeojson, alignImage, fileUrl, getReport, type ReportJson } from '../api';

interface LayerDef {
  key: string;
  label: string;
  sublabel: string;
  kind: 'image' | 'link';
  path: string;
}

/** Dropzone is presentational-only in the s2m-ui library (no onDrop/hidden
 * input of its own) -- ported verbatim from WizardPage.tsx, which solves the
 * same "wrap it with real file I/O" problem for the upload wizard. */
function FileDrop(props: { label: ReactNode; hint: ReactNode; accept?: string; multiple?: boolean; onFiles: (files: FileList) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files.length) props.onFiles(e.dataTransfer.files);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) props.onFiles(e.target.files);
  }

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={props.accept}
        multiple={props.multiple}
        onChange={handleChange}
      />
      <Dropzone label={props.label} hint={props.hint} onClick={() => inputRef.current?.click()} />
    </div>
  );
}

export function ReportPage() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportJson | null>(null);
  const [totalRoomArea, setTotalRoomArea] = useState<number | null>(null);
  const [selected, setSelected] = useState('occupancy');
  const [geojsonUploading, setGeojsonUploading] = useState(false);
  const [geojsonError, setGeojsonError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

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

  async function handleGeojsonFiles(files: FileList) {
    const file = files[0];
    if (!file) return;
    setGeojsonUploading(true);
    setGeojsonError(null);
    try {
      const { url } = await alignGeojson(name, file);
      window.open(fileUrl(name, url), '_blank');
    } catch (err) {
      setGeojsonError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeojsonUploading(false);
    }
  }

  async function handleImageFiles(files: FileList) {
    const file = files[0];
    if (!file) return;
    setImageUploading(true);
    setImageError(null);
    try {
      const { url } = await alignImage(name, file);
      window.open(fileUrl(name, url), '_blank');
    } catch (err) {
      setImageError(err instanceof Error ? err.message : String(err));
    } finally {
      setImageUploading(false);
    }
  }

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

          <SidePanelSection title="좌표 보정">
            {report?.registration ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>
                  로봇 지도 정합 확인/조정
                </div>
                <Button onClick={() => window.open(fileUrl(name, 'align.html'), '_blank')}>align.html 열기</Button>
              </div>
            ) : null}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>GeoJSON 정렬</div>
              <FileDrop
                accept=".geojson,.json"
                label={<><b>.geojson</b> 드래그, 또는 클릭해서 선택</>}
                hint="output.geojson을 기준으로 대응점을 찍어 정렬"
                onFiles={handleGeojsonFiles}
              />
              {geojsonUploading ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>업로드 중…</div>
              ) : null}
              {geojsonError ? (
                <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>{geojsonError}</div>
              ) : null}
            </div>

            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>이미지 지오레퍼런싱</div>
              <FileDrop
                accept="image/*"
                label={<>도면 <b>이미지</b> 드래그, 또는 클릭해서 선택</>}
                hint="output.geojson을 기준으로 대응점을 찍어 정렬 (world file 내보내기)"
                onFiles={handleImageFiles}
              />
              {imageUploading ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>업로드 중…</div>
              ) : null}
              {imageError ? (
                <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>{imageError}</div>
              ) : null}
            </div>
          </SidePanelSection>

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
