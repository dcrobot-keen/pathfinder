import { RibbonTools } from 's2m-ui';

export function Default() {
  return (
    <RibbonTools
      tools={[
        { icon: '▦', label: '래스터화' },
        { icon: '⌗', label: '정합' },
        { icon: '◧', label: '분류' },
        { icon: '▱', label: '벡터화' },
      ]}
    />
  );
}

export function WithDisabled() {
  return (
    <RibbonTools
      tools={[
        { icon: '▦', label: '래스터화' },
        { icon: '⌗', label: '정합', disabled: true },
        { icon: '◧', label: '분류', disabled: true },
        { icon: '▤', label: '단면(예정)', disabled: true },
      ]}
    />
  );
}
