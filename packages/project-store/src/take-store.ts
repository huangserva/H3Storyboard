import type {
  MarkRepresentativeInput,
  ReviewRepresentativeInput,
  ShotActual,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { markRepresentative, reviewRepresentative } from
  './representative-operations.js';

export class TakeStore {
  constructor(private readonly db: Database.Database) {}

  markRepresentative(actualId: string,
    input: MarkRepresentativeInput): ShotActual {
    return markRepresentative(this.db, actualId, input);
  }

  reviewRepresentative(actualId: string,
    input: ReviewRepresentativeInput): ShotActual {
    return reviewRepresentative(this.db, actualId, input);
  }
}
