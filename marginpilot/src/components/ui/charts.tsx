/**
 * Small dependency-free SVG charts. Each chart has a text summary for screen
 * readers and a visible data table toggle via <details>, so values are never
 * only in the picture.
 */

type Point = { label: string; value: number };

export function BarChart({ title, data, format = (v) => String(v), height = 180 }: { title: string; data: Point[]; format?: (v: number) => string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 600;
  const pad = 28;
  const bw = data.length ? (w - pad) / data.length : 0;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <svg viewBox={`0 0 ${w} ${height + 24}`} className="h-auto w-full" role="img" aria-label={`${title}. ${data.length} points, total ${format(total)}.`}>
        <line x1={pad} y1={height} x2={w} y2={height} stroke="#DDE2DA" />
        <text x={0} y={12} fontSize="11" fill="#47554E">{format(max)}</text>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 16);
          return (
            <g key={d.label + i}>
              <rect x={pad + i * bw + bw * 0.15} y={height - h} width={bw * 0.7} height={h} fill="#0B6B45" rx="2">
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </rect>
              {(data.length <= 14 || i % Math.ceil(data.length / 7) === 0) && (
                <text x={pad + i * bw + bw / 2} y={height + 16} fontSize="11" fill="#47554E" textAnchor="middle">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-muted">Show data</summary>
        <table className="mt-2 w-full text-left">
          <tbody>
            {data.map((d, i) => (
              <tr key={d.label + i} className="border-b border-line">
                <th scope="row" className="py-1 font-normal">{d.label}</th>
                <td className="py-1 text-right tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function LineChart({ title, data, format = (v) => String(v), height = 180 }: { title: string; data: Point[]; format?: (v: number) => string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const w = 600;
  const pad = 28;
  const x = (i: number) => pad + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (w - pad - 8));
  const y = (v: number) => height - ((v - min) / (max - min || 1)) * (height - 16);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join(" ");
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <svg viewBox={`0 0 ${w} ${height + 24}`} className="h-auto w-full" role="img" aria-label={`${title}. Latest ${data.length ? format(data[data.length - 1].value) : "none"}.`}>
        <line x1={pad} y1={height} x2={w} y2={height} stroke="#DDE2DA" />
        <text x={0} y={12} fontSize="11" fill="#47554E">{format(max)}</text>
        <path d={path} fill="none" stroke="#0B6B45" strokeWidth="2" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r="3" fill="#0B6B45">
            <title>{`${d.label}: ${format(d.value)}`}</title>
          </circle>
        ))}
        {data.map((d, i) =>
          data.length <= 14 || i % Math.ceil(data.length / 7) === 0 ? (
            <text key={`l${i}`} x={x(i)} y={height + 16} fontSize="11" fill="#47554E" textAnchor="middle">{d.label}</text>
          ) : null,
        )}
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-muted">Show data</summary>
        <table className="mt-2 w-full text-left">
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-b border-line">
                <th scope="row" className="py-1 font-normal">{d.label}</th>
                <td className="py-1 text-right tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Horizontal usage meter, e.g. selling-limit or AI-credit usage. */
export function Meter({ label, used, max, format = (v) => v.toLocaleString() }: { label: string; used: number; max: number; format?: (v: number) => string }) {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-ink-muted">
          {format(used)} of {format(max)}
        </span>
      </div>
      <div className="mt-1 h-2 rounded bg-line" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
        <div className={`h-2 rounded ${ratio > 0.9 ? "bg-danger" : ratio > 0.75 ? "bg-amber" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
