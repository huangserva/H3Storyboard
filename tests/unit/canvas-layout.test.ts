import { describe, expect, it } from 'vitest';
import {
  centerViewportOnNode,
  createInitialPositions,
  nextCanvasZIndex,
  parseStoredPositions,
  zoomViewportAt,
} from '../../apps/studio/src/lib/canvas-layout.js';

describe('infinite canvas layout', () => {
  it('keeps the world point below the cursor fixed while zooming', () => {
    const viewport = { x: 40, y: -20, zoom: 1 };

    expect(zoomViewportAt(viewport, { x: 300, y: 180 }, 2)).toEqual({
      x: -220,
      y: -220,
      zoom: 2,
    });
  });

  it('clusters initial shot positions by scene', () => {
    const positions = createInitialPositions([
      { id: 'shot-1', scene_id: 'SCENE-A', ordinal: 1 },
      { id: 'shot-2', scene_id: 'SCENE-A', ordinal: 2 },
      { id: 'shot-3', scene_id: 'SCENE-B', ordinal: 3 },
    ]);

    expect(positions['shot-1']).toEqual({ x: 80, y: 100 });
    expect(positions['shot-2']).toEqual({ x: 364, y: 100 });
    expect(positions['shot-3']).toEqual({ x: 80, y: 440 });
  });

  it('ignores malformed persisted card positions', () => {
    expect(
      parseStoredPositions(
        JSON.stringify({
          good: { x: 12, y: -4 },
          missing: { x: 1 },
          infinite: { x: 2, y: Number.POSITIVE_INFINITY },
          text: 'nope',
        }),
      ),
    ).toEqual({ good: { x: 12, y: -4 } });
    expect(parseStoredPositions('{bad json')).toEqual({});
  });

  it('centers a node at 100% zoom and raises it above all siblings', () => {
    expect(
      centerViewportOnNode(
        { width: 1200, height: 800 },
        { x: 300, y: 200, width: 260, height: 196 },
      ),
    ).toEqual({ x: 170, y: 102, zoom: 1 });
    expect(nextCanvasZIndex([{ z_index: 2 }, { z_index: 9 }])).toBe(10);
    expect(nextCanvasZIndex([])).toBe(1);
  });
});
