import {
  CompileScriptInputSchema,
  ImportScriptInputSchema,
  LockScriptInputSchema,
  UpdateScriptDocumentInputSchema,
  type CompileScriptInput,
  type ImportScriptInput,
  type GenerateScriptInput,
  type GeneratedShuohaoScript,
  type LockScriptInput,
  type ScriptCompilationResult,
  type ScriptDocument,
  type ScriptValidation,
  type ScriptVersion,
  type ScriptGenerationMetadata,
  type ShotPlan,
  type UpdateScriptDocumentInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { compileScriptScenes } from './script-compiler.js';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked } from './generation-locks.js';
import { parseInput } from './input.js';
import {
  importGeneratedScriptScenes,
  importScriptScenes,
} from './script-import.js';
import { mapScriptCompilation, mapShotPlan } from './row-mappers.js';
import {
  assertUniqueDocumentIds,
  formatScriptContent,
  getScriptDocument,
  insertScriptScenes,
  listScriptVersions,
} from './script-persistence.js';
import { validateScript } from './script-validation.js';
import { requireProject } from './store-guards.js';

export class ScriptStore {
  constructor(private readonly database: Database.Database) {}

  listVersions(projectId: string): ScriptVersion[] {
    requireProject(this.database, projectId);
    return listScriptVersions(this.database, projectId);
  }

  getDocument(projectId: string, scriptVersionId: string): ScriptDocument {
    requireProject(this.database, projectId);
    return getScriptDocument(this.database, projectId, scriptVersionId);
  }

  import(projectId: string, rawInput: ImportScriptInput): ScriptDocument {
    const input = parseInput(ImportScriptInputSchema, rawInput);
    const scenes = importScriptScenes(input);
    assertUniqueDocumentIds(scenes);
    return this.createDraft(projectId, input, scenes, null);
  }

  importGenerated(projectId: string, rawInput: ImportScriptInput,
    script: GeneratedShuohaoScript,
    generation: Pick<ScriptGenerationMetadata, 'provider' | 'model' | 'review'> &
    { input: GenerateScriptInput },
  ): ScriptDocument {
    const input = parseInput(ImportScriptInputSchema, rawInput);
    if (input.format !== 'shuohao_novel_script') throw new StoreError(
      'SCRIPT_IMPORT_INVALID',
      'AI generated scripts must use the Shuohao novel-script format',
    );
    const scenes = importGeneratedScriptScenes(script);
    assertUniqueDocumentIds(scenes);
    if (!generation.provider.trim() || !generation.model.trim()) {
      throw new StoreError('INPUT_INVALID',
        'AI generation provenance requires provider and model');
    }
    return this.createDraft(projectId, input, scenes, {
      ...generation,
      source_content: input.content,
    });
  }

  private createDraft(projectId: string, input: ImportScriptInput,
    scenes: ReturnType<typeof importScriptScenes>,
    generation: Pick<ScriptGenerationMetadata,
    'provider' | 'model' | 'review'> & {
      input: GenerateScriptInput;
      source_content: string;
    } | null,
  ): ScriptDocument {
    return this.database.transaction(() => {
      const project = requireProject(this.database, projectId);
      requireGenerationUnlocked(this.database, projectId);
      if (this.database.prepare(`SELECT 1 FROM script_versions
        WHERE project_id = ? AND status = 'draft'`).get(projectId)) {
        throw new StoreError('SCRIPT_DRAFT_EXISTS',
          'Project already has an editable script draft', { project_id: projectId });
      }
      const version = (this.database.prepare(`SELECT COALESCE(MAX(version), 0) + 1
        AS version FROM script_versions WHERE project_id = ?`).get(projectId) as
        { version: number }).version;
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`INSERT INTO script_versions
        (id, project_id, version, title, content, status, source_format,
         generation_provider, generation_model, parent_version_id,
         generation_review_json, generation_input_json,
         generation_source_content, created_at, updated_at, locked_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
        id, projectId, version, input.title, input.content, input.format,
        generation?.provider ?? null, generation?.model ?? null,
        project.active_script_version_id,
        generation ? JSON.stringify(generation.review) : null,
        generation ? JSON.stringify(generation.input) : null,
        generation?.source_content ?? null, now, now);
      insertScriptScenes(this.database, id, scenes, now);
      return getScriptDocument(this.database, projectId, id);
    }).immediate();
  }

  update(projectId: string, scriptVersionId: string,
    rawInput: UpdateScriptDocumentInput): ScriptDocument {
    const input = parseInput(UpdateScriptDocumentInputSchema, rawInput);
    assertUniqueDocumentIds(input.scenes);
    return this.database.transaction(() => {
      const document = getScriptDocument(this.database, projectId, scriptVersionId);
      requireGenerationUnlocked(this.database, projectId);
      requireDraft(document);
      const now = new Date().toISOString();
      const claimed = this.database.prepare(`UPDATE script_versions
        SET title = ?, content = ?, source_format = 'plain_text', updated_at = ?,
            revision = revision + 1
        WHERE id = ? AND revision = ?`).run(input.title,
        formatScriptContent(input.scenes), now, scriptVersionId,
        input.expected_revision);
      if (claimed.changes !== 1) throw new StoreError(
        'SCRIPT_VERSION_CONFLICT',
        'Script draft changed after this editor loaded it', {
          script_version_id: scriptVersionId,
          expected_revision: input.expected_revision,
          current_revision: document.version.revision,
        });
      this.database.prepare('DELETE FROM script_scenes WHERE script_version_id = ?')
        .run(scriptVersionId);
      insertScriptScenes(this.database, scriptVersionId, input.scenes, now);
      return getScriptDocument(this.database, projectId, scriptVersionId);
    }).immediate();
  }

  validate(projectId: string, scriptVersionId: string): ScriptValidation {
    const document = this.getDocument(projectId, scriptVersionId);
    return validateScript(document.version.id, document.scenes);
  }

  lock(projectId: string, scriptVersionId: string,
    rawInput: LockScriptInput): ScriptDocument {
    const input = parseInput(LockScriptInputSchema, rawInput);
    return this.database.transaction(() => {
      const document = getScriptDocument(this.database, projectId, scriptVersionId);
      requireGenerationUnlocked(this.database, projectId);
      requireDraft(document);
      if (document.version.revision !== input.expected_revision) {
        throw new StoreError('SCRIPT_VERSION_CONFLICT',
          'Script draft changed after this editor loaded it', {
            script_version_id: scriptVersionId,
            expected_revision: input.expected_revision,
            current_revision: document.version.revision,
          });
      }
      const validation = validateScript(scriptVersionId, document.scenes);
      if (!validation.valid) throw new StoreError('SCRIPT_VALIDATION_FAILED',
        'Script must pass deterministic validation before locking', validation);
      const project = requireProject(this.database, projectId);
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE script_versions SET status = 'superseded',
        updated_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'locked'`)
        .run(now, project.active_script_version_id);
      const review = document.version.generation_review;
      const lockedReview = review &&
        review.reviewed_revision === document.version.revision
        ? { ...review, reviewed_revision: document.version.revision + 1 }
        : review;
      this.database.prepare(`UPDATE script_versions SET status = 'locked',
        locked_at = ?, updated_at = ?, generation_review_json = ?,
        revision = revision + 1 WHERE id = ?`)
        .run(now, now, lockedReview ? JSON.stringify(lockedReview) : null,
          scriptVersionId);
      this.database.prepare(`UPDATE projects SET active_script_version_id = ?,
        updated_at = ? WHERE id = ?`).run(scriptVersionId, now, projectId);
      return getScriptDocument(this.database, projectId, scriptVersionId);
    }).immediate();
  }

  compile(projectId: string, scriptVersionId: string,
    rawInput: CompileScriptInput): ScriptCompilationResult {
    const input = parseInput(CompileScriptInputSchema, rawInput);
    return this.database.transaction(() => {
      const document = getScriptDocument(this.database, projectId, scriptVersionId);
      const project = requireProject(this.database, projectId);
      const existing = this.database.prepare(`SELECT * FROM script_compilations
        WHERE script_version_id = ? AND idempotency_key = ?`)
        .get(scriptVersionId, input.idempotency_key);
      if (existing) return this.compilationResult(existing);
      const conflicting = this.database.prepare(`SELECT id, idempotency_key
        FROM script_compilations WHERE script_version_id = ?`).get(
        scriptVersionId) as { id: string; idempotency_key: string } | undefined;
      if (conflicting) throw new StoreError('SCRIPT_COMPILATION_CONFLICT',
        'Locked script version was already compiled with another request key', {
          script_version_id: scriptVersionId,
          compilation_id: conflicting.id,
        });
      if (document.version.status !== 'locked' ||
        project.active_script_version_id !== scriptVersionId) {
        throw new StoreError('SCRIPT_NOT_LOCKED',
          'Only the active locked script can compile ShotPlans');
      }
      const validation = validateScript(scriptVersionId, document.scenes);
      if (!validation.valid) throw new StoreError('SCRIPT_VALIDATION_FAILED',
        'Script must remain valid before compilation', validation);
      const shots = compileScriptScenes(document.scenes);
      const compilationId = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`INSERT INTO script_compilations
        (id, project_id, script_version_id, idempotency_key, shot_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(compilationId, projectId, scriptVersionId,
        input.idempotency_key, shots.length, now);
      let ordinal = (this.database.prepare(`SELECT COALESCE(MAX(ordinal), 0)
        AS ordinal FROM shot_plans WHERE project_id = ?`).get(projectId) as
        { ordinal: number }).ordinal;
      const insert = this.database.prepare(`INSERT INTO shot_plans
        (id, project_id, script_version_id, ordinal, title, scene_id,
         duration_seconds, shot_size, camera_movement, action, dialogue, sound,
         prompt, continuity_mode, continuity_dependencies_json,
         costume_state_json, position_state_json, prop_state_json,
         reference_bindings_json, semantic_references_json,
         opening_state_json, ending_state_json, planning_status,
         source_script_scene_id, source_script_beat_ids_json,
         source_compilation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'medium', 'locked', ?, ?, '', '',
          'independent', '[]', ?, ?, ?, '[]', '[]', NULL, NULL, 'draft',
          ?, ?, ?, ?, ?)`);
      for (const shot of shots) {
        ordinal += 1;
        insert.run(randomUUID(), projectId, scriptVersionId, ordinal, shot.title,
          shot.scene.scene_key, shot.duration_seconds, shot.action, shot.dialogue,
          JSON.stringify(shot.costume_state), JSON.stringify(shot.position_state),
          JSON.stringify(shot.prop_state), shot.scene.id,
          JSON.stringify(shot.beat_ids), compilationId, now, now);
      }
      this.database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(now, projectId);
      return this.compilationResult(this.database.prepare(
        'SELECT * FROM script_compilations WHERE id = ?').get(compilationId));
    }).immediate();
  }

  private compilationResult(row: unknown): ScriptCompilationResult {
    const compilation = mapScriptCompilation(row);
    const shotPlans = this.database.prepare(`SELECT * FROM shot_plans
      WHERE source_compilation_id = ? ORDER BY ordinal`).all(compilation.id)
      .map(mapShotPlan);
    return { compilation, shot_plans: shotPlans };
  }
}

function requireDraft(document: ScriptDocument): void {
  if (document.version.status !== 'draft') throw new StoreError(
    'SCRIPT_VERSION_IMMUTABLE', 'Only a draft script version can be edited', {
      script_version_id: document.version.id, status: document.version.status,
    });
}
