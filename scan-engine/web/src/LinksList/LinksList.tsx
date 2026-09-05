import './LinksList.css';

export interface LinkItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface LinksListProps {
  links: LinkItem[];
}

/** List of pipeline output file links (base_map.ply, map.pgm, output.geojson, …). */
export function LinksList({ links }: LinksListProps) {
  return (
    <div className="s2m-links">
      {links.map((link) => (
        <a key={link.label} href={link.href ?? '#'} onClick={link.onClick}>
          {link.label}
        </a>
      ))}
    </div>
  );
}
