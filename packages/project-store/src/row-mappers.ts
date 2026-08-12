import {
  AssetSchema,
  CanvasNodeSchema,
  CharacterReferenceSchema,
  CharacterSchema,
  H3JobSchema,
  JobEventSchema,
  ModeSchema,
  ProductionBriefSchema,
  ProjectGenerationLockSchema,
  ProjectSchema,
  ScriptVersionSchema,
  ShotActualSchema,
  ShotPlanSchema,
  type Asset,
  type CanvasNode,
  type Character,
  type CharacterReference,
  type H3Job,
  type JobEvent,
  type Mode,
  type ProductionBrief,
  type ProjectGenerationLock,
  type Project,
  type ScriptVersion,
  type ShotActual,
  type ShotPlan,
} from '@h3storyboard/protocol';
import { StoreError } from './errors.js';

interface SafeParser<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown } };
}

function decode<T>(parser: SafeParser<T>, row: unknown): T {
  const result = parser.safeParse(row);
  if (!result.success) {
    throw new StoreError(
      'DATABASE_RECORD_INVALID',
      'A persisted record does not match the current protocol',
      result.error.issues,
    );
  }
  return result.data;
}

function objectRow(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new StoreError(
      'DATABASE_RECORD_INVALID',
      'Expected a database row object',
    );
  }
  return row as Record<string, unknown>;
}

function jsonColumn(row: Record<string, unknown>, column: string): unknown {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new StoreError(
      'DATABASE_RECORD_INVALID',
      `Expected ${column} to contain JSON`,
    );
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new StoreError(
      'DATABASE_RECORD_INVALID',
      `Could not decode ${column}`,
      error,
    );
  }
}

export const mapProject = (row: unknown): Project =>
  decode(ProjectSchema, objectRow(row));

export const mapScriptVersion = (row: unknown): ScriptVersion =>
  decode(ScriptVersionSchema, objectRow(row));

export function mapAsset(row: unknown): Asset {
  const record = objectRow(row);
  return decode(AssetSchema, {
    ...record,
    uri: record.uri ?? record.relative_path,
    content_hash: record.content_hash === '' ? null : record.content_hash,
    status: record.status ?? 'approved',
    replaces_asset_id: record.replaces_asset_id ?? null,
    updated_at: record.updated_at ?? record.created_at,
  });
}

export const mapCanvasNode = (row: unknown): CanvasNode =>
  decode(CanvasNodeSchema, objectRow(row));

export function mapCharacter(row: unknown): Character {
  const record = objectRow(row);
  return decode(CharacterSchema, {
    ...record,
    seed_family: jsonColumn(record, 'seed_family_json'),
  });
}

export const mapCharacterReference = (row: unknown): CharacterReference =>
  decode(CharacterReferenceSchema, objectRow(row));

export function mapShotPlan(row: unknown): ShotPlan {
  const record = objectRow(row);
  return decode(ShotPlanSchema, {
    ...record,
    continuity_dependencies: jsonColumn(
      record,
      'continuity_dependencies_json',
    ),
    costume_state: jsonColumn(record, 'costume_state_json'),
    reference_bindings: jsonColumn(record, 'reference_bindings_json'),
    semantic_references: record.semantic_references_json == null ? [] :
      jsonColumn(record, 'semantic_references_json'),
    opening_state: record.opening_state_json == null ? null :
      jsonColumn(record, 'opening_state_json'),
    ending_state: record.ending_state_json == null ? null :
      jsonColumn(record, 'ending_state_json'),
  });
}

export function mapShotActual(row: unknown): ShotActual {
  const record = objectRow(row);
  return decode(ShotActualSchema, {
    ...record,
    is_representative: record.is_representative === 1,
    representative_status: record.representative_status ?? 'none',
    approved_at: record.approved_at ?? null,
  });
}

export function mapH3Job(row: unknown): H3Job {
  const record = objectRow(row);
  return decode(H3JobSchema, {
    ...record,
    input_bindings: jsonColumn(record, 'input_bindings_json'),
    lock_snapshot: record.lock_snapshot_json === null ||
      record.lock_snapshot_json === undefined
      ? null : jsonColumn(record, 'lock_snapshot_json'),
    compiled_bindings: record.compiled_bindings_json == null ? null :
      jsonColumn(record, 'compiled_bindings_json'),
    gate_override_reason: record.gate_override_reason ?? null,
    cancel_reason: record.cancel_reason ?? null,
    provider_client_id: record.provider_client_id ?? null,
  });
}

export function mapProductionBrief(row: unknown): ProductionBrief {
  const record = objectRow(row);
  return decode(ProductionBriefSchema, {
    ...record,
    body: jsonColumn(record, 'body_json'),
  });
}

export function mapGenerationLock(row: unknown): ProjectGenerationLock {
  const record = objectRow(row);
  return decode(ProjectGenerationLockSchema, {
    ...record,
    engaged: record.engaged === 1,
  });
}

export const mapJobEvent = (row: unknown): JobEvent =>
  decode(JobEventSchema, objectRow(row));

export function mapMode(row: unknown): Mode {
  const record = objectRow(row);
  return decode(ModeSchema, {
    ...record,
    capability_declaration: jsonColumn(record, 'capability_declaration_json'),
  });
}
