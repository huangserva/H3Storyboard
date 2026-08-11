import type {
  CreateModeInput,
  Mode,
  UpdateModeInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { createMode, listModes, updateMode } from './mode-operations.js';

export class ModeStore {
  constructor(private readonly database: Database.Database) {}

  list(): Mode[] {
    return listModes(this.database);
  }

  create(input: CreateModeInput): Mode {
    return createMode(this.database, input);
  }

  update(input: UpdateModeInput): Mode {
    return updateMode(this.database, input);
  }
}
