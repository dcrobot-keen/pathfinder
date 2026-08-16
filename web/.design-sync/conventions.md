## Setup

No provider or wrapper is required. Import the stylesheet once at the app root — `import 's2m-ui/styles.css'` — and every component works immediately; all styling comes from plain CSS custom properties on `:root`, not from React context or a theme object.

```tsx
import 's2m-ui/styles.css';
import { AppShell, Button, ProjectCard, NewProjectCard } from 's2m-ui';
```

## Styling idiom: design tokens, not utility classes

This is a dark, data-dense "studio" UI (LiDAR scan processing). Components consume CSS custom properties directly — build your own layout glue with the same tokens instead of hardcoded colors:

| Token | Use |
|---|---|
| `--bg` | page background |
| `--panel` / `--panel-2` / `--panel-3` | card/surface backgrounds, darkest → lightest is panel-3 → panel-2 (panel-3 is for consoles/canvases, panel-2 for inputs/secondary panels) |
| `--border` | all hairline borders |
| `--text` / `--text-dim` / `--text-faint` | primary / secondary / tertiary text, in that order |
| `--accent` (teal) / `--accent-2` (cyan) | primary brand accent / secondary accent (links, in-progress state) |
| `--success` / `--warn` / `--danger` | status greens/oranges/reds — used for badges, log lines, registration results |
| `--wall` / `--furniture` / `--traj` | domain-specific map-overlay colors (wall outlines, furniture fills, robot trajectory) — only relevant when building map/viewer screens |
| `--font-ui` | all UI text (Korean-first stack: system-ui → Malgun Gothic) |
| `--font-mono` | metadata, coordinates, log/console text, file sizes |

No `bg-*`/`text-*` utility classes exist — style with `var(--token)` in inline styles or your own CSS, matching the component source (`src/**/*.css` in the `s2m-ui` package) for spacing/radius conventions: card padding 16–18px, screen padding 20–28px, grid gap 16px, card/modal radius 12–14px, button/input radius 7–8px, pill radius 999px.

## Where the truth lives

- `dist/index.css` (bundled from every component's own `.css`) — the full token + component stylesheet; read this before styling anything new.
- `src/tokens.css` in the `s2m-ui` package — the token source of just the `:root` custom properties, if you only need the palette.
- Per-component docs: `<Name>.prompt.md` next to each component in this project.

## Build snippet

```tsx
<AppShell
  headerAction={<Button variant="primary">+ 새 프로젝트</Button>}
  navItems={[
    { icon: '▦', label: '프로젝트', active: true },
    { icon: '◧', label: '리포트 & 뷰어' },
  ]}
>
  <div style={{ padding: 28, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
    <ProjectCard
      title="officescan"
      meta="office.usdz · 20×20m · 2026-08-12"
      status="done"
      stepsDone={6}
      statusNote="6/6 단계 · 정합 RMSE 3.1cm"
      footerStat="벽 7 · 가구 44"
      actionLabel="리포트 열기 →"
    />
    <NewProjectCard />
  </div>
</AppShell>
```

23 components now cover the full scan-to-map-studio web UI: the project dashboard (`AppShell`, `Button`, `ProjectCard`, `NewProjectCard`), the new-project wizard (`Modal`, `StepIndicator`, `Dropzone`, `FilePill`), the pipeline processing screen (`ScreenHeader`, `Ribbon`, `RibbonTools`, `StepRail`, `LogConsole`, `ProgressPill`, `ParamSlider`), and the report/viewer screen (`LayerThumbList`, `ToggleLegend`, `Timeline`, `SidePanel`, `SidePanelSection`, `StatGrid`, `RegistrationSummary`, `LinksList`). Compose new screens from these rather than inventing raw HTML/CSS equivalents.
