/**
 * 3D world palette (COLORS.md section 6). The only place the scene's colours live.
 * Day is the page default; night is the cinema look. People, arcs and lights use the
 * meaning colours; bloom stays subtle.
 */
import type { OutcomeKind } from "@/lib/world";

export type ScenePalette = {
  mode: "day" | "night";
  sky: string;
  skyTop: string;
  fogNear: number;
  fogFar: number;
  ground: string;
  hood: string;
  hoodRing: string;
  road: string;
  roadLine: string;
  lane: string;
  lamp: string;
  walls: string[];
  roofs: string[];
  window: string;
  windowOff: string;
  shop: string;
  awning: string[];
  trees: string[];
  plaza: string;
  plazaRing: string;
  courtStone: string[]; // plinth, step, hall, columns, entablature
  dome: string;
  domeEmissive: number;
  beam: string;
  courtLight: string;
  relationship: string;
  relationshipOpacity: number;
  /** people states: calm, in dispute, in court, resolved */
  person: [string, string, string, string];
  advocate: string;
  outcome: Record<OutcomeKind, string>;
  arcDispute: string;
  arcCourt: string;
  arcResolved: string;
  filing: string;
  halo: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sun: string;
  sunIntensity: number;
  ambient: number;
  stars: boolean;
  /** additive blending only reads on a dark sky */
  additive: boolean;
  /** HDR boost for things that should catch the bloom (1 = none) */
  glow: number;
  bloom: { intensity: number; threshold: number };
  vignette: number;
};

const OUTCOME_DAY: Record<OutcomeKind, string> = {
  substantive: "#10B77F", adjourned: "#F59F0A", not_reached: "#C678DD", not_ready: "#274754",
};
const OUTCOME_NIGHT: Record<OutcomeKind, string> = {
  substantive: "#36D399", adjourned: "#FAB338", not_reached: "#C678DD", not_ready: "#7AA6B8",
};

export const DAY: ScenePalette = {
  mode: "day",
  sky: "#F0F6FF", skyTop: "#DCEBFE", fogNear: 120, fogFar: 320,
  ground: "#F3F4F6", hood: "#FFFFFF", hoodRing: "#E1E7EF",
  road: "#E1E7EF", roadLine: "#FFFFFF", lane: "#E1E7EF", lamp: "#DCEBFE",
  walls: ["#FFFFFF", "#F9FAFB", "#F1F5F9"], roofs: ["#E1E7EF", "#CBD5E1", "#DCEBFE"],
  window: "#DCEBFE", windowOff: "#E1E7EF",
  shop: "#F9FAFB", awning: ["#2463EB", "#DCEBFE", "#91C3FD"],
  trees: ["#A7D8C2", "#BFE3D2"],
  plaza: "#FFFFFF", plazaRing: "#2463EB",
  courtStone: ["#E1E7EF", "#F1F5F9", "#F9FAFB", "#FFFFFF", "#F1F5F9"],
  dome: "#2463EB", domeEmissive: 0.15, beam: "#3C83F6", courtLight: "#FFFFFF",
  relationship: "#94A3B8", relationshipOpacity: 0.22,
  person: ["#94A3B8", "#DB2777", "#4338CA", "#0E7490"],
  advocate: "#111827",
  outcome: OUTCOME_DAY,
  arcDispute: "#DB2777", arcCourt: "#4338CA", arcResolved: "#0E7490",
  filing: "#3C83F6", halo: "#2463EB",
  hemiSky: "#FFFFFF", hemiGround: "#E1E7EF", hemiIntensity: 1.4,
  sun: "#FFFFFF", sunIntensity: 1.8, ambient: 0.35,
  stars: false, additive: false, glow: 1,
  bloom: { intensity: 0.25, threshold: 0.95 }, vignette: 0.25,
};

export const NIGHT: ScenePalette = {
  mode: "night",
  sky: "#030711", skyTop: "#172554", fogNear: 90, fogFar: 260,
  ground: "#080C16", hood: "#0B1120", hoodRing: "#222F44",
  road: "#1A2333", roadLine: "#3C83F6", lane: "#1A2333", lamp: "#BEDBFE",
  walls: ["#222F44", "#26344B", "#1F2B3F"], roofs: ["#384252", "#323C4C", "#3D4859"],
  window: "#BEDBFE", windowOff: "#1A2333",
  shop: "#222F44", awning: ["#3C83F6", "#61A6FA", "#BEDBFE"],
  trees: ["#12352C", "#163A3F"],
  plaza: "#1A2333", plazaRing: "#3C83F6",
  courtStone: ["#CBD5E1", "#E1E7EF", "#F1F5F9", "#F9FAFB", "#E1E7EF"],
  dome: "#3C83F6", domeEmissive: 0.6, beam: "#3C83F6", courtLight: "#BEDBFE",
  relationship: "#61A6FA", relationshipOpacity: 0.12,
  person: ["#94A3B8", "#F472B6", "#818CF8", "#22D3EE"],
  advocate: "#F9FAFB",
  outcome: OUTCOME_NIGHT,
  arcDispute: "#F472B6", arcCourt: "#818CF8", arcResolved: "#22D3EE",
  filing: "#61A6FA", halo: "#61A6FA",
  hemiSky: "#61A6FA", hemiGround: "#030711", hemiIntensity: 0.8,
  sun: "#BEDBFE", sunIntensity: 1.3, ambient: 0.2,
  stars: true, additive: true, glow: 1.6,
  bloom: { intensity: 0.6, threshold: 0.85 }, vignette: 0.6,
};
