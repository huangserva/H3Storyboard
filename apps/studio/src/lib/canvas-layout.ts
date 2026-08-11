export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewport extends CanvasPoint {
  zoom: number;
}

export type CanvasPositions = Record<string, CanvasPoint>;

interface LayoutShot {
  id: string;
  scene_id: string;
  ordinal: number;
}

export const MIN_CANVAS_ZOOM = 0.35;
export const MAX_CANVAS_ZOOM = 2.4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function zoomViewportAt(
  viewport: CanvasViewport,
  pointer: CanvasPoint,
  requestedZoom: number,
): CanvasViewport {
  const zoom = clampZoom(requestedZoom);
  const worldX = (pointer.x - viewport.x) / viewport.zoom;
  const worldY = (pointer.y - viewport.y) / viewport.zoom;
  return {
    x: pointer.x - worldX * zoom,
    y: pointer.y - worldY * zoom,
    zoom,
  };
}

export function centerViewportOnNode(
  surface: { width: number; height: number },
  node: CanvasPoint & { width: number; height: number },
): CanvasViewport {
  return {
    x: surface.width / 2 - (node.x + node.width / 2),
    y: surface.height / 2 - (node.y + node.height / 2),
    zoom: 1,
  };
}

export function nextCanvasZIndex(
  nodes: ReadonlyArray<{ z_index: number }>,
): number {
  return Math.max(0, ...nodes.map(({ z_index }) => z_index)) + 1;
}

export function createInitialPositions(shots: LayoutShot[]): CanvasPositions {
  const positions: CanvasPositions = {};
  const scenes = new Map<string, LayoutShot[]>();
  for (const shot of [...shots].sort((a, b) => a.ordinal - b.ordinal)) {
    const scene = scenes.get(shot.scene_id) ?? [];
    scene.push(shot);
    scenes.set(shot.scene_id, scene);
  }

  let sceneY = 100;
  for (const scene of scenes.values()) {
    scene.forEach((shot, index) => {
      positions[shot.id] = {
        x: 80 + (index % 3) * 284,
        y: sceneY + Math.floor(index / 3) * 224,
      };
    });
    sceneY += 340 + Math.max(0, Math.ceil(scene.length / 3) - 1) * 224;
  }
  return positions;
}

export function parseStoredPositions(serialized: string | null): CanvasPositions {
  if (!serialized) return {};
  try {
    const candidate: unknown = JSON.parse(serialized);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};

    const positions: CanvasPositions = {};
    for (const [id, value] of Object.entries(candidate)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const point = value as { x?: unknown; y?: unknown };
      if (
        typeof point.x === 'number' &&
        Number.isFinite(point.x) &&
        typeof point.y === 'number' &&
        Number.isFinite(point.y)
      ) {
        positions[id] = { x: point.x, y: point.y };
      }
    }
    return positions;
  } catch {
    return {};
  }
}
