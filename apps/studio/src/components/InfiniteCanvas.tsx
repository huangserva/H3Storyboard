import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent } from 'react';
import type { CanvasNode, ProjectSnapshot } from '@h3storyboard/protocol';
import {
  centerViewportOnNode,
  nextCanvasZIndex,
  zoomViewportAt,
  type CanvasViewport,
} from '../lib/canvas-layout.js';
import { useCanvasNodes } from '../lib/use-canvas-nodes.js';
import { useCharacters } from '../lib/use-characters.js';
import { CanvasCharacterCard } from './CanvasCharacterCard.js';
import { AssetLibraryPanel } from './AssetLibraryPanel.js';
import { CanvasShotCard } from './CanvasShotCard.js';
import { CharacterLibraryPanel } from './CharacterLibraryPanel.js';

interface InfiniteCanvasProps {
  snapshot: ProjectSnapshot;
  selectedShotId: string | null;
  busy: boolean;
  onNewShot: () => void;
  onSelectShot: (id: string) => void;
}

type Interaction =
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | {
      kind: 'card'; pointerId: number; nodeId: string;
      lastX: number; lastY: number; x: number; y: number; zIndex: number;
    };

const RESET_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

export function InfiniteCanvas({
  snapshot, selectedShotId, busy, onNewShot, onSelectShot,
}: InfiniteCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const spacePressed = useRef(false);
  const [viewport, setViewport] = useState(RESET_VIEWPORT);
  const { nodes, loading, error, updateLocalNode, persistNode, placeCharacter } =
    useCanvasNodes(snapshot);
  const characterStore = useCharacters(snapshot.project.id);
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const shotNodes = useMemo(
    () => new Map(nodes.filter(({ node_type }) => node_type === 'shot_plan')
      .map((node) => [node.ref_id, node])),
    [nodes],
  );
  const charactersById = useMemo(
    () => new Map(characterStore.characters.map((character) =>
      [character.id, character])),
    [characterStore.characters],
  );

  useEffect(() => {
    setViewport(RESET_VIEWPORT);
  }, [snapshot.project.id]);

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
    const groups = new Map<string, CanvasNode[]>();
    for (const shot of snapshot.shot_plans) {
      const node = shotNodes.get(shot.id);
      if (!node) continue;
      const group = groups.get(shot.scene_id) ?? [];
      group.push(node);
      groups.set(shot.scene_id, group);
    }
    return [...groups.entries()].map(([sceneId, sceneNodes]) => {
      const minX = Math.min(...sceneNodes.map(({ x }) => x)) - 24;
      const minY = Math.min(...sceneNodes.map(({ y }) => y)) - 48;
      const maxX = Math.max(...sceneNodes.map(({ x, width }) => x + width)) + 24;
      const maxY = Math.max(...sceneNodes.map(({ y, height }) => y + height)) + 24;
      return { sceneId, count: sceneNodes.length, x: minX, y: minY,
        width: maxX - minX, height: maxY - minY };
    });
  }, [shotNodes, snapshot.shot_plans]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-canvas-node]');
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (card && !spacePressed.current && event.button === 0) {
      const nodeId = card.dataset.canvasNode;
      const node = nodeId ? nodesById.get(nodeId) : undefined;
      if (!node) return;
      const zIndex = nextCanvasZIndex(nodes);
      if (node.node_type === 'shot_plan') onSelectShot(node.ref_id);
      updateLocalNode(node.id, { z_index: zIndex });
      interactionRef.current = { kind: 'card', pointerId: event.pointerId,
        nodeId: node.id, lastX: event.clientX, lastY: event.clientY,
        x: node.x, y: node.y, zIndex };
    } else {
      interactionRef.current = { kind: 'pan', pointerId: event.pointerId,
        lastX: event.clientX, lastY: event.clientY };
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
    interaction.x += dx / viewport.zoom;
    interaction.y += dy / viewport.zoom;
    updateLocalNode(interaction.nodeId, { x: interaction.x, y: interaction.y });
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    event.currentTarget.dataset.panning = 'false';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (interaction.kind === 'card') {
      void persistNode({ node_id: interaction.nodeId, x: interaction.x,
        y: interaction.y, z_index: interaction.zIndex });
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setViewport((current) => zoomViewportAt(current, pointer,
      current.zoom * Math.exp(-event.deltaY * 0.0015)));
  };

  const onDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-canvas-node]');
    const node = card?.dataset.canvasNode
      ? nodesById.get(card.dataset.canvasNode) : undefined;
    const surface = surfaceRef.current;
    if (!node || !surface) return;
    setViewport(centerViewportOnNode(surface.getBoundingClientRect(), node));
  };

  return (
    <div className="infinite-canvas" ref={surfaceRef} data-space="false" data-panning="false"
      onDoubleClick={onDoubleClick} onPointerDown={onPointerDown}
      onPointerMove={onPointerMove} onPointerUp={endInteraction}
      onPointerCancel={endInteraction} onWheel={onWheel}>
      <div className="canvas-hud"><span>{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => setViewport(RESET_VIEWPORT)}>复位视图</button>
        <small>拖拽平移 · 滚轮缩放 · 拖动卡片 · 双击聚焦 · 空格拖拽平移</small></div>
      {error ? <div className="canvas-status" role="alert">{error}</div> : null}
      {loading ? <div className="canvas-status">正在加载画布布局…</div> : null}
      <AssetLibraryPanel projectId={snapshot.project.id} />
      <CharacterLibraryPanel characters={characterStore.characters}
        canvasCharacterIds={new Set(nodes.filter(({ node_type }) =>
          node_type === 'character').map(({ ref_id }) => ref_id))}
        busy={characterStore.busy} error={characterStore.error}
        onCreate={characterStore.create} onUpdate={characterStore.update}
        onPlace={(characterId) => void placeCharacter(characterId)} />
      {snapshot.shot_plans.length === 0 &&
        !nodes.some(({ node_type }) => node_type === 'character') ? (
        <div className="canvas-empty"><span>EMPTY CANVAS</span><h2>从第一镜开始搭建场景</h2>
          <p>创建计划镜头后，画布会按场次自动聚簇。布局保存在项目数据库中。</p>
          <button className="button button-primary" disabled={busy} onClick={onNewShot}
            type="button">＋ 新增计划镜头</button></div>
      ) : (
        <div className="canvas-world" style={{ transform:
          `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {scenes.map((scene) => <section className="canvas-scene-frame" key={scene.sceneId}
            style={{ transform: `translate(${scene.x}px, ${scene.y}px)`,
              width: scene.width, height: scene.height }}>
            <header><strong>{scene.sceneId}</strong><span>{scene.count} SHOTS</span></header>
          </section>)}
          {snapshot.shot_plans.map((shot) => {
            const node = shotNodes.get(shot.id);
            return node ? <CanvasShotCard key={shot.id} shot={shot} node={node}
              selected={selectedShotId === shot.id}
              actuals={snapshot.shot_actuals.filter(
                (actual) => actual.shot_plan_id === shot.id)} /> : null;
          })}
          {nodes.filter(({ node_type }) => node_type === 'character').map((node) => {
            const character = charactersById.get(node.ref_id);
            return character ? <CanvasCharacterCard key={node.id}
              character={character} node={node} /> : null;
          })}
        </div>
      )}
    </div>
  );
}
