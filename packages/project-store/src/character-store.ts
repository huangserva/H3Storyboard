import type {
  Character,
  CharacterCatalog,
  CharacterReference,
  CreateCharacterInput,
  CreateCharacterReferenceInput,
  UpdateCharacterInput,
  UpdateCharacterReferenceInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { createCharacter, listCharacters, updateCharacter } from
  './character-operations.js';
import { createCharacterReference, listCharacterReferences,
  listProjectCharacterReferences,
  updateCharacterReference } from './character-reference-operations.js';
import { mapAsset } from './row-mappers.js';

export class CharacterStore {
  constructor(private readonly database: Database.Database) {}

  list(projectId: string): Character[] {
    return listCharacters(this.database, projectId);
  }

  create(projectId: string, input: CreateCharacterInput): Character {
    return createCharacter(this.database, projectId, input);
  }

  update(projectId: string, input: UpdateCharacterInput): Character {
    return updateCharacter(this.database, projectId, input);
  }

  listReferences(projectId: string,
    characterId: string): CharacterReference[] {
    return listCharacterReferences(this.database, projectId, characterId);
  }

  listProjectReferences(projectId: string): CharacterReference[] {
    return listProjectCharacterReferences(this.database, projectId);
  }

  catalog(projectId: string): CharacterCatalog {
    return this.database.transaction(() => ({
      characters: this.list(projectId),
      references: this.listProjectReferences(projectId),
      assets: this.database.prepare(
        `SELECT DISTINCT a.* FROM assets a
         JOIN character_references r ON r.asset_id = a.id
         JOIN characters c ON c.id = r.character_id
         WHERE c.project_id = ? ORDER BY a.created_at, a.id`,
      ).all(projectId).map(mapAsset),
      asset_derivations: this.database.prepare(
        `SELECT d.* FROM character_asset_derivations d
         JOIN assets a ON a.id = d.asset_id
         WHERE a.project_id = ? ORDER BY d.created_at, d.asset_id`,
      ).all(projectId) as CharacterCatalog['asset_derivations'],
    }))();
  }

  createReference(projectId: string, characterId: string,
    input: CreateCharacterReferenceInput): CharacterReference {
    return createCharacterReference(this.database, projectId, characterId, input);
  }

  updateReference(projectId: string, characterId: string,
    input: UpdateCharacterReferenceInput): CharacterReference {
    return updateCharacterReference(this.database, projectId, characterId, input);
  }
}
