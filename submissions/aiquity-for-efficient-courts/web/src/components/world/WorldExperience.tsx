"use client";

/**
 * /world: "A town, a dispute, a court". Loads the world export, runs the playback clock,
 * and layers the HUD (funnel, scrubber, story card, captions) over the 3D town.
 */
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Clapperboard, CloudRain, Crosshair, Moon, Sun, Users, Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward, Tag, Footprints, IndianRupee,
} from "lucide-react";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  OUTCOME_COLOR, OUTCOME_LABEL, STATE_LABEL, fmtDate, fmtMoney, loadWorld, pickDirectorDispute,
  isHearingType, STEP_LABEL, pretty, type World,
} from "@/lib/world";
import { WorldClock, PHASE } from "./clock";
import { DAY, NIGHT } from "./palette";
import { StoryCard } from "./StoryCard";
import { IconButton, Num, Panel } from "./ui";
import Fallback2D from "./Fallback2D";
import PopulationFunnel from "./PopulationFunnel";
import ColorLegend from "./ColorLegend";
import PersonCard, { type AiPrompts } from "./PersonCard";
import { loadAgents, type AgentsData } from "@/lib/people";
import TownChanges, { useTownScenarios } from "./TownChanges";

const TownScene = dynamic(() => import("./TownScene"), {
  ssr: false,
  loading: () => <StageMessage text="Building the town" />,
});

function StageMessage({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-[var(--text-muted,var(--muted,#65758B))]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--primary,#2463EB)]" />
        {text}
      </div>
    </div>
  );
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const SPEEDS = [1, 4, 16];

type Caption = { key: string; kicker: string; text: string; color: string };

function dayCaption(world: World, day: number): Caption | null {
  const d = world.days[day];
  if (!d) return null;
  const rank = (t: string) => ["judgement", "settled_in_court", "complaint_filed", "settled_pre_court", "legal_notice", "quarrel"].indexOf(t);
  const pick = [...d.events].filter((e) => rank(e.type) >= 0 && e.text).sort((a, b) => rank(a.type) - rank(b.type))[0];
  const n = d.hearings.length;
  const moved = d.hearings.filter((h) => h.outcome === "substantive").length;
  const kicker = n ? `${n} hearing${n > 1 ? "s" : ""} today · ${moved} moved forward · ${n - moved} did not` : "No town hearings today";
  if (!pick) return { key: `d${day}`, kicker, text: `${d.quarrels.length} new quarrel${d.quarrels.length === 1 ? "" : "s"} across town.`, color: "var(--text-muted,var(--muted,#65758B))" };
  const color = pick.type === "judgement" ? "var(--c-substantive,#10B77F)" : pick.type === "complaint_filed" ? "var(--primary,#2463EB)" : pick.type === "quarrel" ? "var(--c-adjourned,#F59F0A)" : "var(--text)";
  return { key: `d${day}-${pick.type}`, kicker, text: pick.text ?? "", color };
}

export default function WorldExperience({ scenario }: { scenario?: string }) {
  const reduced = useReducedMotion() ?? false;
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock] = useState(() => new WorldClock(1));
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [agentsData, setAgentsData] = useState<AgentsData | null>(null);
  const [prompts, setPrompts] = useState<AiPrompts | null>(null);
  const [selected, setSelected] = useState(-1);
  const [person, setPerson] = useState(-1);
  const [director, setDirector] = useState(false);
  const [cinema, setCinema] = useState(false);
  const [night, setNight] = useState(false);
  const [showFunnel, setShowFunnel] = useState(false);
  const [showTown, setShowTown] = useState(false);
  const townScenarios = useTownScenarios();
  const [labels, setLabels] = useState(true);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [finale, setFinale] = useState(false);
  const [directorEnd, setDirectorEnd] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<HTMLDivElement>(null);
  const [ctrlH, setCtrlH] = useState(130);
  const directorRef = useRef({ on: false, dispute: -1, endDay: 0 });
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState(-1);

  useEffect(() => {
    let alive = true;
    loadWorld(scenario).then((w) => { if (alive) setWorld(w); }).catch((e: unknown) => { if (alive) setError(String(e)); });
    loadAgents("100_combined").then((a) => { if (alive && !a.mock) setAgentsData(a); }).catch(() => {});
    fetch("/data/ai_prompts.json").then((r) => (r.ok ? r.json() : null)).then((j: AiPrompts | null) => { if (alive) setPrompts(j); }).catch(() => {});
    const ok = hasWebGL();
    queueMicrotask(() => { if (alive) setWebgl(ok); });
    return () => { alive = false; };
  }, [scenario]);

  useEffect(() => { clock.setReducedMotion(reduced); }, [clock, reduced]);

  // keep the key above the controls, whatever height they wrap to
  useEffect(() => {
    const el = ctrlRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setCtrlH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [world]);

  useEffect(() => {
    if (!world) return;
    clock.setDays(world.days.length);
    if (!reduced) { clock.setPlaying(true); queueMicrotask(() => setPlaying(true)); }
  }, [world, clock, reduced]);

  // ----- director: slow on the story's beats, fast between them, camera on the right subject
  const directorBeats = useMemo(() => {
    if (!world || selected < 0) return new Map<number, string[]>();
    const m = new Map<number, string[]>();
    for (const s of world.disputes[selected]?.steps ?? []) {
      if (s.dayIdx < 0 || s.dayIdx >= world.days.length) continue;
      m.set(s.dayIdx, [...(m.get(s.dayIdx) ?? []), s.type]);
    }
    return m;
  }, [world, selected]);

  const directorTick = useCallback(() => {
    const dr = directorRef.current;
    if (!dr.on || !world) return;
    const di = clock.day, p = clock.phase;
    const beats = directorBeats.get(di);
    const dsp = world.disputes[dr.dispute];
    if (!dsp) return;
    if (di > dr.endDay) {
      clock.setFocus({ kind: "overview" });
      clock.setRate(1);
      if (di > dr.endDay + 1) {
        dr.on = false;
        clock.setPlaying(false);
        setPlaying(false);
        setDirector(false);
        setFinale(true);
      }
      return;
    }
    if (!beats) {
      clock.setRate(16 / clock.speed);
      clock.setFocus({ kind: "dispute", idx: dr.dispute, dist: 34 });
      return;
    }
    clock.setRate(0.85 / clock.speed);
    const hearing = beats.some(isHearingType);
    const filed = beats.some((t) => t === "complaint_filed" || t === "filed");
    if (hearing) {
      if (p < PHASE.leave) clock.setFocus({ kind: "dispute", idx: dr.dispute, dist: 18 });
      else if (p < PHASE.arrive) clock.setFocus({ kind: "person", idx: dsp.a, dist: 14 });
      else if (p < PHASE.depart + 0.1) clock.setFocus({ kind: "court", dist: 24 });
      else clock.setFocus({ kind: "dispute", idx: dr.dispute, dist: 22 });
    } else if (filed) {
      clock.setFocus(p < 0.1 ? { kind: "person", idx: dsp.a, dist: 14 } : { kind: "court", dist: 58 });
    } else {
      clock.setFocus({ kind: "dispute", idx: dr.dispute, dist: 15 });
    }
  }, [world, clock, directorBeats]);

  // ----- the one animation loop for the HUD + clock (the 3D scene has its own frame loop)
  useEffect(() => {
    if (!world) return;
    let raf = 0, last = performance.now(), lastDay = -1, hoverSeen = -1;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      directorTick();
      if (clock.advance(dt)) setPlaying(false);
      const d = clock.day;
      if (d !== lastDay) { lastDay = d; setDay(d); }
      if (clock.hoverPerson !== hoverSeen) { hoverSeen = clock.hoverPerson; setTip(hoverSeen); }
      if (playheadRef.current) playheadRef.current.style.left = `${(clock.t / Math.max(1, world.days.length)) * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, clock, directorTick]);

  const select = useCallback((dispute: number, p: number, fly = true) => {
    setSelected(dispute);
    setPerson(p);
    clock.select(dispute, p);
    if (!fly) return;
    if (dispute >= 0) clock.setFocus({ kind: "dispute", idx: dispute });
    else if (p >= 0) clock.setFocus({ kind: "person", idx: p });
  }, [clock]);

  const stopDirector = useCallback(() => {
    directorRef.current.on = false;
    clock.setRate(1);
    setDirector(false);
  }, [clock]);

  const onPickPerson = useCallback((i: number) => {
    if (!world) return;
    stopDirector();
    const list = world.disputesOf[i] ?? [];
    const d = clock.day;
    const active = list.filter((k) => world.disputes[k].startDay <= d && (world.disputes[k].endDay == null || world.disputes[k].endDay! >= d));
    const best = (active.length ? active : list).slice().sort((x, y) => world.disputes[y].hearings - world.disputes[x].hearings)[0] ?? -1;
    select(best, i);
  }, [world, clock, select, stopDirector]);

  const onPickDispute = useCallback((k: number) => { stopDirector(); select(k, -1); }, [select, stopDirector]);

  const togglePlay = useCallback(() => {
    if (clock.t >= clock.maxT - 0.01) clock.seek(0);
    const v = !clock.playing;
    clock.setPlaying(v);
    setPlaying(v);
    setFinale(false);
  }, [clock]);

  const setSpeedTo = useCallback((s: number) => { clock.setSpeed(s); setSpeed(s); }, [clock]);

  const seekDay = useCallback((d: number) => {
    if (!world) return;
    clock.seek(Math.max(0, Math.min(world.days.length - 1, d)) + (clock.playing ? 0 : 0.55));
    setDay(clock.day);
  }, [world, clock]);

  const startDirector = useCallback(() => {
    if (!world) return;
    const k = pickDirectorDispute(world);
    if (k < 0) return;
    const d = world.disputes[k];
    const beatDays = d.steps.map((s) => s.dayIdx).filter((x) => x >= 0 && x < world.days.length);
    directorRef.current = { on: true, dispute: k, endDay: Math.max(...beatDays, d.startDay) };
    setDirectorEnd(directorRef.current.endDay);
    select(k, -1, false);
    clock.seek(Math.max(0, Math.min(...beatDays, Math.max(0, d.startDay))) - 0.02);
    clock.setFocus({ kind: "dispute", idx: k, dist: 30 });
    clock.setPlaying(true);
    setPlaying(true);
    setDirector(true);
    setFinale(false);
    setLabels(false);
  }, [world, clock, select]);

  const toggleCinema = useCallback(() => {
    setCinema((c) => {
      const next = !c;
      setNight(next);
      try {
        if (next && stageRef.current?.requestFullscreen && !document.fullscreenElement) void stageRef.current.requestFullscreen().catch(() => {});
        if (!next && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      } catch { /* fullscreen is optional */ }
      return next;
    });
  }, []);

  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setCinema(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") seekDay(clock.day + 1);
      else if (e.key === "ArrowLeft") seekDay(clock.day - 1);
      else if (e.key.toLowerCase() === "c") toggleCinema();
      else if (e.key.toLowerCase() === "n") setNight((v) => !v);
      else if (e.key.toLowerCase() === "d") { if (director) stopDirector(); else startDirector(); }
      else if (e.key === "Escape") { if (cinema) toggleCinema(); else select(-1, -1, false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekDay, toggleCinema, startDirector, stopDirector, director, cinema, clock, select]);

  const caption = useMemo<Caption | null>(() => {
    if (!world) return null;
    if (director && selected >= 0) {
      const d = world.disputes[selected];
      const steps = d.steps.filter((s) => s.dayIdx === day);
      if (steps.length) {
        const s = steps.find((x) => isHearingType(x.type)) ?? steps[steps.length - 1];
        const kicker = isHearingType(s.type) && s.outcome ? `Hearing · ${OUTCOME_LABEL[s.outcome]}` : STEP_LABEL[s.type] ?? pretty(s.type);
        return { key: `s${selected}-${day}`, kicker, text: s.text, color: s.outcome ? OUTCOME_COLOR[s.outcome] : s.type === "quarrel" ? "var(--c-adjourned,#F59F0A)" : "var(--primary,#2463EB)" };
      }
      if (day > directorEnd) {
        const last = world.days[world.days.length - 1];
        return { key: "end", kicker: "The whole town", text: `${last.funnel[0].value} disputes, ${last.funnel[2].value} reached court, ${Math.round(last.tripsCum).toLocaleString("en-IN")} trips to court and ${fmtMoney(last.wagesCum)} in wages lost.`, color: "var(--primary,#2463EB)" };
      }
      const started = d.steps.some((x) => x.dayIdx >= 0 && x.dayIdx < day);
      if (!started) {
        const who = world.people[d.a];
        return { key: `pre${selected}`, kicker: who?.neighbourhood ?? "The town", text: `An ordinary morning. ${who?.name ?? "A resident"} has lent money to a neighbour.`, color: "var(--text-muted,var(--muted,#65758B))" };
      }
      return { key: `gap${selected}-${day}`, kicker: `${a(world, selected)} is waiting`, text: "Between dates, life goes on. The case waits for its next listing.", color: "var(--text-muted,var(--muted,#65758B))" };
    }
    return dayCaption(world, day);
  }, [world, director, selected, day, directorEnd]);

  if (error) return <div className="flex h-dvh items-center justify-center bg-[var(--bg,var(--surface))] text-sm text-[var(--c-adjourned,#F59F0A)]">Could not load the world: {error}</div>;

  const dm = world?.days[day];
  const showSide = !cinema && (selected >= 0 || person >= 0);

  return (
    <div
      ref={stageRef}
      onPointerMove={(e) => { const t = tipRef.current; if (t) t.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`; }}
      className={clsx(
        "overflow-hidden bg-[var(--bg,var(--surface))] text-[var(--text)] selection:bg-[var(--primary,#2463EB)]/30",
        cinema ? "fixed inset-0 z-[90]" : "relative h-[calc(100dvh-5rem)] min-h-[600px] w-full rounded-xl border border-[var(--border,var(--line,#E1E7EF))]",
      )}
    >
      {/* stage */}
      <div className="absolute inset-0">
        {!world || webgl === null ? (
          <StageMessage text="Loading the town" />
        ) : webgl ? (
          <SceneBoundary fallback={<Fallback2D world={world} day={day} selected={selected} onPickPerson={onPickPerson} />}>
            <TownScene
              world={world}
              clock={clock}
              day={day}
              onPickPerson={onPickPerson}
              onPickDispute={onPickDispute}
              onUserCamera={() => { if (directorRef.current.on) stopDirector(); clock.setFocus(null); }}
              showLabels={labels && !cinema}
              palette={night ? NIGHT : DAY}
              labels={labelRefs}
            />
          </SceneBoundary>
        ) : (
          <Fallback2D world={world} day={day} selected={selected} onPickPerson={onPickPerson} />
        )}
      </div>

      {/* place labels, positioned by the scene every frame */}
      {world && webgl && labels && !cinema && (
        <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden>
          {[...world.hoods.map((h) => h.name), world.court.name].map((n, i) => (
            <div key={n + i} ref={(el) => { labelRefs.current[i] = el; }}
              className={clsx("absolute left-0 top-0 whitespace-nowrap text-[10px] font-semibold uppercase rounded-full bg-[var(--bg,var(--surface))]/85 px-2 py-0.5",
                i === world.hoods.length ? "tracking-[0.32em] text-[var(--primary,#2463EB)]" : "tracking-[0.28em] text-[var(--text)]/70")}>
              {n}
            </div>
          ))}
        </div>
      )}
      {/* hover tooltip */}
      <div
        ref={tipRef}
        className={clsx("pointer-events-none fixed z-40 rounded-md border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--bg,var(--surface))]/90 px-2.5 py-1.5 text-[11px] shadow-xl  transition-opacity", tip >= 0 && world ? "opacity-100" : "opacity-0")}
        style={{ left: 0, top: 0 }}
      >
        {tip >= 0 && world?.people[tip] && (
          <>
            <div className="font-semibold text-[var(--text)]">{world.people[tip].name}</div>
            <div className="text-[var(--text-muted,var(--muted,#65758B))]">{world.people[tip].occupation} · {world.people[tip].neighbourhood} · {STATE_LABEL[dm?.states[tip] ?? 0]}</div>
          </>
        )}
      </div>

      {/* top-left: title + date */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 sm:left-6 sm:top-5">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}
          className="rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)]/90 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--primary,#2463EB)]">A town, a dispute, a court</div>
          <div className="mt-1 flex items-baseline gap-3">
            {/* keyed fade-in only: an exit animation can leave a stale date on screen at 16x */}
            <motion.div
              key={dm?.date ?? "x"}
              initial={{ opacity: 0.2, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              {dm ? fmtDate(dm.date, { weekday: "short", day: "numeric", month: "short" }) : "--"}
            </motion.div>
            {world && <div className="font-mono text-xs text-[var(--text-muted,var(--muted,#65758B))]">day {day + 1} / {world.days.length}</div>}
          </div>
          {world && !cinema && (
            <div className="mt-1 text-xs text-[var(--text-muted,var(--muted,#65758B))]">
              {world.people.length} residents · {world.disputes.length} disputes · {dm?.listed ?? 0} on today&apos;s causelist
              {world.source !== "engine" && <span className="ml-2 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--primary-strong,#1E3B8A)]">sample data</span>}
            </div>
          )}
        </motion.div>
      </div>

      {/* top-right: funnel */}
      {world && dm && (
        <div className={clsx("pointer-events-none absolute left-4 top-[148px] z-10 sm:left-6 xl:left-auto xl:right-6 xl:top-5", showSide && "xl:right-[404px]", cinema && "hidden sm:block")}>
          <Panel className="pointer-events-auto px-4 py-3">
            <div className="flex items-stretch gap-1">
              {dm.funnel.map((f, i) => (
                <div key={f.key} className="flex items-center">
                  {i > 0 && <div className="mx-1.5 h-px w-3 bg-[var(--border,var(--line,#E1E7EF))]" />}
                  <div className="min-w-[58px] text-center">
                    <Num value={f.value} className="block font-mono text-xl font-semibold" />
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted,var(--muted,#65758B))]">{f.label}</div>
                    <div className="mx-auto mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: ["var(--c-adjourned,#F59F0A)", "var(--c-adjourned,#F59F0A)", "var(--primary,#2463EB)", "var(--primary,#2463EB)", "var(--c-substantive,#10B77F)"][i] }}
                        animate={{ width: `${Math.min(100, (f.value / Math.max(1, dm.funnel[0].value)) * 100)}%` }}
                        transition={{ duration: 0.6 }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-4 border-t border-[var(--border,var(--line,#E1E7EF))]/70 pt-2.5 text-xs">
              <span className="flex items-center gap-1.5 text-[var(--text-muted,var(--muted,#65758B))]"><Footprints size={13} /> Trips to court <Num value={dm.tripsCum} className="font-mono text-[var(--text)]" /></span>
              <span className="flex items-center gap-1.5 text-[var(--text-muted,var(--muted,#65758B))]"><IndianRupee size={13} /> Wages lost <Num value={dm.wagesCum} className="font-mono text-[var(--c-adjourned,#F59F0A)]" /></span>
            </div>
          </Panel>
        </div>
      )}

      {/* legend */}
      {world && (
        <div className="pointer-events-none absolute left-4 z-[25] sm:left-6" style={{ bottom: ctrlH + 12 }}>
          <ColorLegend key={cinema ? "cinema" : "page"} storageKey={cinema ? "world.key.open.cinema" : "world.key.open"} defaultOpen={!cinema}
            row={cinema || director}
            className={cinema || director ? "w-[min(900px,calc(100vw-2rem))]" : "w-[min(340px,calc(100vw-2rem))]"}
            maxHeight={`max(120px, calc(100dvh - ${ctrlH + (cinema ? 200 : 330)}px))`} />
        </div>
      )}

      {/* story card */}
      <AnimatePresence>
        {world && showSide && (
          <motion.aside
            key="story"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="absolute bottom-[150px] right-4 top-4 z-20 w-[min(380px,calc(100%-2rem))] sm:right-6 sm:top-5"
          >
            <StoryCard world={world} disputeIdx={selected} personIdx={person} day={day}
              personSlot={person >= 0 ? <PersonCard world={world} personIdx={person} day={day} prompts={prompts} agent={agentsData?.agents.find((g) => g.id === world.people[person]?.id) ?? null} /> : null} onClose={() => { stopDirector(); select(-1, -1, false); clock.setFocus({ kind: "overview" }); }} onJump={(d) => seekDay(d)} />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* captions */}
      <div className={clsx("pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4", cinema ? "bottom-10" : "bottom-[170px]", showSide && "xl:pr-[420px]")}>
        <AnimatePresence mode="wait">
          {caption && (cinema || director) && (
            <motion.div
              key={caption.key}
              initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
              transition={{ duration: 0.45 }}
              className="max-w-2xl rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)]/95 px-5 py-3 text-center shadow-[0_1px_2px_rgba(17,24,39,.06),0_8px_24px_rgba(17,24,39,.06)]"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: caption.color }}>{caption.kicker}</div>
              <div className="mt-2 text-balance text-lg font-medium leading-snug text-[var(--text)] sm:text-2xl">{caption.text}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* from population to court */}
      <AnimatePresence>
        {world?.population && showFunnel && !cinema && (
          <motion.aside key="funnel" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="absolute bottom-[150px] left-4 top-4 z-30 w-[min(380px,calc(100%-2rem))] sm:left-6">
            <PopulationFunnel funnel={world.population} onClose={() => setShowFunnel(false)} />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* when the town changes */}
      <AnimatePresence>
        {townScenarios && showTown && !cinema && (
          <motion.aside key="town" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-[150px] left-4 z-30 max-h-[calc(100%-170px)] w-[min(620px,calc(100%-2rem))] overflow-y-auto sm:left-6">
            <TownChanges data={townScenarios} onClose={() => setShowTown(false)} />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* finale card after the director run */}
      <AnimatePresence>
        {finale && world && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--bg,var(--surface))]/85"
            onClick={() => setFinale(false)}
          >
            <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} className="max-w-xl px-6 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--primary,#2463EB)]">One dispute among many</div>
              <div className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
                <Num value={world.days[world.days.length - 1].tripsCum} /> trips to court.
                <br />
                <span className="text-[var(--c-adjourned,#F59F0A)]">{fmtMoney(world.days[world.days.length - 1].wagesCum)}</span> in lost wages.
              </div>
              <p className="mt-4 text-sm text-[var(--text-muted,var(--muted,#65758B))]">A better causelist gives people a time, not a day, and lists a case only when it can move forward.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* controls + scrubber */}
      {world && (
        <div ref={ctrlRef} className={clsx("absolute inset-x-0 bottom-0 z-20 px-4 pb-4 transition-opacity duration-500 sm:px-6", cinema ? "opacity-0 hover:opacity-100" : "opacity-100")}>
          <Panel className="px-4 pb-3 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <IconButton title="Back one day" onClick={() => seekDay(day - 1)}><SkipBack size={15} /></IconButton>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary,#2463EB)] text-white transition-colors hover:bg-[var(--primary-hover,#3C83F6)]"
              >
                {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
              </button>
              <IconButton title="Forward one day" onClick={() => seekDay(day + 1)}><SkipForward size={15} /></IconButton>
              <div className="ml-1 flex rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)] p-0.5">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" onClick={() => setSpeedTo(s)}
                    className={clsx("h-8 rounded-lg px-2.5 font-mono text-xs transition-colors", speed === s ? "bg-[var(--primary,#2463EB)]/20 text-[var(--primary-strong,#1E3B8A)]" : "text-[var(--text-muted,var(--muted,#65758B))] hover:text-[var(--text)]")}>
                    {s}x
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <IconButton title="Director: follow one dispute end to end (D)" active={director} onClick={() => (director ? stopDirector() : startDirector())}>
                  <Clapperboard size={15} /> <span className="hidden sm:inline">Director</span>
                </IconButton>
                <IconButton title="Frame the whole town" onClick={() => { stopDirector(); clock.setFocus({ kind: "overview" }); }}>
                  <Crosshair size={15} /> <span className="hidden sm:inline">Overview</span>
                </IconButton>
                {world.population && (
                  <IconButton title="From population to court" active={showFunnel} onClick={() => { setShowFunnel((v) => !v); setShowTown(false); }}>
                    <Users size={15} /> <span className="hidden sm:inline">Population</span>
                  </IconButton>
                )}
                {townScenarios && (
                  <IconButton title="When the town changes, the court day changes" active={showTown} onClick={() => { setShowTown((v) => !v); setShowFunnel(false); }}>
                    <CloudRain size={15} /> <span className="hidden sm:inline">Town changes</span>
                  </IconButton>
                )}
                <IconButton title={night ? "Day (N)" : "Night (N)"} active={night} onClick={() => setNight((v) => !v)}>
                  {night ? <Sun size={15} /> : <Moon size={15} />}
                </IconButton>
                <IconButton title="Place labels" active={labels} onClick={() => setLabels((v) => !v)}><Tag size={15} /></IconButton>
                <IconButton title="Cinema mode (C)" active={cinema} onClick={toggleCinema}>
                  {cinema ? <Minimize2 size={15} /> : <Maximize2 size={15} />} <span className="hidden sm:inline">Cinema</span>
                </IconButton>
              </div>
            </div>
            <Scrubber world={world} selected={selected} onSeek={seekDay} playheadRef={playheadRef} />
          </Panel>
        </div>
      )}
    </div>
  );
}

function a(world: World, k: number) {
  return world.people[world.disputes[k]?.a]?.name ?? "The complainant";
}

function Scrubber({ world, selected, onSeek, playheadRef }: {
  world: World; selected: number; onSeek: (d: number) => void; playheadRef: React.RefObject<HTMLDivElement | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const n = world.days.length;
  const maxH = Math.max(1, ...world.days.map((d) => d.hearings.length));
  const beats = useMemo(() => {
    const d = world.disputes[selected];
    return d ? d.steps.filter((s) => s.dayIdx >= 0 && s.dayIdx < n) : [];
  }, [world, selected, n]);
  const seekAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return;
    onSeek(Math.floor(((clientX - r.left) / r.width) * n));
  };
  return (
    <div className="mt-3">
      <div
        ref={trackRef}
        className="relative h-10 cursor-pointer select-none touch-none"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); seekAt(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons === 1) seekAt(e.clientX); }}
        role="slider"
        aria-label="Simulation day"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={1}
        tabIndex={0}
      >
        <div className="absolute inset-x-0 bottom-0 top-0 flex items-end gap-px">
          {world.days.map((d, i) => {
            const sub = d.hearings.filter((h) => h.outcome === "substantive").length;
            const hgt = (d.hearings.length / maxH) * 100;
            return (
              <div key={d.date} className="relative flex-1" style={{ height: "100%" }}>
                <div className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-[var(--c-adjourned,#F59F0A)]/40" style={{ height: `${Math.max(6, hgt)}%` }} />
                <div className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-[var(--c-substantive,#10B77F)]/70" style={{ height: `${d.hearings.length ? (sub / maxH) * 100 : 0}%` }} />
                {i > 0 && d.date.slice(5, 7) !== world.days[i - 1].date.slice(5, 7) && (
                  <div className="absolute -top-0.5 left-0 font-mono text-[9px] uppercase text-[var(--text-muted,var(--muted,#65758B))]">{fmtDate(d.date, { month: "short" })}</div>
                )}
              </div>
            );
          })}
        </div>
        {beats.map((s, i) => (
          <div key={i} className="absolute top-3 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-[var(--surface)]"
            style={{ left: `${((s.dayIdx + 0.5) / n) * 100}%`, background: s.outcome ? OUTCOME_COLOR[s.outcome] : "var(--primary,#2463EB)" }} />
        ))}
        <div ref={playheadRef} className="pointer-events-none absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-[var(--primary,#2463EB)]">
          <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[var(--primary,#2463EB)]" />
        </div>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-muted,var(--muted,#65758B))]">
        <span>{fmtDate(world.days[0].date)}</span>
        <span className="hidden sm:inline">bars: hearings per day · green moved the case forward</span>
        <span>{fmtDate(world.days[n - 1].date)}</span>
      </div>
    </div>
  );
}
