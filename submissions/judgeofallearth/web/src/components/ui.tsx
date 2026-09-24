import Link from "next/link";

export function Card({ title, sub, children, className = "", right }: { title?: string; sub?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          {title && <h3 className="text-[15px] font-semibold text-fg">{title}</h3>}
          {right}
        </div>
      )}
      {sub && <p className="mb-3 mt-0.5 text-[13px] leading-relaxed text-mut">{sub}</p>}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-4">
      <div className="text-[26px] font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-[13px] text-mut">{label}</div>
      {hint && <div className="mt-1 text-[12px] text-mut">{hint}</div>}
    </div>
  );
}

type Tone = "acc" | "warn" | "bad" | "mut" | "blue";
const tones: Record<Tone, string> = {
  acc: "bg-acc/10 text-acc",
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  blue: "bg-blue/10 text-blue",
  mut: "bg-soft text-mut",
};

export function Tag({ tone = "mut", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-[2px] text-[12px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function AgeTag({ age }: { age: number }) {
  const tone: Tone = age >= 5 ? "bad" : age >= 4 ? "warn" : age >= 3 ? "blue" : "mut";
  return <Tag tone={tone}>{(Math.floor(age * 10) / 10).toFixed(1)} yr</Tag>;
}

export function CaseLink({ ws, idx, id }: { ws: string; idx: number; id: string }) {
  return (
    <Link className="font-medium text-acc hover:underline" href={`/w/${ws}/cases/${idx}`}>
      {id}
    </Link>
  );
}

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`border-b border-line px-2.5 py-2 text-left text-[12px] font-medium text-mut ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`border-b border-line/70 px-2.5 py-2.5 align-top ${className}`}>{children}</td>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-mut">{children}</p>;
}

export function Button({ kind = "secondary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "ghost" | "danger" }) {
  const k = {
    primary: "bg-acc text-white hover:bg-acc/90",
    secondary: "border border-line bg-card text-fg hover:border-acc/50",
    ghost: "text-mut hover:text-fg",
    danger: "border border-bad/30 bg-bad/5 text-bad hover:bg-bad/10",
  }[kind];
  return <button {...p} className={`rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${k} ${className}`} />;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-mut">{children}</p>;
}
