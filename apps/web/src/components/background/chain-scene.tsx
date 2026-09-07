import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const ELECTRIC = "#2e9bff";
const GOLD = "#ffb627";
const VOID = "#05070c";

type Focus = { x: number; y: number; z: number; illuminate: "none" | "source" | "arc" | "destination" };

function makeNodes(side: -1 | 1, count: number) {
  const rng = mulberry(side === -1 ? 12 : 77);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const depth = -i * 0.55 - rng() * 0.3;
    out.push(
      new THREE.Vector3(
        side * (2.6 + Math.sin(i * 0.7) * 0.7 + rng() * 0.4),
        Math.cos(i * 0.55) * 1.4 + (rng() - 0.5) * 0.6,
        depth,
      ),
    );
  }
  return out;
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ChainStructure({
  side,
  count,
  color,
  bright,
}: {
  side: -1 | 1;
  count: number;
  color: string;
  bright: boolean;
}) {
  const nodes = useMemo(() => makeNodes(side, count), [side, count]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);

  useMemo(() => {
    // set instance matrices once nodes exist
  }, [nodes]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    const m = new THREE.Matrix4();
    nodes.forEach((n, i) => {
      const scale = 0.075 + Math.sin(t * 0.8 + i) * 0.012;
      m.makeScale(scale, scale, scale);
      m.setPosition(n.x, n.y + Math.sin(t * 0.35 + i * 0.4) * 0.06, n.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (group.current) group.current.rotation.y = Math.sin(t * 0.06) * 0.08 * side;
  });

  const linePositions = useMemo(() => {
    const pts: number[] = [];
    nodes.forEach((n, i) => {
      if (i === 0) return;
      const p = nodes[i - 1]!;
      pts.push(p.x, p.y, p.z, n.x, n.y, n.z);
      if (i > 2) {
        const q = nodes[i - 3]!;
        pts.push(q.x, q.y, q.z, n.x, n.y, n.z);
      }
    });
    return new Float32Array(pts);
  }, [nodes]);

  return (
    <group ref={group}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, nodes.length]}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={bright ? 1 : 0.75} />
      </instancedMesh>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={bright ? 0.34 : 0.16} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

function Arc({
  color,
  duration,
  delay,
  reversed,
  height,
}: {
  color: string;
  duration: number;
  delay: number;
  reversed: boolean;
  height: number;
}) {
  const headRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Line>(null);

  const curve = useMemo(() => {
    const from = new THREE.Vector3(reversed ? 2.6 : -2.6, height * 0.4, -0.4);
    const to = new THREE.Vector3(reversed ? -2.6 : 2.6, height * -0.3, -1.2);
    const mid = new THREE.Vector3(0, height, 0.6);
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  }, [reversed, height]);

  const trailGeom = useMemo(() => new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), [curve]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const local = (t - delay) % (duration + 1.4);
    const active = local >= 0 && local <= duration;
    const p = active ? local / duration : 0;
    if (headRef.current) {
      headRef.current.visible = active;
      if (active) headRef.current.position.copy(curve.getPointAt(p));
    }
    const mat = trailRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (mat) mat.opacity = active ? 0.12 + 0.35 * Math.sin(Math.PI * p) : 0.04;
  });

  return (
    <group>
      {/* @ts-expect-error r3f line primitive */}
      <line ref={trailRef} geometry={trailGeom}>
        <lineBasicMaterial color={color} transparent opacity={0.1} toneMapped={false} />
      </line>
      <mesh ref={headRef}>
        <sphereGeometry args={[0.075, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Rig({ focus, still }: { focus: Focus; still: boolean }) {
  const { camera, size } = useThree();
  const target = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });

  useFrame(() => {
    if (still) {
      camera.position.set(focus.x, focus.y, focus.z);
      camera.lookAt(0, 0, -2);
      return;
    }
    const el = document.documentElement;
    pointer.current.x = (Number(el.dataset["px"] ?? 0) - 0.5) * 2;
    pointer.current.y = (Number(el.dataset["py"] ?? 0) - 0.5) * 2;
    target.current.x += (pointer.current.x * 0.4 - target.current.x) * 0.05;
    target.current.y += (pointer.current.y * 0.4 - target.current.y) * 0.05;
    camera.position.x += (focus.x + target.current.x - camera.position.x) * 0.05;
    camera.position.y += (focus.y - target.current.y - camera.position.y) * 0.05;
    camera.position.z += (focus.z - camera.position.z) * 0.05;
    camera.rotation.z = 0;
    camera.lookAt(target.current.x * 0.3, -target.current.y * 0.3, -2);
  });

  useMemo(() => camera.updateProjectionMatrix(), [camera, size]);
  return null;
}

export default function ChainScene({
  reducedMotion,
  focus,
}: {
  reducedMotion: boolean;
  focus: Focus;
}) {
  const nodeCount = 26;
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={reducedMotion ? "demand" : "always"}
      camera={{ position: [0, 0, 6], fov: 50 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(VOID, 1);
        scene.fog = new THREE.Fog(VOID, 5, 16);
      }}
    >
      <Rig focus={focus} still={reducedMotion} />
      <ChainStructure side={-1} count={nodeCount} color={ELECTRIC} bright={focus.illuminate === "source"} />
      <ChainStructure side={1} count={nodeCount} color={GOLD} bright={focus.illuminate === "destination"} />
      {!reducedMotion && (
        <>
          <Arc color={ELECTRIC} duration={0.8} delay={0} reversed={false} height={1.5} />
          <Arc color={ELECTRIC} duration={0.8} delay={2.3} reversed={true} height={-1.1} />
          <Arc color={GOLD} duration={4} delay={1.1} reversed={false} height={-1.8} />
          <Arc color={GOLD} duration={4} delay={5.4} reversed={true} height={2.1} />
        </>
      )}
    </Canvas>
  );
}
