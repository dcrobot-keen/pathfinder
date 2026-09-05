import { LinksList } from 's2m-ui';

export function Outputs() {
  return (
    <LinksList
      links={[
        { label: 'base_map.ply', href: '#' },
        { label: 'map.pgm', href: '#' },
        { label: 'map.yaml', href: '#' },
        { label: 'classified.ply', href: '#' },
        { label: 'output.geojson', href: '#' },
        { label: 'viewer.html (2D 재생)', href: '#' },
        { label: 'overlay.glb (3D)', href: '#' },
        { label: 'report.html (원본 리포트)', href: '#' },
      ]}
    />
  );
}
