import type {
  Character,
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
  updateCharacterReference } from './character-reference-operations.js';

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

  createReference(projectId: string, characterId: string,
    input: CreateCharacterReferenceInput): CharacterReference {
    return createCharacterReference(this.database, projectId, characterId, input);
  }

  updateReference(projectId: string, characterId: string,
    input: UpdateCharacterReferenceInput): CharacterReference {
    return updateCharacterReference(this.database, projectId, characterId, input);
  }
}
