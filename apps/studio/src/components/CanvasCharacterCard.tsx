import type { CanvasNode, Character } from '@h3storyboard/protocol';

interface CanvasCharacterCardProps {
  character: Character;
  node: CanvasNode;
}

export function CanvasCharacterCard({
  character,
  node,
}: CanvasCharacterCardProps) {
  return (
    <article
      aria-label={`角色 ${character.name}`}
      className="canvas-character-card"
      data-canvas-node={node.id}
      style={{ height: node.height, transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.width, zIndex: node.z_index }}
    >
      <header><span>CHARACTER</span><i>{character.status}</i></header>
      <div className="character-monogram" aria-hidden="true">
        {character.name.slice(0, 1).toUpperCase()}
      </div>
      <h3>{character.name}</h3>
      <p>{character.canonical_appearance}</p>
      <footer>SEEDS · {character.seed_family.join(' / ') || 'UNSET'}</footer>
    </article>
  );
}
