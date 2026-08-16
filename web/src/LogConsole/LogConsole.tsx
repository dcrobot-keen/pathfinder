import './LogConsole.css';

export type LogLevel = 'default' | 'dim' | 'ok' | 'warn' | 'error';

export interface LogLine {
  text: string;
  level?: LogLevel;
}

export interface LogConsoleProps {
  lines: LogLine[];
}

/** Monospace scrolling log panel for the pipeline processing screen. */
export function LogConsole({ lines }: LogConsoleProps) {
  return (
    <div className="s2m-log">
      {lines.map((line, i) => (
        <div key={i} className={`s2m-log__line ${line.level && line.level !== 'default' ? `s2m-log__line--${line.level}` : ''}`}>
          {line.text}
        </div>
      ))}
    </div>
  );
}
