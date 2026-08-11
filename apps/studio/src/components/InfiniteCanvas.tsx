import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent } from 'react';
import type { ProjectSnapshot } from '@h3storyboard/protocol';
import {
  createInitialPositions,
  parseStoredPositions,
  zoomViewportAt,
  type CanvasPositions,
  type CanvasPoint,
  type CanvasViewport,
} from '../lib/canvas-layout.js';
import { CanvasShotCard } from './CanvasShotCard.js';

interface InfiniteCanvasProps {
  snapshot: ProjectSnapshot;
  selectedShotId: string | null;
  busy: boolean;
  onNewShot: () => void;
  onSelectShot: (id: string) => void;
}

type Interaction =
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | { kind: 'card'; pointerId: number; shotId: string; lastX: number; lastY: number };

const INITIAL_VIEWPORT: CanvasViewport = { x: 24, y: 20, zoom: 0.86 };
const CARD_WIDTH = 260;
const CARD_HEIGHT = 196;

export function InfiniteCanvas({
  snapshot,
  selectedShotId,
  busy,
  onNewShot,
  onSelectShot,
}: InfiniteCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const spacePressed = useRef(false);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [positions, setPositions] = useState<CanvasPositions>({});
  const storageKey = `h3storyboard.canvas.v1.${snapshot.project.id}`;

  useEffect(() => {
    const defaults = createInitialPositions(snapshot.shot_plans);
    const stored = parseStoredPositions(localStorage.getItem(storageKey));
    setPositions({ ...defaults, ...stored });
    setViewport(INITIAL_VIEWPORT);
  }, [snapshot.project.id, snapshot.shot_plans, storageKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      event.preventDefault();
      spacePressed.current = true;
      surfaceRef.current?.setAttribute('data-space', 'true');
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spacePressed.current = false;
      surfaceRef.current?.setAttribute('data-space', 'false');
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const scenes = useMemo(() => {
    const groups = new Map<string, ProjectSnapshot['shot_plans']>();
    for (const shot of snapshot.shot_plans) {
      const group = groups.get(shot.scene_id) ?? [];
      group.push(shot);
      groups.set(shot.scene_id, group);
    }
    return [...groups.entries()].map(([sceneId, shots]) => {
      const points = shots
        .map((shot) => positions[shot.id])
        .filter((point): point is CanvasPoint => point !== undefined);
      if (points.length === 0) return null;
      const minX = Math.min(...points.map(({ x }) => x)) - 24;
      const minY = Math.min(...points.map(({ y }) => y)) - 48;
      const maxX = Math.max(...points.map(({ x }) => x)) + CARD_WIDTH + 24;
      const maxY = Math.max(...points.map(({ y }) => y)) + CARD_HEIGHT + 24;
      return { sceneId, count: shots.length, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }).filter((scene) => scene !== null);
  }, [positions, snapshot.shot_plans]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-shot-card]');
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (card && !spacePressed.current && event.button === 0) {
      const shotId = card.dataset.shotCard;
      if (!shotId) return;
      onSelectShot(shotId);
      interactionRef.current = { kind: 'card', pointerId: event.pointerId, shotId, lastX: event.clientX, lastY: event.clientY };
    } else {
      interactionRef.current = { kind: 'pan', pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      event.currentTarget.dataset.panning = 'true';
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = event.clientX - interaction.lastX;
    const dy = event.clientY - interaction.lastY;
    interaction.lastX = event.clientX;
    interaction.lastY = event.clientY;
    if (interaction.kind === 'pan') {
      setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      return;
    }
    setPositions((currentPositions) => {
      const current = currentPositions[interaction.shotId];
      if (!current) return currentPositions;
      const next = {
        ...currentPositions,
        [interaction.shotId]: { x: current.x + dx / viewport.zoom, y: current.y + dy / viewport.zoom },
      };
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    event.currentTarget.dataset.panning = 'false';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setViewport((current) => zoomViewportAt(current, pointer, current.zoom * Math.exp(-event.deltaY * 0.0015)));
  };

  return (
    <div className="infinite-canvas" ref={surfaceRef} data-space="false" data-panning="false"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endInteraction}
      onPointerCancel={endInteraction} onWheel={onWheel}>
      <div className="canvas-hud">
        <span>{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => setViewport(INITIAL_VIEWPORT)}>回到起点</button>
        <small>拖动画布平移 · 滚轮缩放 · 拖动卡片排布 · 空格拖拽平移</small>
      </div>
      {snapshot.shot_plans.length === 0 ? (
        <div className="canvas-empty">
          <span>EMPTY CANVAS</span><h2>从第一镜开始搭建场景</h2>
          <p>创建计划镜头后，画布会按场次自动聚簇。之后可自由拖动，位置只保存在这台浏览器。</p>
          <button className="button button-primary" disabled={busy} onClick={onNewShot} type="button">＋ 新增计划镜头</button>
        </div>
      ) : (
        <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {scenes.map((scene) => (
            <section className="canvas-scene-frame" key={scene.sceneId}
              style={{ transform: `translate(${scene.x}px, ${scene.y}px)`, width: scene.width, height: scene.height }}>
              <header><strong>{scene.sceneId}</strong><span>{scene.count} SHOTS</span></header>
            </section>
          ))}
          {snapshot.shot_plans.map((shot) => {
            const position = positions[shot.id];
            return position ? (
              <CanvasShotCard key={shot.id} shot={shot} position={position}
                selected={selectedShotId === shot.id}
                actuals={snapshot.shot_actuals.filter((actual) => actual.shot_plan_id === shot.id)} />
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
