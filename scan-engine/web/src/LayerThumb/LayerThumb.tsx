import type { ReactNode } from 'react';
import './LayerThumb.css';

export interface Layer {
  label: string;
  sublabel: string;
  thumbnail?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export interface LayerThumbListProps {
  title?: string;
  layers: Layer[];
}

/** Left-rail list of selectable map layer thumbnails (Occupancy / 컬러 top-down / 벡터 / 3D) for the report viewer. */
export function LayerThumbList({ title = '지도 레이어', layers }: LayerThumbListProps) {
  return (
    <div className="s2m-layers">
      <div className="s2m-layers__title">{title}</div>
      {layers.map((layer) => (
        <button
          key={layer.label}
          type="button"
          className={`s2m-layer ${layer.active ? 's2m-layer--active' : ''}`}
          onClick={layer.onClick}
        >
          <div className="s2m-layer__thumb">{layer.thumbnail}</div>
          <div className="s2m-layer__lbl">
            {layer.label}
            <small>{layer.sublabel}</small>
          </div>
        </button>
      ))}
    </div>
  );
}
