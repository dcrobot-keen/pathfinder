import { FilePill } from 's2m-ui';

export function Loaded() {
  return <FilePill icon="▦" name="robot_map.pgm" meta="512×480 · 5cm/px" />;
}

export function Config() {
  return <FilePill icon="⚙" name="robot_map.yaml" meta="1.2 KB" />;
}

export function Scan() {
  return <FilePill icon="◧" name="scan.usdz" meta="184.3 MB" />;
}

export function NoStatus() {
  return <FilePill icon="▦" name="base_map.ply" meta="955,412 pts" status="" />;
}
