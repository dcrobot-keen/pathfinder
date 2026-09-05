// ScanAlignment(offsetX, offsetZ, yawRadians) -- the per-scan rigid transform the
// iPhone app (vps-system/ios-capture ScanGroupStore.swift) and the desktop
// alignment workspace (scan-to-map-studio studio/merge_slicemaps.py) share via
// group_alignment.json (scan-group-alignment-v1). This is the JS copy of the
// same maths, pinned to vps-system/scan-format/alignment-vectors.json by
// scripts/scan-alignment-smoke.mjs -- change all three together or not at all.
//
// Two equivalent forms:
//   ARKit plane (x, z):   x' =  x cos + z sin + offsetX
//                         z' = -x sin + z cos + offsetZ
//   slice plane (x, y) = (x_arkit, -z_arkit)  [what studio GeoJSON / slicemaps use]:
//                         [x', y'] = R(yaw) [x, y] + [offsetX, -offsetZ],  R = [[c,-s],[s,c]]

export const ALIGNMENT_FORMAT = 'scan-group-alignment-v1';

export function applyXZ({ offsetX, offsetZ, yawRadians }, x, z) {
  const c = Math.cos(yawRadians), s = Math.sin(yawRadians);
  return [x * c + z * s + offsetX, -x * s + z * c + offsetZ];
}

export function inverseXZ({ offsetX, offsetZ, yawRadians }, x, z) {
  const dx = x - offsetX, dz = z - offsetZ;
  const c = Math.cos(yawRadians), s = Math.sin(yawRadians);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** slice-plane form: same transform on (x, y) = (x_arkit, -z_arkit) points. */
export function applyXY({ offsetX, offsetZ, yawRadians }, x, y) {
  const c = Math.cos(yawRadians), s = Math.sin(yawRadians);
  return [c * x - s * y + offsetX, s * x + c * y - offsetZ];
}

/** Parse a scan-group-alignment-v1 document. Returns { reference, group, alignments: {scanId: {...}} }.
 *  The reference scan is identity and is not listed in `alignments`. */
export function parseGroupAlignment(doc) {
  if (!doc || doc.format !== ALIGNMENT_FORMAT) throw new Error(`not a ${ALIGNMENT_FORMAT} document`);
  if (typeof doc.reference !== 'string' || !doc.reference) throw new Error('reference missing');
  const alignments = {};
  for (const [id, a] of Object.entries(doc.alignments ?? {})) {
    for (const k of ['offsetX', 'offsetZ', 'yawRadians']) {
      if (typeof a?.[k] !== 'number' || !Number.isFinite(a[k])) throw new Error(`alignments.${id}.${k} is not a finite number`);
    }
    alignments[id] = { offsetX: a.offsetX, offsetZ: a.offsetZ, yawRadians: a.yawRadians, method: a.method ?? 'unknown' };
  }
  return { reference: doc.reference, group: doc.group ?? null, alignments };
}

export const IDENTITY = { offsetX: 0, offsetZ: 0, yawRadians: 0, method: 'reference' };

/** Alignment for one scan of a parsed group (reference -> identity, unknown -> throws). */
export function alignmentFor(parsed, scanId) {
  if (scanId === parsed.reference) return IDENTITY;
  const a = parsed.alignments[scanId];
  if (!a) throw new Error(`scan ${scanId} is not in the alignment file (reference ${parsed.reference}, scans: ${Object.keys(parsed.alignments).join(', ')})`);
  return a;
}

/** Transform every coordinate of a GeoJSON geometry/feature/collection (slice plane) in place-copy. */
export function transformGeoJSON(node, alignment) {
  const isCoord = (v) => Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
  const walk = (v) => {
    if (isCoord(v)) { const [x, y] = applyXY(alignment, v[0], v[1]); return [x, y, ...v.slice(2)]; }
    if (Array.isArray(v)) return v.map(walk);
    return v;
  };
  if (node.type === 'FeatureCollection') return { ...node, features: node.features.map((f) => transformGeoJSON(f, alignment)) };
  if (node.type === 'Feature') return { ...node, geometry: node.geometry ? transformGeoJSON(node.geometry, alignment) : node.geometry };
  if (node.type === 'GeometryCollection') return { ...node, geometries: node.geometries.map((g) => transformGeoJSON(g, alignment)) };
  return { ...node, coordinates: walk(node.coordinates) };
}
