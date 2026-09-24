"use client";

/**
 * The 3D town: low-poly homes, shops, roads and a court at the centre; people as glowing
 * capsules that walk to court on their hearing days; relationship threads, dispute arcs,
 * filing lights and outcome pulses. Everything that moves reads the shared clock inside
 * the r3f frame loop, so React only re-renders when the day changes.
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import { type OutcomeKind, type World } from "@/lib/world";
import { DAY, type ScenePalette } from "./palette";
import { PHASE, smooth, type WorldClock } from "./clock";

const S = 0.12; // world units per plane unit
const PalCtx = createContext<ScenePalette>(DAY);
const usePal = () => useContext(PalCtx);
/** colour boosted into bloom range at night, plain by day */
const glowC = (pal: ScenePalette, hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(pal.mode === "night" ? pal.glow * k : 1);
const blendOf = (pal: ScenePalette) => (pal.additive ? THREE.AdditiveBlending : THREE.NormalBlending);

export type LabelRefs = { current: (HTMLDivElement | null)[] };

type Props = {
  world: World;
  palette: ScenePalette;
  labels: LabelRefs;
  clock: WorldClock;
  day: number;
  onPickPerson: (idx: number) => void;
  onPickDispute: (idx: number) => void;
  onUserCamera: () => void;
  showLabels: boolean;
};

/** mark instanced buffers dirty (kept out of components so the frame loop stays lint-clean) */
function touch(m: THREE.InstancedMesh) {
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

/** per-person live positions, written by the people layer, read by camera + halos */
export class PosBuf {
  a: Float32Array;
  constructor(n: number) { this.a = new Float32Array(n * 3); }
  set(i: number, x: number, z: number) { this.a[i * 3] = x; this.a[i * 3 + 2] = z; }
  x(i: number) { return this.a[i * 3]; }
  z(i: number) { return this.a[i * 3 + 2]; }
}

// deterministic hash -> [0,1)
const h1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

type Geo = {
  /** plane point -> world (x,z), pushed out of the court plaza */
  pt: (x: number, y: number) => [number, number];
  wx: (x: number) => number;
  wz: (y: number) => number;
  home: Float32Array; // per person idle position (x,z)
  hood: Float32Array; // per person neighbourhood centre (x,z)
  gate: Float32Array; // per person court gate (x,z)
  advHome: Float32Array;
  advGate: Float32Array;
};

function useGeo(world: World): Geo {
  return useMemo(() => {
    const wx = (x: number) => (x - world.court.x) * S;
    const wz = (y: number) => -(y - world.court.y) * S;
    const pt = (x: number, y: number): [number, number] => {
      const X = wx(x), Z = wz(y), r = Math.hypot(X, Z);
      if (r >= 13) return [X, Z];
      const k = r < 0.01 ? 0 : (13 + (13 - r) * 0.35) / r;
      return r < 0.01 ? [13, 0] : [X * k, Z * k];
    };
    const n = world.people.length;
    const home = new Float32Array(n * 2), hood = new Float32Array(n * 2), gate = new Float32Array(n * 2);
    world.people.forEach((p, i) => {
      [home[i * 2], home[i * 2 + 1]] = pt(p.x, p.y);
      // stand in the yard, not inside the house
      home[i * 2] += Math.cos(i * 2.39996) * 1.35; home[i * 2 + 1] += Math.sin(i * 2.39996) * 1.35;
      const h = world.hoods[p.hood] ?? { x: world.court.x, y: world.court.y };
      hood[i * 2] = wx(h.x) + (h1(i) - 0.5) * 1.6; hood[i * 2 + 1] = wz(h.y) + (h1(i + 7) - 0.5) * 1.6;
      const ang = Math.atan2(wz(h.y), wx(h.x)) + (h1(i + 3) - 0.5) * 0.9;
      const r = 8.2 + h1(i + 11) * 2.2;
      gate[i * 2] = Math.cos(ang) * r; gate[i * 2 + 1] = Math.sin(ang) * r;
    });
    const m = world.advocates.length;
    const advHome = new Float32Array(m * 2), advGate = new Float32Array(m * 2);
    world.advocates.forEach((a, i) => {
      [advHome[i * 2], advHome[i * 2 + 1]] = pt(a.x, a.y);
      const ang = Math.atan2(advHome[i * 2 + 1], advHome[i * 2]) + (h1(i + 40) - 0.5) * 0.4;
      advGate[i * 2] = Math.cos(ang) * 6.6; advGate[i * 2 + 1] = Math.sin(ang) * 6.6;
    });
    return { pt, wx, wz, home, hood, gate, advHome, advGate };
  }, [world]);
}

// ------------------------------------------------------------------ static town

function Ground({ world, geo }: { world: World; geo: Geo }) {
  const pal = usePal();
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.02, 0]}>
        <circleGeometry args={[140, 72]} />
        <meshStandardMaterial color={pal.ground} roughness={1} />
      </mesh>
      {world.hoods.map((h) => (
        <group key={h.name} position={[geo.wx(h.x), 0, geo.wz(h.y)]}>
          <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, 0.005, 0]}>
            <circleGeometry args={[Math.max(8, h.radius * S * 0.62), 48]} />
            <meshStandardMaterial color={pal.hood} roughness={0.95} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
            <ringGeometry args={[Math.max(8, h.radius * S * 0.62) - 0.12, Math.max(8, h.radius * S * 0.62), 64]} />
            <meshBasicMaterial color={pal.hoodRing} transparent opacity={0.9} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Roads({ world, geo }: { world: World; geo: Geo }) {
  const pal = usePal();
  const { roads, lamps } = useMemo(() => {
    const roads: { x: number; z: number; len: number; rot: number }[] = [];
    const lamps: [number, number][] = [];
    for (const h of world.hoods) {
      const tx = geo.wx(h.x), tz = geo.wz(h.y);
      const len = Math.hypot(tx, tz);
      if (len < 1) continue;
      roads.push({ x: tx / 2, z: tz / 2, len, rot: Math.atan2(tx, tz) });
      const ux = tx / len, uz = tz / len;
      for (let d = 11; d < len - 2; d += 5.5) {
        lamps.push([ux * d - uz * 1.5, uz * d + ux * 1.5]);
        lamps.push([ux * d + uz * 1.5, uz * d - ux * 1.5]);
      }
    }
    return { roads, lamps };
  }, [world, geo]);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = lampRef.current;
    if (!m) return;
    const o = new THREE.Object3D();
    lamps.forEach(([x, z], i) => { o.position.set(x, 1.3, z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
  }, [lamps]);
  // lanes from each home to its neighbourhood centre
  const lanes = useMemo(() => {
    const pts: number[] = [];
    for (const hm of world.homes) {
      const h = world.hoods[hm.hood];
      if (!h) continue;
      const [hx, hz] = geo.pt(hm.x, hm.y);
      pts.push(hx, 0.03, hz, geo.wx(h.x), 0.03, geo.wz(h.y));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [world, geo]);
  return (
    <group>
      {roads.map((r, i) => (
        <group key={i} position={[r.x, 0.02, r.z]} rotation-y={r.rot}>
          <mesh receiveShadow>
            <boxGeometry args={[2.2, 0.04, r.len]} />
            <meshStandardMaterial color={pal.road} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.03, 0]}>
            <boxGeometry args={[0.08, 0.01, r.len - 2]} />
            <meshBasicMaterial color={pal.roadLine} transparent opacity={0.5} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <lineSegments geometry={lanes}>
        <lineBasicMaterial color={pal.lane} transparent opacity={0.9} />
      </lineSegments>
      <instancedMesh ref={lampRef} args={[undefined, undefined, Math.max(1, lamps.length)]} frustumCulled={false}>
        <sphereGeometry args={[0.13, 8, 8]} />
        <meshBasicMaterial color={glowC(pal, pal.lamp, 1.4)} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Buildings({ world, geo }: { world: World; geo: Geo }) {
  const pal = usePal();
  const homesRef = useRef<THREE.InstancedMesh>(null);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  const winRef = useRef<THREE.InstancedMesh>(null);
  const bizRef = useRef<THREE.InstancedMesh>(null);
  const awnRef = useRef<THREE.InstancedMesh>(null);
  const treeRef = useRef<THREE.InstancedMesh>(null);
  const nH = world.homes.length, nB = world.businesses.length;
  const trees = useMemo(() => {
    const out: [number, number, number][] = [];
    world.hoods.forEach((h, k) => {
      const R = Math.max(8, h.radius * S * 0.62);
      for (let i = 0; i < 26; i++) {
        const a = h1(k * 100 + i) * Math.PI * 2, r = R * (0.55 + 0.45 * h1(k * 100 + i + 50));
        out.push([geo.wx(h.x) + Math.cos(a) * r, geo.wz(h.y) + Math.sin(a) * r, 0.7 + h1(i + k) * 0.8]);
      }
    });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      out.push([Math.cos(a) * 10.4, Math.sin(a) * 10.4, 0.8]);
    }
    for (let i = 0; i < 90; i++) {
      const a = h1(i + 900) * Math.PI * 2, r = 55 + h1(i + 950) * 60;
      out.push([Math.cos(a) * r, Math.sin(a) * r, 0.9 + h1(i) * 1.2]);
    }
    return out;
  }, [world, geo]);

  useEffect(() => {
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    const walls = pal.walls;
    const roofs = pal.roofs;
    world.homes.forEach((hm, i) => {
      const w = 1.3 + Math.min(hm.size, 6) * 0.14, d = 1.2 + h1(i + 2) * 0.5, hgt = 1.0 + h1(i + 5) * 0.7;
      const [x, z] = geo.pt(hm.x, hm.y), rot = h1(i + 9) * Math.PI;
      o.position.set(x, hgt / 2, z); o.rotation.set(0, rot, 0); o.scale.set(w, hgt, d); o.updateMatrix();
      homesRef.current?.setMatrixAt(i, o.matrix);
      homesRef.current?.setColorAt(i, c.set(walls[i % walls.length]));
      o.position.set(x, hgt + 0.42, z); o.rotation.set(0, rot + Math.PI / 4, 0); o.scale.set(w * 0.8, 0.85, d * 0.8); o.updateMatrix();
      roofRef.current?.setMatrixAt(i, o.matrix);
      roofRef.current?.setColorAt(i, c.set(roofs[(i * 7) % roofs.length]));
      const lx = Math.sin(rot) * (d / 2 + 0.01), lz = Math.cos(rot) * (d / 2 + 0.01);
      o.position.set(x + lx, hgt * 0.45, z + lz); o.rotation.set(0, rot, 0); o.scale.set(1, 1, 1); o.updateMatrix();
      winRef.current?.setMatrixAt(i, o.matrix);
      const lit = h1(i + 77) > 0.25;
      winRef.current?.setColorAt(i, lit ? c.copy(glowC(pal, pal.window, 1 + h1(i) * 0.4)) : c.set(pal.windowOff));
    });
    const awn = pal.awning;
    world.businesses.forEach((b, i) => {
      const hgt = 1.8 + h1(i + 30) * 2.2, w = 1.8 + h1(i + 31) * 0.8;
      const [x, z] = geo.pt(b.x, b.y), rot = h1(i + 32) * Math.PI;
      o.position.set(x, hgt / 2, z); o.rotation.set(0, rot, 0); o.scale.set(w, hgt, w * 0.8); o.updateMatrix();
      bizRef.current?.setMatrixAt(i, o.matrix);
      bizRef.current?.setColorAt(i, c.set(pal.shop));
      o.position.set(x, hgt * 0.62, z); o.scale.set(w * 1.02, 0.14, w * 0.82); o.updateMatrix();
      awnRef.current?.setMatrixAt(i, o.matrix);
      awnRef.current?.setColorAt(i, c.copy(glowC(pal, awn[i % awn.length], 0.8)));
    });
    trees.forEach(([x, z, s], i) => {
      o.position.set(x, s * 1.1, z); o.rotation.set(0, h1(i) * 3, 0); o.scale.set(s, s * 1.6, s); o.updateMatrix();
      treeRef.current?.setMatrixAt(i, o.matrix);
      treeRef.current?.setColorAt(i, c.set(pal.trees[h1(i + 3) > 0.5 ? 0 : 1]));
    });
    for (const r of [homesRef, roofRef, winRef, bizRef, awnRef, treeRef]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
  }, [world, geo, trees, pal]);

  return (
    <group>
      <instancedMesh ref={homesRef} args={[undefined, undefined, Math.max(1, nH)]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={roofRef} args={[undefined, undefined, Math.max(1, nH)]} castShadow>
        <coneGeometry args={[1, 1, 4]} />
        <meshStandardMaterial roughness={0.7} flatShading />
      </instancedMesh>
      <instancedMesh ref={winRef} args={[undefined, undefined, Math.max(1, nH)]}>
        <boxGeometry args={[0.36, 0.32, 0.04]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={bizRef} args={[undefined, undefined, Math.max(1, nB)]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.6} metalness={0.1} />
      </instancedMesh>
      <instancedMesh ref={awnRef} args={[undefined, undefined, Math.max(1, nB)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={treeRef} args={[undefined, undefined, Math.max(1, trees.length)]} castShadow>
        <coneGeometry args={[0.7, 1.4, 6]} />
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
    </group>
  );
}

function Court({ clock, world, day }: { clock: WorldClock; world: World; day: number }) {
  const pal = usePal();
  const domeMat = useRef<THREE.MeshStandardMaterial>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const busy = (world.days[day]?.hearings.length ?? 0) > 0;
  const pediment = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-4.9, 0); s.lineTo(4.9, 0); s.lineTo(0, 1.5); s.lineTo(-4.9, 0);
    return new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: false });
  }, []);
  useFrame(({ clock: c }) => {
    const p = clock.t - Math.floor(clock.t);
    const base = pal.domeEmissive;
    const session = busy ? smooth(PHASE.leave, PHASE.arrive, p) * (1 - smooth(PHASE.depart, PHASE.home, p)) : 0;
    const pulse = clock.reducedMotion ? 0 : Math.sin(c.elapsedTime * 2) * 0.15;
    if (domeMat.current) domeMat.current.emissiveIntensity = base + session * (pal.mode === "night" ? 0.9 : 0.35) + pulse * base;
    if (beamMat.current) beamMat.current.opacity = 0.03 + session * 0.1;
  });
  const cols = [-3.9, -2.6, -1.3, 0, 1.3, 2.6, 3.9];
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} receiveShadow>
        <circleGeometry args={[11, 64]} />
        <meshStandardMaterial color={pal.plaza} roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
        <ringGeometry args={[10.7, 11, 96]} />
        <meshBasicMaterial color={glowC(pal, pal.plazaRing)} toneMapped={false} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[13, 0.6, 10]} />
        <meshStandardMaterial color={pal.courtStone[0]} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[11.6, 0.5, 8.6]} />
        <meshStandardMaterial color={pal.courtStone[1]} roughness={0.7} />
      </mesh>
      <mesh position={[0, 2.9, -0.8]} castShadow receiveShadow>
        <boxGeometry args={[9.4, 3.6, 5.2]} />
        <meshStandardMaterial color={pal.courtStone[2]} roughness={0.55} />
      </mesh>
      {cols.map((x) => (
        <mesh key={x} position={[x, 2.85, 2.6]} castShadow>
          <cylinderGeometry args={[0.28, 0.32, 3.5, 12]} />
          <meshStandardMaterial color={pal.courtStone[3]} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 4.75, 2.6]} castShadow>
        <boxGeometry args={[10, 0.35, 1.3]} />
        <meshStandardMaterial color={pal.courtStone[4]} roughness={0.5} />
      </mesh>
      <mesh geometry={pediment} position={[0, 4.92, 1.95]} castShadow>
        <meshStandardMaterial color={pal.courtStone[3]} roughness={0.5} />
      </mesh>
      <mesh position={[0, 5.2, -0.8]} castShadow>
        <cylinderGeometry args={[2.2, 2.4, 1, 24]} />
        <meshStandardMaterial color={pal.courtStone[1]} roughness={0.5} />
      </mesh>
      <mesh position={[0, 5.7, -0.8]} castShadow>
        <sphereGeometry args={[2.1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial ref={domeMat} color={pal.dome} emissive={pal.dome} emissiveIntensity={pal.domeEmissive} roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[0, 8.2, -0.8]}>
        <sphereGeometry args={[0.25, 12, 12]} />
        <meshBasicMaterial color={glowC(pal, pal.courtLight, 1.8)} toneMapped={false} />
      </mesh>
      <mesh position={[0, 22, -0.8]}>
        <cylinderGeometry args={[0.18, 0.7, 28, 16, 1, true]} />
        <meshBasicMaterial ref={beamMat} color={pal.beam} transparent opacity={0.08} blending={blendOf(pal)} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, 6, 6]} color={pal.courtLight} intensity={pal.mode === "night" ? 30 : 8} distance={40} decay={1.6} />
    </group>
  );
}

// ------------------------------------------------------------------ living layer

function Relationships({ world, geo }: { world: World; geo: Geo }) {
  const pal = usePal();
  const g = useMemo(() => {
    const e = world.edges;
    const pts = new Float32Array((e.length / 2) * 6);
    for (let k = 0; k < e.length; k += 2) {
      const a = e[k], b = e[k + 1];
      pts.set([geo.home[a * 2], 0.12, geo.home[a * 2 + 1], geo.home[b * 2], 0.12, geo.home[b * 2 + 1]], (k / 2) * 6);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    return bg;
  }, [world, geo]);
  return (
    <lineSegments geometry={g}>
      <lineBasicMaterial color={pal.relationship} transparent opacity={pal.relationshipOpacity} blending={blendOf(pal)} depthWrite={false} />
    </lineSegments>
  );
}

function arcPoints(ax: number, az: number, bx: number, bz: number, lift: number, seg: number) {
  const out: THREE.Vector3[] = [];
  const d = Math.hypot(bx - ax, bz - az);
  const h = lift + d * 0.14;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    out.push(new THREE.Vector3(ax + (bx - ax) * t, 0.3 + Math.sin(Math.PI * t) * h, az + (bz - az) * t));
  }
  return out;
}

function DisputeArcs({ world, geo, day, clock, onPickDispute }: { world: World; geo: Geo; day: number; clock: WorldClock; onPickDispute: (i: number) => void }) {
  const pal = usePal();
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const hotRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const selRef = useRef<THREE.MeshBasicMaterial>(null);
  const [sel, setSel] = useState(clock.selectedDispute);
  useFrame(() => { if (clock.selectedDispute !== sel) setSel(clock.selectedDispute); });

  const { lines, hot } = useMemo(() => {
    const pos: number[] = [], col: number[] = [];
    const ember = glowC(pal, pal.arcDispute, 0.8);
    const court = glowC(pal, pal.arcCourt, 0.6);
    const dim = new THREE.Color();
    const hotList: { idx: number; curve: THREE.CatmullRomCurve3 }[] = [];
    const today = new Set(world.days[day]?.quarrels ?? []);
    world.disputes.forEach((d, k) => {
      if (d.startDay > day || (d.endDay != null && d.endDay <= day) || d.a === d.b) return;
      const pts = arcPoints(geo.home[d.a * 2], geo.home[d.a * 2 + 1], geo.home[d.b * 2], geo.home[d.b * 2 + 1], 0.8, 14);
      const base = d.filedDay != null && d.filedDay <= day ? court : ember;
      const c = d.origin === "roster" ? (pal.additive ? dim.copy(base).multiplyScalar(0.35) : dim.copy(base).lerp(new THREE.Color(pal.ground), 0.6)) : base;
      for (let i = 0; i < pts.length - 1; i++) {
        pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      if (today.has(k) && hotList.length < 24) hotList.push({ idx: k, curve: new THREE.CatmullRomCurve3(pts) });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return { lines: g, hot: hotList };
  }, [world, geo, day, pal]);

  const selCurve = useMemo(() => {
    const d = world.disputes[sel];
    if (!d || d.a === d.b) return null;
    return new THREE.CatmullRomCurve3(arcPoints(geo.home[d.a * 2], geo.home[d.a * 2 + 1], geo.home[d.b * 2], geo.home[d.b * 2 + 1], 1.2, 24));
  }, [world, geo, sel]);
  const selColor = useMemo(() => {
    const d = world.disputes[sel];
    if (!d) return new THREE.Color(pal.arcDispute);
    if (d.endDay != null && d.endDay <= day) return glowC(pal, pal.arcResolved, 1.3);
    if (d.filedDay != null && d.filedDay <= day) return glowC(pal, pal.arcCourt, 1.3);
    return glowC(pal, pal.arcDispute, 1.3);
  }, [world, sel, day, pal]);

  useFrame(({ clock: c }) => {
    const t = c.elapsedTime;
    const p = clock.t - Math.floor(clock.t);
    if (matRef.current) matRef.current.opacity = clock.reducedMotion ? 0.3 : 0.26 + Math.sin(t * 1.6) * 0.08;
    hotRefs.current.forEach((m, i) => {
      if (!m) return;
      const flash = 1 - smooth(0.05, 0.9, p);
      m.opacity = clock.reducedMotion ? 0.8 : 0.35 + 0.65 * Math.abs(Math.sin(t * 5 + i)) * (0.4 + 0.6 * flash);
    });
    if (selRef.current) selRef.current.opacity = clock.reducedMotion ? 0.95 : 0.7 + Math.sin(t * 3) * 0.25;
  });

  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial ref={matRef} vertexColors transparent opacity={0.4} blending={blendOf(pal)} depthWrite={false} toneMapped={false} />
      </lineSegments>
      {hot.map((h, i) => (
        <mesh key={`${day}-${h.idx}`} onClick={(e) => { e.stopPropagation(); onPickDispute(h.idx); }}>
          <tubeGeometry args={[h.curve, 32, 0.12, 6, false]} />
          <meshBasicMaterial ref={(m) => { hotRefs.current[i] = m; }} color={glowC(pal, pal.arcDispute, 1.5)} transparent toneMapped={false} blending={blendOf(pal)} depthWrite={false} />
        </mesh>
      ))}
      {selCurve && (
        <mesh>
          <tubeGeometry args={[selCurve, 48, 0.2, 8, false]} />
          <meshBasicMaterial ref={selRef} color={selColor} transparent toneMapped={false} blending={blendOf(pal)} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function hearingMap(world: World, day: number) {
  const n = world.people.length;
  const map = new Int32Array(n).fill(-1);
  const adv = new Int32Array(world.advocates.length).fill(-1);
  const hs = world.days[day]?.hearings ?? [];
  hs.forEach((h, k) => {
    for (const p of h.travellers) map[p] = k;
    for (const a of h.advocates) adv[a] = k;
  });
  return { map, adv, hs };
}

function People({ world, geo, day, clock, positions, onPickPerson }: {
  world: World; geo: Geo; day: number; clock: WorldClock; positions: PosBuf; onPickPerson: (i: number) => void;
}) {
  const pal = usePal();
  const n = world.people.length;
  const [hover, setHover] = useState(-1);
  const mesh = useMemo(() => {
    const g = new THREE.CapsuleGeometry(0.26, 0.5, 4, 8);
    g.translate(0, 0.52, 0);
    const m = new THREE.MeshBasicMaterial({ toneMapped: false });
    const im = new THREE.InstancedMesh(g, m, Math.max(1, n));
    const c = new THREE.Color("#94A3B8");
    for (let i = 0; i < n; i++) im.setColorAt(i, c);
    im.frustumCulled = false;
    return im;
  }, [n]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }, [mesh]);

  const advMesh = useMemo(() => {
    const g = new THREE.ConeGeometry(0.32, 1.1, 6);
    g.translate(0, 0.55, 0);
    const m = new THREE.MeshBasicMaterial({ toneMapped: false });
    const im = new THREE.InstancedMesh(g, m, Math.max(1, world.advocates.length));
    im.frustumCulled = false;
    return im;
  }, [world.advocates.length]);

  const hm = useMemo(() => hearingMap(world, day), [world, day]);
  const selParties = useRef(new Set<number>());
  const o = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const palette = useMemo(() => ({
    state: pal.person.map((s, i) => (i === 0 ? new THREE.Color(s) : glowC(pal, s, 1.05))),
    outcome: Object.fromEntries(Object.entries(pal.outcome).map(([k, v]) => [k, glowC(pal, v, 1.25)])) as Record<OutcomeKind, THREE.Color>,
    advocate: new THREE.Color(pal.advocate),
  }), [pal]);

  useFrame(({ clock: c }) => {
    const time = c.elapsedTime;
    const p = clock.t - Math.floor(clock.t);
    const states = world.days[day]?.states;
    const d = world.disputes[clock.selectedDispute];
    selParties.current.clear();
    if (d) { selParties.current.add(d.a); selParties.current.add(d.b); }
    const go = smooth(PHASE.leave, PHASE.arrive, p), back = smooth(PHASE.depart, PHASE.home, p);
    const walk = clock.reducedMotion ? (p > PHASE.leave && p < PHASE.home ? 1 : 0) : go - back;
    for (let i = 0; i < n; i++) {
      const st = states ? states[i] : 0;
      let x = geo.home[i * 2], z = geo.home[i * 2 + 1];
      const hk = hm.map[i];
      let color = palette.state[st];
      if (hk >= 0 && walk > 0) {
        // home -> neighbourhood centre -> court gate
        const hx = geo.hood[i * 2], hz = geo.hood[i * 2 + 1], gx = geo.gate[i * 2], gz = geo.gate[i * 2 + 1];
        const l1 = Math.hypot(hx - x, hz - z), l2 = Math.hypot(gx - hx, gz - hz);
        const s = walk * (l1 + l2);
        if (s <= l1) { const f = l1 > 0 ? s / l1 : 1; x += (hx - x) * f; z += (hz - z) * f; }
        else { const f = l2 > 0 ? (s - l1) / l2 : 1; x = hx + (gx - hx) * f; z = hz + (gz - hz) * f; }
      } else if (!clock.reducedMotion) {
        const amp = st === 1 ? 0.35 : 0.7;
        const sp = st === 1 ? 1.4 : 0.35;
        x += Math.sin(time * sp + i * 1.7) * amp;
        z += Math.cos(time * sp * 0.8 + i * 2.3) * amp;
      }
      if (hk >= 0) {
        // people keep their own colour; the outcome shows as the ring from the court (COLORS.md section 7)
        color = palette.state[2];
      }
      const sel = selParties.current.has(i);
      const sc = sel ? 1.9 : i === hover ? 1.6 : st === 0 ? 0.9 : 1.15;
      const bob = walk > 0 && walk < 1 && hk >= 0 && !clock.reducedMotion ? Math.abs(Math.sin(time * 9 + i)) * 0.12 : 0;
      o.position.set(x, bob, z);
      o.scale.setScalar(sc);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      col.copy(color);
      if (sel) col.multiplyScalar(1.3);
      mesh.setColorAt(i, col);
      positions.set(i, x, z);
    }
    touch(mesh);

    for (let a = 0; a < world.advocates.length; a++) {
      let x = geo.advHome[a * 2], z = geo.advHome[a * 2 + 1];
      if (hm.adv[a] >= 0 && walk > 0) {
        x += (geo.advGate[a * 2] - x) * walk; z += (geo.advGate[a * 2 + 1] - z) * walk;
      }
      o.position.set(x, 0, z);
      o.scale.setScalar(hm.adv[a] >= 0 ? 1.1 : 0.85);
      o.updateMatrix();
      advMesh.setMatrixAt(a, o.matrix);
    }
    (advMesh.material as THREE.MeshBasicMaterial).color.copy(palette.advocate);
    touch(advMesh);
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId != null && e.instanceId !== hover) { setHover(e.instanceId); clock.setHover(e.instanceId); document.body.style.cursor = "pointer"; }
  };
  const onOut = () => { setHover(-1); clock.setHover(-1); document.body.style.cursor = ""; };

  return (
    <group>
      <primitive object={mesh} onPointerMove={onMove} onPointerOut={onOut}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.instanceId != null) onPickPerson(e.instanceId); }} />
      <primitive object={advMesh} />
    </group>
  );
}

function FilingLights({ world, geo, day, clock }: { world: World; geo: Geo; day: number; clock: WorldClock }) {
  const pal = usePal();
  const max = 40;
  const ref = useRef<THREE.InstancedMesh>(null);
  const trailRef = useRef<THREE.InstancedMesh>(null);
  const curves = useMemo(() => (world.days[day]?.filings ?? []).slice(0, max).map((di) => {
    const d = world.disputes[di];
    const ax = geo.home[d.a * 2], az = geo.home[d.a * 2 + 1];
    const len = Math.hypot(ax, az) || 1;
    return new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(ax, 0.8, az),
      new THREE.Vector3(ax * 0.5, 8 + len * 0.12, az * 0.5),
      new THREE.Vector3((ax / len) * 7, 2, (az / len) * 7),
    );
  }), [world, geo, day]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const m = ref.current, tr = trailRef.current;
    if (!m || !tr) return;
    const p = clock.t - Math.floor(clock.t);
    for (let i = 0; i < max; i++) {
      const c = curves[i];
      for (let k = 0; k < 4; k++) {
        const s = smooth(0.04, 0.5, p - k * 0.012);
        const vis = c && p > 0.03 && p < 0.56;
        if (vis) c.getPoint(s, v); else v.set(0, -50, 0);
        o.position.copy(v);
        o.scale.setScalar(vis ? (k === 0 ? 1 : 0.8 - k * 0.18) * (1 - smooth(0.5, 0.56, p) * 0.9) : 0.001);
        o.updateMatrix();
        if (k === 0) m.setMatrixAt(i, o.matrix); else tr.setMatrixAt(i * 3 + k - 1, o.matrix);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    tr.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, max]} frustumCulled={false}>
        <sphereGeometry args={[0.42, 16, 16]} />
        <meshBasicMaterial color={glowC(pal, pal.filing, 2)} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={trailRef} args={[undefined, undefined, max * 3]} frustumCulled={false}>
        <sphereGeometry args={[0.3, 10, 10]} />
        <meshBasicMaterial color={glowC(pal, pal.filing, 1.3)} toneMapped={false} transparent opacity={0.6} />
      </instancedMesh>
    </group>
  );
}

function CourtPulse({ world, day, clock }: { world: World; day: number; clock: WorldClock }) {
  const pal = usePal();
  const kinds = useMemo(() => {
    const cnt: Partial<Record<OutcomeKind, number>> = {};
    for (const h of world.days[day]?.hearings ?? []) cnt[h.outcome] = (cnt[h.outcome] ?? 0) + 1;
    return (Object.entries(cnt) as [OutcomeKind, number][]).sort((a, b) => b[1] - a[1]);
  }, [world, day]);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const p = clock.t - Math.floor(clock.t);
    refs.current.forEach((m, i) => {
      if (!m) return;
      const s = smooth(PHASE.verdict + i * 0.04, PHASE.verdict + 0.4 + i * 0.04, p);
      const vis = s > 0 && s < 1;
      m.visible = vis;
      m.scale.setScalar(11.5 + s * (5 + Math.min(6, kinds[i]?.[1] ?? 1)));
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - s) * (1 - s) * 0.85;
    });
  });
  return (
    <group position={[0, 0.25, 0]}>
      {kinds.map(([k], i) => (
        <mesh key={`${day}-${k}`} ref={(m) => { refs.current[i] = m; }} rotation-x={-Math.PI / 2} visible={false}>
          <ringGeometry args={[0.96, 1, 96]} />
          <meshBasicMaterial color={glowC(pal, pal.outcome[k], 1.4)} transparent toneMapped={false} blending={blendOf(pal)} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function SelectionHalo({ world, clock, positions }: { world: World; clock: WorldClock; positions: PosBuf }) {
  const pal = usePal();
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  useFrame(({ clock: c }) => {
    const d = world.disputes[clock.selectedDispute];
    const pick = clock.selectedPerson;
    const ids = d ? [d.a, d.b] : pick >= 0 ? [pick, -1] : [-1, -1];
    [a.current, b.current].forEach((g, k) => {
      if (!g) return;
      const i = ids[k];
      g.visible = i >= 0 && !(k === 1 && ids[1] === ids[0]);
      if (!g.visible) return;
      g.position.set(positions.x(i), 0.05, positions.z(i));
      g.rotation.y = c.elapsedTime * 1.2;
      const s = 1 + (clock.reducedMotion ? 0 : Math.sin(c.elapsedTime * 3) * 0.12);
      g.scale.set(s, 1, s);
    });
  });
  const ring = (
    <>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.9, 1.1, 40]} />
        <meshBasicMaterial color={glowC(pal, pal.halo, 1.5)} toneMapped={false} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 6, 6, 1, true]} />
        <meshBasicMaterial color={glowC(pal, pal.halo, 1.2)} toneMapped={false} transparent opacity={0.5} blending={blendOf(pal)} depthWrite={false} />
      </mesh>
    </>
  );
  return (
    <>
      <group ref={a} visible={false}>{ring}</group>
      <group ref={b} visible={false}>{ring}</group>
    </>
  );
}

/** projects place labels (DOM elements owned by the page) onto the canvas every frame */
function LabelProjector({ world, geo, labels }: { world: World; geo: Geo; labels: LabelRefs }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  const pts = useMemo(() => [
    ...world.hoods.map((h) => new THREE.Vector3(geo.wx(h.x), 4.5, geo.wz(h.y))),
    new THREE.Vector3(0, 10.5, -0.8),
  ], [world, geo]);
  useFrame(() => {
    const els = labels.current;
    if (!els) return;
    pts.forEach((p, i) => {
      const el = els[i];
      if (!el) return;
      v.copy(p).project(camera);
      const behind = v.z > 1;
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      el.style.opacity = behind ? "0" : "1";
    });
  });
  return null;
}

// ------------------------------------------------------------------ camera

function CameraRig({ world, clock, positions, onUserCamera }: { world: World; clock: WorldClock; positions: PosBuf; onUserCamera: () => void }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const userDrag = useRef(false);
  useFrame((_, dt) => {
    const ctl = controls.current;
    if (!ctl) return;
    ctl.autoRotate = !clock.reducedMotion && clock.playing && !userDrag.current;
    ctl.autoRotateSpeed = clock.focus?.kind === "overview" ? 0.35 : 0.6;
    const f = clock.focus;
    if (!f || userDrag.current) return;
    let dist = 120;
    if (f.kind === "overview") { target.set(0, 0, 0); dist = 118; }
    else if (f.kind === "court") { target.set(0, 2, 0); dist = f.dist ?? 34; }
    else if (f.kind === "person") {
      const i = f.idx;
      target.set(positions.x(i), 0.8, positions.z(i)); dist = f.dist ?? 16;
    } else if (f.kind === "dispute") {
      const d = world.disputes[f.idx];
      if (!d) return;
      const ax = positions.x(d.a), az = positions.z(d.a), bx = positions.x(d.b), bz = positions.z(d.b);
      target.set((ax + bx) / 2, 0.8, (az + bz) / 2);
      dist = Math.max(f.dist ?? 18, Math.hypot(ax - bx, az - bz) * 1.25);
    }
    const k = clock.reducedMotion ? 1 : 1 - Math.exp(-dt * 1.8);
    ctl.target.lerp(target, k);
    dir.copy(camera.position).sub(ctl.target);
    const cur = dir.length() || 1;
    dir.normalize();
    // keep a cinematic elevation
    const wantY = f.kind === "overview" ? 0.62 : 0.5;
    dir.setY(dir.y + (wantY - dir.y) * k);
    dir.normalize();
    camera.position.copy(ctl.target).addScaledVector(dir, cur + (dist - cur) * k);
    ctl.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={220}
      maxPolarAngle={Math.PI * 0.44}
      onStart={() => { userDrag.current = true; onUserCamera(); }}
      onEnd={() => { userDrag.current = false; }}
    />
  );
}

// ------------------------------------------------------------------ root

function SceneContent({ world, clock, day, onPickPerson, onPickDispute, onUserCamera, showLabels, labels }: Props) {
  const geo = useGeo(world);
  const positions = useMemo(() => new PosBuf(world.people.length), [world]);
  const pal = usePal();
  return (
    <>
      <color attach="background" args={[pal.sky]} />
      <fog attach="fog" args={[pal.sky, pal.fogNear, pal.fogFar]} />
      <hemisphereLight args={[pal.hemiSky, pal.hemiGround, pal.hemiIntensity]} />
      <ambientLight intensity={pal.ambient} />
      <directionalLight
        position={[-40, 70, 30]}
        intensity={pal.sunIntensity}
        color={pal.sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.0005}
      />
      {pal.stars && <Stars radius={260} depth={60} count={1800} factor={5} saturation={0} fade speed={clock.reducedMotion ? 0 : 0.4} />}
      <Ground world={world} geo={geo} />
      <Roads world={world} geo={geo} />
      <Buildings world={world} geo={geo} />
      <Court clock={clock} world={world} day={day} />
      <Relationships world={world} geo={geo} />
      <DisputeArcs world={world} geo={geo} day={day} clock={clock} onPickDispute={onPickDispute} />
      <People world={world} geo={geo} day={day} clock={clock} positions={positions} onPickPerson={onPickPerson} />
      <FilingLights world={world} geo={geo} day={day} clock={clock} />
      <CourtPulse world={world} day={day} clock={clock} />
      <SelectionHalo world={world} clock={clock} positions={positions} />
      {showLabels && <LabelProjector world={world} geo={geo} labels={labels} />}
      <CameraRig world={world} clock={clock} positions={positions} onUserCamera={onUserCamera} />
    </>
  );
}

export default function TownScene(props: Props) {
  const [dpr, setDpr] = useState(1.5);
  const pal = props.palette;
  return (
    <PalCtx.Provider value={pal}>
    <Canvas
      shadows
      dpr={dpr}
      camera={{ position: [0, 74, 92], fov: 38, near: 0.5, far: 600 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
      <PalCtx.Provider value={pal}>
        <SceneContent {...props} />
      </PalCtx.Provider>
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={Math.min(0.6, pal.bloom.intensity)} luminanceThreshold={pal.bloom.threshold} luminanceSmoothing={0.25} />
        <Vignette offset={0.3} darkness={pal.vignette} />
      </EffectComposer>
    </Canvas>
    </PalCtx.Provider>
  );
}
