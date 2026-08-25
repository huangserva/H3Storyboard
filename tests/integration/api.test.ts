import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssetSchema,
  CanvasNodeSchema,
  CharacterReferenceSchema,
  CharacterSchema,
  CompiledBindingsResultSchema,
  CurrentAssetsManifestSnapshotSchema,
  H3JobSchema,
  ModeSchema,
  ProductionBriefSchema,
  ProjectGenerationLockSchema,
  ProjectSchema,
  ProjectSnapshotSchema,
  ShotActualSchema,
  ShotPlanSchema,
} from '../../packages/protocol/src/index.js';
import { openProjectStore } from '../../packages/project-store/src/index.js';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createApiServer,
  type ApiServer,
} from '../../apps/api/src/server.js';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const servers = new Set<ApiServer>();
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
});

describe('H3Storyboard HTTP and SQLite integration', () => {
  test('persists the script, planned shot, asset, and draft job across a server restart', async () => {
    const databasePath = await temporaryDatabasePath();
    const first = await startApi(databasePath);

    const health = await fetch(`${first.origin}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      data: { status: 'ok', protocol_version: '1.8' },
    });

    const projectResponse = await postJson(`${first.origin}/api/projects`, {
      title: 'Night Train',
      script_title: 'The final carriage',
      script_content:
        'A conductor crosses the final carriage while the city disappears into fog.',
    });
    expect(projectResponse.status).toBe(201);
    const project = ProjectSchema.parse(
      (await projectResponse.json() as { data: unknown }).data,
    );

    const shotResponse = await postJson(
      `${first.origin}/api/projects/${project.id}/shots`,
      validShotInput(),
    );
    expect(shotResponse.status).toBe(201);
    let shot = ShotPlanSchema.parse(
      (await shotResponse.json() as { data: unknown }).data,
    );

    const assetResponse = await postJson(
      `${first.origin}/api/projects/${project.id}/assets`,
      {
        kind: 'image',
        name: 'Conductor first frame',
        relative_path: 'assets/conductor-first-frame.png',
        content_hash: 'sha256:conductor-first-frame',
      },
    );
    expect(assetResponse.status).toBe(201);
    const asset = AssetSchema.parse(
      (await assetResponse.json() as { data: unknown }).data,
    );

    const jobInput = {
      mode: 'i2v',
      provider: 'local_comfyui',
      model: 'HunyuanVideo-H3',
      prompt: 'The conductor walks through a softly swaying night carriage.',
      duration_seconds: 8,
      seed: 42,
      steps: 24,
      idempotency_key: 'night-train-shot-1-take-1',
      input_bindings: [
        {
          asset_id: asset.id,
          asset_kind: 'image',
          role: 'first_frame',
          ordinal: 0,
        },
      ],
    };
    const semanticPatch = await patchJson(`${first.origin}/api/shots/${shot.id}`, {
      semantic_references: [{ purpose: 'first_frame',
        target: { type: 'asset', asset_id: asset.id } }],
    });
    expect(semanticPatch.status).toBe(200);
    shot = ShotPlanSchema.parse(
      (await semanticPatch.json() as { data: unknown }).data,
    );
    await prepareApiGenerationContext(first.origin, project.id, [asset.id]);
    const jobResponses = await Promise.all(
      Array.from({ length: 20 }, () =>
        postJson(`${first.origin}/api/shots/${shot.id}/jobs`, jobInput),
      ),
    );
    expect(jobResponses.every(({ status }) => status === 201)).toBe(true);
    const jobs = await Promise.all(
      jobResponses.map(async (response) =>
        H3JobSchema.parse(
          (await response.json() as { data: unknown }).data,
        ),
      ),
    );
    expect(new Set(jobs.map(({ id }) => id)).size).toBe(1);
    const job = jobs[0]!;
    expect(job.status).toBe('draft');

    const conflictingJob = await postJson(
      `${first.origin}/api/shots/${shot.id}/jobs`,
      { ...jobInput, prompt: 'A conflicting request with the same key.' },
    );
    await expectError(conflictingJob, 409, 'IDEMPOTENCY_KEY_REUSED');

    const outputResponse = await postJson(
      `${first.origin}/api/projects/${project.id}/assets`,
      {
        kind: 'video',
        name: 'Conductor take 1',
        relative_path: 'outputs/conductor-take-1.mp4',
        content_hash: 'sha256:conductor-take-1',
      },
    );
    const output = AssetSchema.parse(
      (await outputResponse.json() as { data: unknown }).data,
    );
    const worker = openProjectStore(databasePath);
    const claimed = worker.claimH3Job(job.id);
    worker.markH3JobQueued(job.id, claimed.lease_token!, 'provider-job-1');
    worker.markH3JobRunning(job.id, claimed.lease_token!);
    worker.completeH3Job(job.id, claimed.lease_token!, output.id);
    worker.close();

    const preapprovedActual = await postJson(
      `${first.origin}/api/shots/${shot.id}/actuals`,
      {
        job_id: job.id,
        output_asset_id: output.id,
        observed_description: 'This take tries to bypass explicit review.',
        deviation_notes: '',
        qc_verdict: 'approved',
      },
    );
    await expectError(preapprovedActual, 400, 'VALIDATION_FAILED');
    const wrongOutputActual = await postJson(
      `${first.origin}/api/shots/${shot.id}/actuals`,
      {
        job_id: job.id,
        output_asset_id: asset.id,
        observed_description: 'This take points at the wrong output asset.',
        deviation_notes: '',
        qc_verdict: 'pending',
      },
    );
    await expectError(wrongOutputActual, 422, 'H3_JOB_OUTPUT_MISMATCH');

    const actualResponse = await postJson(
      `${first.origin}/api/shots/${shot.id}/actuals`,
      {
        job_id: job.id,
        output_asset_id: output.id,
        observed_description: 'The conductor crosses frame with stable identity.',
        deviation_notes: '',
        qc_verdict: 'pending',
      },
    );
    expect(actualResponse.status).toBe(201);
    const actual = ShotActualSchema.parse(
      (await actualResponse.json() as { data: unknown }).data,
    );
    const conflictingActual = await postJson(
      `${first.origin}/api/shots/${shot.id}/actuals`,
      {
        job_id: job.id,
        output_asset_id: output.id,
        observed_description: 'A conflicting observation for the same job.',
        deviation_notes: '',
        qc_verdict: 'pending',
      },
    );
    await expectError(conflictingActual, 409, 'SHOT_ACTUAL_CONFLICT');
    const reviewResponse = await postJson(
      `${first.origin}/api/actuals/${actual.id}/review`,
      { qc_verdict: 'approved', deviation_notes: 'Matches the plan.' },
    );
    expect(reviewResponse.status).toBe(200);
    const approved = ShotActualSchema.parse(
      (await reviewResponse.json() as { data: unknown }).data,
    );
    expect(approved.qc_verdict).toBe('approved');
    const duplicateReview = await postJson(
      `${first.origin}/api/actuals/${actual.id}/review`,
      { qc_verdict: 'rejected' },
    );
    await expectError(duplicateReview, 422, 'QC_VERDICT_INVALID');

    const boundaryResponse = await postJson(
      `${first.origin}/api/projects/${project.id}/assets`,
      {
        kind: 'image',
        name: 'Conductor approved last frame',
        relative_path: 'outputs/conductor-take-1-last.png',
        content_hash: 'sha256:conductor-take-1-last',
        derived_from_asset_id: output.id,
        derivation_kind: 'last_frame',
      },
    );
    const boundary = AssetSchema.parse(
      (await boundaryResponse.json() as { data: unknown }).data,
    );
    const continuedShotResponse = await postJson(
      `${first.origin}/api/projects/${project.id}/shots`,
      {
        ...validShotInput(),
        title: 'Carriage exit',
        continuity_mode: 'visual_match',
        continuity_dependencies: [
          {
            source_shot_plan_id: shot.id,
            source_take_id: actual.id,
            reference_asset_id: boundary.id,
            boundary: 'last_frame',
          },
        ],
        reference_bindings: [
          {
            asset_id: boundary.id,
            asset_kind: 'image',
            role: 'first_frame',
            ordinal: 0,
          },
        ],
      },
    );
    expect(continuedShotResponse.status).toBe(201);
    const continuedShot = ShotPlanSchema.parse(
      (await continuedShotResponse.json() as { data: unknown }).data,
    );
    expect((await putJson(
      `${first.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: false },
    )).status).toBe(200);
    expect((await patchJson(
      `${first.origin}/api/projects/${project.id}/assets`,
      { asset_id: boundary.id, status: 'approved' },
    )).status).toBe(200);
    expect((await postJson(
      `${first.origin}/api/projects/${project.id}/manifests`, {},
    )).status).toBe(201);
    expect((await patchJson(`${first.origin}/api/shots/${continuedShot.id}`, {
      semantic_references: [{ purpose: 'first_frame',
        target: { type: 'asset', asset_id: boundary.id } }],
    })).status).toBe(200);
    expect((await putJson(
      `${first.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: true, reason: 'Continue approved take' },
    )).status).toBe(200);

    const continuityDropped = await postJson(
      `${first.origin}/api/shots/${continuedShot.id}/jobs`,
      h3JobInput('t2v', 'continued-shot-without-boundary', []),
    );
    await expectError(continuityDropped, 422, 'H3_BINDINGS_INVALID');
    const continuedJobResponse = await postJson(
      `${first.origin}/api/shots/${continuedShot.id}/jobs`,
      h3JobInput('i2v', 'continued-shot-with-boundary', [
        {
          asset_id: boundary.id,
          asset_kind: 'image',
          role: 'first_frame',
          ordinal: 0,
        },
      ]),
    );
    expect(continuedJobResponse.status).toBe(201);
    const continuedJob = H3JobSchema.parse(
      (await continuedJobResponse.json() as { data: unknown }).data,
    );
    const unfinishedActual = await postJson(
      `${first.origin}/api/shots/${continuedShot.id}/actuals`,
      {
        job_id: continuedJob.id,
        output_asset_id: output.id,
        observed_description: 'A draft job cannot become a take.',
        deviation_notes: '',
        qc_verdict: 'pending',
      },
    );
    await expectError(unfinishedActual, 409, 'H3_JOB_NOT_COMPLETED');
    const crossShotActual = await postJson(
      `${first.origin}/api/shots/${continuedShot.id}/actuals`,
      {
        job_id: job.id,
        output_asset_id: output.id,
        observed_description: 'A job cannot become another shot’s take.',
        deviation_notes: '',
        qc_verdict: 'pending',
      },
    );
    await expectError(crossShotActual, 422, 'H3_JOB_SHOT_MISMATCH');

    const beforeRestart = await getSnapshot(first.origin, project.id);
    expect(beforeRestart.script_version.status).toBe('locked');
    expect(beforeRestart.shot_plans[0]).toEqual(shot);
    expect(beforeRestart.shot_plans.map(({ id }) => id)).toEqual([
      shot.id,
      continuedShot.id,
    ]);
    expect(new Set(beforeRestart.assets.map(({ id }) => id))).toEqual(
      new Set([asset.id, output.id, boundary.id]),
    );
    expect(beforeRestart.h3_jobs.map(({ id }) => id)).toEqual([
      job.id,
      continuedJob.id,
    ]);
    expect(beforeRestart.shot_actuals).toEqual([approved]);
    expect(
      beforeRestart.assets.find(({ id }) => id === output.id)?.producer_job_id,
    ).toBe(job.id);

    await closeApi(first.server);
    const second = await startApi(databasePath);
    const afterRestart = await getSnapshot(second.origin, project.id);

    expect(afterRestart).toEqual(beforeRestart);
    expect(afterRestart.shot_plans[0]?.prompt).toContain('locked-off camera');
    expect(afterRestart.shot_actuals).toEqual([approved]);

    const listResponse = await fetch(`${second.origin}/api/projects`);
    expect(listResponse.status).toBe(200);
    const listedProjects = ProjectSchema.array().parse(
      (await listResponse.json() as { data: unknown }).data,
    );
    expect(listedProjects).toEqual([afterRestart.project]);
  });

  test('rejects an incomplete script and an out-of-range shot duration', async () => {
    const databasePath = await temporaryDatabasePath();
    const api = await startApi(databasePath);

    const shortScript = await postJson(`${api.origin}/api/projects`, {
      title: 'Incomplete',
      script_title: 'Fragment',
      script_content: 'Too short',
    });
    await expectError(shortScript, 400, 'VALIDATION_FAILED');

    const projectResponse = await postJson(`${api.origin}/api/projects`, {
      title: 'Valid project',
      script_title: 'Locked full script',
      script_content:
        'The complete scene establishes enough story context for a locked first version.',
    });
    const project = ProjectSchema.parse(
      (await projectResponse.json() as { data: unknown }).data,
    );

    const badDuration = await postJson(
      `${api.origin}/api/projects/${project.id}/shots`,
      { ...validShotInput(), duration_seconds: 3 },
    );
    await expectError(badDuration, 400, 'VALIDATION_FAILED');

    const snapshot = await getSnapshot(api.origin, project.id);
    expect(snapshot.shot_plans).toEqual([]);
  });

  test('persists all six H3 modes and rolls back invalid or foreign bindings', async () => {
    const databasePath = await temporaryDatabasePath();
    const api = await startApi(databasePath);
    const projectResponse = await postJson(`${api.origin}/api/projects`, {
      title: 'Six H3 modes',
      script_title: 'Reference contract',
      script_content:
        'A complete scene exercises every H3 reference mode without changing projects.',
    });
    const project = ProjectSchema.parse(
      (await projectResponse.json() as { data: unknown }).data,
    );
    const shotResponse = await postJson(
      `${api.origin}/api/projects/${project.id}/shots`,
      validShotInput(),
    );
    const shot = ShotPlanSchema.parse(
      (await shotResponse.json() as { data: unknown }).data,
    );
    const first = await createAssetViaApi(api.origin, project.id, {
      kind: 'image',
      name: 'first.png',
      relative_path: 'refs/first.png',
      content_hash: 'sha256:first',
    });
    const last = await createAssetViaApi(api.origin, project.id, {
      kind: 'image',
      name: 'last.png',
      relative_path: 'refs/last.png',
      content_hash: 'sha256:last',
    });
    const motion = await createAssetViaApi(api.origin, project.id, {
      kind: 'video',
      name: 'motion.mp4',
      relative_path: 'refs/motion.mp4',
      content_hash: 'sha256:motion',
    });
    const imageBinding = {
      asset_id: first.id,
      asset_kind: 'image',
      role: 'first_frame',
      ordinal: 0,
    };
    const lastBinding = {
      asset_id: last.id,
      asset_kind: 'image',
      role: 'last_frame',
      ordinal: 1,
    };
    const characterBinding = {
      ...imageBinding,
      role: 'character',
    };
    const motionBinding = {
      asset_id: motion.id,
      asset_kind: 'video',
      role: 'motion',
      ordinal: 0,
    };
    const cases = [
      ['t2v', []],
      ['i2v', [imageBinding]],
      ['fl2v', [imageBinding, lastBinding]],
      ['r2v', [characterBinding]],
      ['v2v', [motionBinding]],
      ['rv2v', [characterBinding, { ...motionBinding, ordinal: 1 }]],
    ] as const;

    await prepareApiGenerationContext(api.origin, project.id,
      [first.id, last.id, motion.id]);

    for (const [mode, inputBindings] of cases) {
      const semantic_references = mode === 't2v' ? [] : mode === 'i2v'
        ? [{ purpose: 'first_frame', target: { type: 'asset', asset_id: first.id } }]
        : mode === 'fl2v' ? [
          { purpose: 'first_frame', target: { type: 'asset', asset_id: first.id } },
          { purpose: 'last_frame', target: { type: 'asset', asset_id: last.id } },
        ] : mode === 'r2v' ? [{ purpose: 'reference_character',
          target: { type: 'asset', asset_id: first.id } }] : [];
      expect((await putJson(
        `${api.origin}/api/projects/${project.id}/generation_lock`,
        { engaged: false })).status).toBe(200);
      const semanticPatch = await patchJson(`${api.origin}/api/shots/${shot.id}`,
        { semantic_references });
      expect(semanticPatch.status).toBe(200);
      expect((await putJson(
        `${api.origin}/api/projects/${project.id}/generation_lock`,
        { engaged: true, reason: `Compile ${mode} test` })).status).toBe(200);
      const response = await postJson(
        `${api.origin}/api/shots/${shot.id}/jobs`,
        h3JobInput(mode, `six-modes-${mode}`, inputBindings),
      );
      expect(response.status).toBe(201);
      const created = H3JobSchema.parse(
        (await response.json() as { data: unknown }).data,
      );
      expect(created.mode).toBe(mode);
      expect(created.input_bindings).toEqual(inputBindings);
      expect(created.compiled_bindings).toEqual(
        mode === 'v2v' || mode === 'rv2v' ? null : expect.any(Array));
    }
    expect((await getSnapshot(api.origin, project.id)).h3_jobs).toHaveLength(6);

    const invalidFl2v = await postJson(
      `${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('fl2v', 'invalid-fl2v', [imageBinding]),
    );
    await expectError(invalidFl2v, 422, 'H3_BINDINGS_INVALID');
    expect((await getSnapshot(api.origin, project.id)).h3_jobs).toHaveLength(6);

    const foreignProjectResponse = await postJson(
      `${api.origin}/api/projects`,
      {
        title: 'Foreign project',
        script_title: 'Separate script',
        script_content:
          'A separate complete script must not be allowed to borrow foreign assets.',
      },
    );
    const foreignProject = ProjectSchema.parse(
      (await foreignProjectResponse.json() as { data: unknown }).data,
    );
    const foreignShotResponse = await postJson(
      `${api.origin}/api/projects/${foreignProject.id}/shots`,
      validShotInput(),
    );
    const foreignShot = ShotPlanSchema.parse(
      (await foreignShotResponse.json() as { data: unknown }).data,
    );
    await prepareApiGenerationContext(api.origin, foreignProject.id, []);
    const foreignBinding = await postJson(
      `${api.origin}/api/shots/${foreignShot.id}/jobs`,
      h3JobInput('i2v', 'foreign-reference', [imageBinding]),
    );
    await expectError(foreignBinding, 422, 'ASSET_PROJECT_MISMATCH');
    expect((await getSnapshot(api.origin, foreignProject.id)).h3_jobs).toEqual(
      [],
    );
  });

  test('returns a stable not-found error without creating orphan records', async () => {
    const databasePath = await temporaryDatabasePath();
    const api = await startApi(databasePath);
    const missingProjectId = randomUUID();

    const missingSnapshot = await fetch(
      `${api.origin}/api/projects/${missingProjectId}`,
    );
    await expectError(missingSnapshot, 404, 'PROJECT_NOT_FOUND');

    const orphanShot = await postJson(
      `${api.origin}/api/projects/${missingProjectId}/shots`,
      validShotInput(),
    );
    await expectError(orphanShot, 404, 'PROJECT_NOT_FOUND');

    const listResponse = await fetch(`${api.origin}/api/projects`);
    expect(await listResponse.json()).toEqual({ data: [] });

    await closeApi(api.server);
    const database = new Database(databasePath, { readonly: true });
    const tableCounts = Object.fromEntries(
      ['projects', 'script_versions', 'shot_plans', 'h3_jobs'].map((table) => [
        table,
        (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }).count,
      ]),
    );
    database.close();
    expect(tableCounts).toEqual({
      projects: 0,
      script_versions: 0,
      shot_plans: 0,
      h3_jobs: 0,
    });
  });

  test('persists canvas node CRUD and rejects unsupported nodes or projects', async () => {
    const databasePath = await temporaryDatabasePath();
    const first = await startApi(databasePath);
    const projectResponse = await postJson(`${first.origin}/api/projects`, {
      title: 'Canvas persistence',
      script_title: 'Canvas layout script',
      script_content:
        'A complete script provides a real project and shot for canvas persistence.',
    });
    const project = ProjectSchema.parse(
      (await projectResponse.json() as { data: unknown }).data,
    );
    const shotResponse = await postJson(
      `${first.origin}/api/projects/${project.id}/shots`,
      validShotInput(),
    );
    const shot = ShotPlanSchema.parse(
      (await shotResponse.json() as { data: unknown }).data,
    );

    const emptyResponse = await fetch(
      `${first.origin}/api/projects/${project.id}/canvas_nodes`,
    );
    expect(emptyResponse.status).toBe(200);
    expect(await emptyResponse.json()).toEqual({ data: [] });

    const createResponse = await postJson(
      `${first.origin}/api/projects/${project.id}/canvas_nodes`,
      {
        node_type: 'shot_plan',
        ref_id: shot.id,
        x: 80,
        y: 100,
        width: 260,
        height: 196,
        z_index: 1,
      },
    );
    expect(createResponse.status).toBe(201);
    const created = CanvasNodeSchema.parse(
      (await createResponse.json() as { data: unknown }).data,
    );
    expect(created).toMatchObject({
      project_id: project.id,
      node_type: 'shot_plan',
      ref_id: shot.id,
      x: 80,
      y: 100,
      width: 260,
      height: 196,
      z_index: 1,
    });

    const updateResponse = await patchJson(
      `${first.origin}/api/projects/${project.id}/canvas_nodes`,
      {
        node_id: created.id,
        x: -42.5,
        y: 212,
        width: 280,
        height: 210,
        z_index: 7,
      },
    );
    expect(updateResponse.status).toBe(200);
    const updated = CanvasNodeSchema.parse(
      (await updateResponse.json() as { data: unknown }).data,
    );
    expect(updated).toMatchObject({
      id: created.id,
      x: -42.5,
      y: 212,
      width: 280,
      height: 210,
      z_index: 7,
    });

    const unsupported = await postJson(
      `${first.origin}/api/projects/${project.id}/canvas_nodes`,
      {
        node_type: 'location',
        ref_id: randomUUID(),
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        z_index: 0,
      },
    );
    await expectError(unsupported, 400, 'VALIDATION_FAILED');

    const missingProject = await fetch(
      `${first.origin}/api/projects/${randomUUID()}/canvas_nodes`,
    );
    await expectError(missingProject, 404, 'PROJECT_NOT_FOUND');

    await closeApi(first.server);
    const second = await startApi(databasePath);
    const listResponse = await fetch(
      `${second.origin}/api/projects/${project.id}/canvas_nodes`,
    );
    expect(listResponse.status).toBe(200);
    expect(CanvasNodeSchema.array().parse(
      (await listResponse.json() as { data: unknown }).data,
    )).toEqual([updated]);

    const database = new Database(databasePath, { readonly: true });
    const schemaVersion = database
      .prepare('SELECT MAX(version) AS version FROM schema_version')
      .get() as { version: number };
    database.close();
    expect(schemaVersion.version).toBe(21);
  });

  test('closes a listener when close overlaps the initial start', async () => {
    const databasePath = await temporaryDatabasePath();
    const server = createApiServer({ database_path: databasePath, port: 0 });
    servers.add(server);
    const starting = server.start();
    const closing = server.close();
    const address = await starting;
    await closing;
    servers.delete(server);

    const replacement = createApiServer({
      database_path: databasePath,
      port: address.port,
    });
    servers.add(replacement);
    const replacementAddress = await replacement.start();
    expect(replacementAddress.port).toBe(address.port);
    const health = await fetch(`${replacementAddress.origin}/api/health`);
    expect(health.status).toBe(200);
  });

  test('persists characters, reference lineage, and character canvas nodes', async () => {
    const databasePath = await temporaryDatabasePath();
    const first = await startApi(databasePath);
    const projectA = ProjectSchema.parse((await (await postJson(
      `${first.origin}/api/projects`,
      { title: 'Character A', script_title: 'Identity A', script_content:
        'A complete script establishes the first character identity project.' },
    )).json() as { data: unknown }).data);
    const projectB = ProjectSchema.parse((await (await postJson(
      `${first.origin}/api/projects`,
      { title: 'Character B', script_title: 'Identity B', script_content:
        'A separate complete script establishes another identity project.' },
    )).json() as { data: unknown }).data);

    const emptyAppearance = await postJson(
      `${first.origin}/api/projects/${projectA.id}/characters`,
      { name: 'Courier', canonical_appearance: '  ', seed_family: [41] },
    );
    await expectError(emptyAppearance, 400, 'VALIDATION_FAILED');

    const characterResponse = await postJson(
      `${first.origin}/api/projects/${projectA.id}/characters`,
      {
        name: 'Courier',
        canonical_appearance:
          'A composed East Asian woman in her early thirties with a sharp black bob and steady amber-brown eyes.',
        seed_family: [41, 1041],
      },
    );
    expect(characterResponse.status).toBe(201);
    const character = CharacterSchema.parse(
      (await characterResponse.json() as { data: unknown }).data,
    );
    expect(character.status).toBe('candidate');

    const updatedResponse = await patchJson(
      `${first.origin}/api/projects/${projectA.id}/characters`,
      { character_id: character.id, name: 'Night Courier',
        seed_family: [41, 1041, 2041], status: 'approved' },
    );
    expect(updatedResponse.status).toBe(200);
    const updated = CharacterSchema.parse(
      (await updatedResponse.json() as { data: unknown }).data,
    );
    expect(updated).toMatchObject({ name: 'Night Courier', status: 'approved',
      seed_family: [41, 1041, 2041] });

    const rootReference = CharacterReferenceSchema.parse(
      (await (await postJson(
        `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
        { uri: 'references/courier-master.png', kind: 'image',
          content_hash: 'sha256:courier-master', derived_from: null,
          sort_order: 0 },
      )).json() as { data: unknown }).data,
    );
    const derivedPrimary = await postJson(
      `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      { uri: 'references/courier-invalid-primary.png', kind: 'image',
        content_hash: null, derived_from: rootReference.id, sort_order: 0 },
    );
    await expectError(derivedPrimary, 422,
      'CHARACTER_REFERENCE_DERIVATION_INVALID');
    const derivedResponse = await postJson(
      `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      { uri: 'references/courier-profile.png', kind: 'image',
        content_hash: null, derived_from: rootReference.id, sort_order: 1 },
    );
    expect(derivedResponse.status).toBe(201);
    const derived = CharacterReferenceSchema.parse(
      (await derivedResponse.json() as { data: unknown }).data,
    );
    expect(derived.derived_from).toBe(rootReference.id);

    const secondaryRoot = CharacterReferenceSchema.parse(
      (await (await postJson(
        `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
        { uri: 'references/courier-secondary-root.png', kind: 'image',
          content_hash: null, derived_from: null, sort_order: 0 },
      )).json() as { data: unknown }).data,
    );
    const referencesAfterPrimaryChange = CharacterReferenceSchema.array().parse(
      (await (await fetch(
        `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      )).json() as { data: unknown }).data,
    );
    const shiftedRoot = referencesAfterPrimaryChange.find(
      ({ id }) => id === rootReference.id)!;
    expect(shiftedRoot.sort_order).toBe(1);
    expect(referencesAfterPrimaryChange.filter(
      ({ sort_order }) => sort_order === 0)).toEqual([secondaryRoot]);
    const convertPrimaryToDerived = await patchJson(
      `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      { reference_id: secondaryRoot.id, derived_from: rootReference.id },
    );
    await expectError(convertPrimaryToDerived, 422,
      'CHARACTER_REFERENCE_DERIVATION_INVALID');
    const restoreOriginalPrimary = await patchJson(
      `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      { reference_id: rootReference.id, sort_order: 0 },
    );
    expect(restoreOriginalPrimary.status).toBe(200);
    const referencesAfterRestore = CharacterReferenceSchema.array().parse(
      (await (await fetch(
        `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      )).json() as { data: unknown }).data,
    );
    const restoredRoot = referencesAfterRestore.find(
      ({ id }) => id === rootReference.id)!;
    const demotedSecondary = referencesAfterRestore.find(
      ({ id }) => id === secondaryRoot.id)!;
    expect(referencesAfterRestore.filter(({ sort_order }) => sort_order === 0))
      .toEqual([restoredRoot]);
    expect(demotedSecondary.sort_order).toBe(1);

    const patchedReference = CharacterReferenceSchema.parse(
      (await (await patchJson(
        `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
        { reference_id: derived.id, content_hash: 'sha256:courier-profile',
          sort_order: 2 },
      )).json() as { data: unknown }).data,
    );
    expect(patchedReference).toMatchObject({
      content_hash: 'sha256:courier-profile', sort_order: 2,
    });

    const badDerived = await postJson(
      `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      { uri: 'references/missing-parent.png', kind: 'image',
        content_hash: null, derived_from: randomUUID(), sort_order: 3 },
    );
    await expectError(badDerived, 404, 'CHARACTER_REFERENCE_NOT_FOUND');

    const foreignCharacter = CharacterSchema.parse(
      (await (await postJson(
        `${first.origin}/api/projects/${projectB.id}/characters`,
        { name: 'Observer', canonical_appearance:
          'A tall older man with silver hair, deep-set gray eyes, and a charcoal wool coat.',
          seed_family: [77] },
      )).json() as { data: unknown }).data,
    );
    const foreignReference = CharacterReferenceSchema.parse(
      (await (await postJson(
        `${first.origin}/api/projects/${projectB.id}/characters/${foreignCharacter.id}/references`,
        { uri: 'references/observer-master.png', kind: 'image',
          content_hash: null, derived_from: null, sort_order: 0 },
      )).json() as { data: unknown }).data,
    );
    const crossProjectReference = await postJson(
      `${first.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
      { uri: 'references/cross-project.png', kind: 'image', content_hash: null,
        derived_from: foreignReference.id, sort_order: 4 },
    );
    await expectError(
      crossProjectReference,
      422,
      'CHARACTER_REFERENCE_PROJECT_MISMATCH',
    );

    const canvasResponse = await postJson(
      `${first.origin}/api/projects/${projectA.id}/canvas_nodes`,
      { node_type: 'character', ref_id: character.id, x: 920, y: 100,
        width: 240, height: 220, z_index: 20 },
    );
    expect(canvasResponse.status).toBe(201);
    expect(CanvasNodeSchema.parse(
      (await canvasResponse.json() as { data: unknown }).data,
    ).node_type).toBe('character');
    const foreignCanvasNode = await postJson(
      `${first.origin}/api/projects/${projectB.id}/canvas_nodes`,
      { node_type: 'character', ref_id: character.id, x: 0, y: 0,
        width: 240, height: 220, z_index: 1 },
    );
    await expectError(foreignCanvasNode, 422, 'CANVAS_NODE_REF_PROJECT_MISMATCH');

    const archivedResponse = await patchJson(
      `${first.origin}/api/projects/${projectA.id}/characters`,
      { character_id: character.id, status: 'archived' },
    );
    expect(CharacterSchema.parse(
      (await archivedResponse.json() as { data: unknown }).data,
    ).status).toBe('archived');
    const unarchive = await patchJson(
      `${first.origin}/api/projects/${projectA.id}/characters`,
      { character_id: character.id, status: 'approved' },
    );
    await expectError(unarchive, 409, 'CHARACTER_ARCHIVED');

    await closeApi(first.server);
    const second = await startApi(databasePath);
    const listCharacters = await fetch(
      `${second.origin}/api/projects/${projectA.id}/characters`,
    );
    expect(CharacterSchema.array().parse(
      (await listCharacters.json() as { data: unknown }).data,
    )).toHaveLength(1);
    const listReferences = await fetch(
      `${second.origin}/api/projects/${projectA.id}/characters/${character.id}/references`,
    );
    expect(CharacterReferenceSchema.array().parse(
      (await listReferences.json() as { data: unknown }).data,
    )).toEqual([restoredRoot, demotedSecondary, patchedReference]);

    const catalog = await fetch(
      `${second.origin}/api/projects/${projectA.id}/character_catalog`,
    );
    expect(await catalog.json()).toMatchObject({ data: {
      characters: [{ id: character.id }],
      references: [{ id: rootReference.id }, { id: secondaryRoot.id },
        { id: patchedReference.id }],
    } });
    const foreignCatalog = await fetch(
      `${second.origin}/api/projects/${projectB.id}/character_catalog`,
    );
    expect(await foreignCatalog.json()).toMatchObject({ data: {
      references: [{ id: foreignReference.id }],
    } });
  });

  test('freezes immutable approved asset manifests across lifecycle changes', async () => {
    const databasePath = await temporaryDatabasePath();
    const api = await startApi(databasePath);
    const projectA = ProjectSchema.parse((await (await postJson(
      `${api.origin}/api/projects`,
      { title: 'Asset lifecycle A', script_title: 'Assets A', script_content:
        'A complete script establishes an authoritative approved asset manifest.' },
    )).json() as { data: unknown }).data);
    const projectB = ProjectSchema.parse((await (await postJson(
      `${api.origin}/api/projects`,
      { title: 'Asset lifecycle B', script_title: 'Assets B', script_content:
        'A separate complete script must not accept foreign replacement assets.' },
    )).json() as { data: unknown }).data);

    const traversal = await postJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { kind: 'image', uri: '../../../etc/passwd', content_hash: null });
    await expectError(traversal, 400, 'VALIDATION_FAILED');

    const master = AssetSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { kind: 'image', uri: 'references/courier-master-v1.png',
        content_hash: null },
    )).json() as { data: unknown }).data);
    expect(master.status).toBe('candidate');
    const traversalUpdate = await patchJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { asset_id: master.id, uri: '/tmp/escaped.png' });
    await expectError(traversalUpdate, 400, 'VALIDATION_FAILED');
    const approvedMaster = AssetSchema.parse((await (await patchJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { asset_id: master.id, status: 'approved' },
    )).json() as { data: unknown }).data);
    expect(approvedMaster.status).toBe('approved');
    const illegalRollback = await patchJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { asset_id: master.id, status: 'candidate' },
    );
    await expectError(illegalRollback, 409, 'ASSET_STATUS_INVALID');

    const replacement = AssetSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { kind: 'image', uri: 'references/courier-master-v2.png',
        content_hash: 'sha256:courier-v2', replaces_asset_id: master.id },
    )).json() as { data: unknown }).data);
    expect(replacement.replaces_asset_id).toBe(master.id);
    const assetsAfterReplace = AssetSchema.array().parse((await (await fetch(
      `${api.origin}/api/projects/${projectA.id}/assets`,
    )).json() as { data: unknown }).data);
    expect(assetsAfterReplace.find(({ id }) => id === master.id)?.status)
      .toBe('approved');
    const candidateManifest = CurrentAssetsManifestSnapshotSchema.parse(
      (await (await postJson(
        `${api.origin}/api/projects/${projectA.id}/manifests`, {},
      )).json() as { data: unknown }).data,
    );
    expect(candidateManifest.entries.map(({ asset_id }) => asset_id))
      .toEqual([master.id]);
    const approvedReplacement = AssetSchema.parse((await (await patchJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { asset_id: replacement.id, status: 'approved' },
    )).json() as { data: unknown }).data);
    const assetsAfterApproval = AssetSchema.array().parse((await (await fetch(
      `${api.origin}/api/projects/${projectA.id}/assets`,
    )).json() as { data: unknown }).data);
    expect(assetsAfterApproval.find(({ id }) => id === master.id)?.status)
      .toBe('archived');

    const characterA = CharacterSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${projectA.id}/characters`,
      { name: 'Courier', canonical_appearance:
        'A night courier with a sharp black bob and an amber raincoat.',
        seed_family: [41] },
    )).json() as { data: unknown }).data);
    const linkedReference = CharacterReferenceSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${projectA.id}/characters/${characterA.id}/references`,
      { uri: approvedReplacement.uri, kind: 'image', content_hash: null,
        asset_id: approvedReplacement.id, derived_from: null, sort_order: 0 },
    )).json() as { data: unknown }).data);
    expect(linkedReference.asset_id).toBe(approvedReplacement.id);
    const characterB = CharacterSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${projectB.id}/characters`,
      { name: 'Observer', canonical_appearance:
        'A distant observer in a charcoal coat with silver hair.',
        seed_family: [77] },
    )).json() as { data: unknown }).data);
    const crossProjectReference = await postJson(
      `${api.origin}/api/projects/${projectB.id}/characters/${characterB.id}/references`,
      { uri: approvedReplacement.uri, kind: 'image', content_hash: null,
        asset_id: approvedReplacement.id, derived_from: null, sort_order: 0 },
    );
    await expectError(crossProjectReference, 422, 'ASSET_PROJECT_MISMATCH');

    const foreignReplacement = await postJson(
      `${api.origin}/api/projects/${projectB.id}/assets`,
      { kind: 'image', uri: 'references/foreign.png', content_hash: null,
        replaces_asset_id: approvedReplacement.id },
    );
    await expectError(foreignReplacement, 422, 'ASSET_PROJECT_MISMATCH');

    const manifestV1 = CurrentAssetsManifestSnapshotSchema.parse(
      (await (await postJson(
        `${api.origin}/api/projects/${projectA.id}/manifests`, {},
      )).json() as { data: unknown }).data,
    );
    expect(manifestV1.manifest.manifest_version).toBe(2);
    expect(manifestV1.entries.map(({ asset_id }) => asset_id))
      .toEqual([approvedReplacement.id]);

    const scene = AssetSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { kind: 'image', uri: 'references/rainy-cinema-master.png',
        content_hash: null },
    )).json() as { data: unknown }).data);
    await patchJson(`${api.origin}/api/projects/${projectA.id}/assets`,
      { asset_id: scene.id, status: 'approved' });
    const frozenV1 = CurrentAssetsManifestSnapshotSchema.parse(
      (await (await fetch(
        `${api.origin}/api/projects/${projectA.id}/manifests/2`,
      )).json() as { data: unknown }).data,
    );
    expect(frozenV1).toEqual(manifestV1);
    const manifestV2 = CurrentAssetsManifestSnapshotSchema.parse(
      (await (await postJson(
        `${api.origin}/api/projects/${projectA.id}/manifests`, {},
      )).json() as { data: unknown }).data,
    );
    expect(manifestV2.manifest.manifest_version).toBe(3);
    expect(new Set(manifestV2.entries.map(({ asset_id }) => asset_id)))
      .toEqual(new Set([approvedReplacement.id, scene.id]));
    const listed = CurrentAssetsManifestSnapshotSchema.array().parse(
      (await (await fetch(
        `${api.origin}/api/projects/${projectA.id}/manifests`,
      )).json() as { data: unknown }).data,
    );
    expect(listed).toEqual([candidateManifest, manifestV1, manifestV2]);

    await patchJson(`${api.origin}/api/projects/${projectA.id}/assets`,
      { asset_id: scene.id, status: 'archived' });
    const reapproveArchived = await patchJson(
      `${api.origin}/api/projects/${projectA.id}/assets`,
      { asset_id: scene.id, status: 'approved' },
    );
    await expectError(reapproveArchived, 409, 'ASSET_ARCHIVED');
  });

  test('persists global production modes and enforces evidence-backed transitions', async () => {
    const databasePath = await temporaryDatabasePath();
    const first = await startApi(databasePath);
    const declaration = {
      generation_modes: ['i2v', 'fl2v'],
      duration_seconds: { min: 2, max: 15 },
      resolution: { min_width: 480, max_width: 480,
        min_height: 864, max_height: 864 },
      lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'],
      extensions: { quality_gate: 'representative-take' },
    };
    const createdResponse = await postJson(`${first.origin}/api/modes`, {
      key: 'cinematic-drama', title: 'Cinematic Drama',
      description: 'Narrative and quality policy for dramatic cinematic work.',
      capability_declaration: declaration,
    });
    expect(createdResponse.status).toBe(201);
    const created = ModeSchema.parse(
      (await createdResponse.json() as { data: unknown }).data,
    );
    expect(created).toMatchObject({ key: 'cinematic-drama',
      validation_status: 'candidate', evidence: null });
    const modeProject = ProjectSchema.parse((await (await postJson(
      `${first.origin}/api/projects`, { title: 'Mode policy project',
        script_title: 'Mode policy', script_content:
          'A complete script verifies blocked modes cannot compile or create briefs.' },
    )).json() as { data: unknown }).data);
    const modeShot = ShotPlanSchema.parse((await (await postJson(
      `${first.origin}/api/projects/${modeProject.id}/shots`, validShotInput(),
    )).json() as { data: unknown }).data);
    const modeAsset = await createAssetViaApi(first.origin, modeProject.id, {
      kind: 'image', uri: 'references/mode-context.png', content_hash: null,
    });
    await patchJson(`${first.origin}/api/projects/${modeProject.id}/assets`,
      { asset_id: modeAsset.id, status: 'approved' });
    await postJson(`${first.origin}/api/projects/${modeProject.id}/manifests`, {});
    expect((await postJson(`${first.origin}/api/projects/${modeProject.id}/briefs`, {
      mode_key: created.key, body: productionBriefBody('Candidate mode allowed'),
    })).status).toBe(201);

    const duplicate = await postJson(`${first.origin}/api/modes`, {
      key: 'cinematic-drama', title: 'Duplicate', description: 'Duplicate key.',
      capability_declaration: declaration,
    });
    await expectError(duplicate, 409, 'MODE_KEY_CONFLICT');
    const missingMode = await patchJson(`${first.origin}/api/modes`, {
      mode_id: randomUUID(), title: 'Missing mode',
    });
    await expectError(missingMode, 404, 'MODE_NOT_FOUND');
    const illegalJump = await patchJson(`${first.origin}/api/modes`, {
      mode_id: created.id, validation_status: 'blocked',
      evidence: 'Not yet validated.',
    });
    await expectError(illegalJump, 409, 'MODE_TRANSITION_INVALID');
    const missingEvidence = await patchJson(`${first.origin}/api/modes`, {
      mode_id: created.id, validation_status: 'validated',
    });
    await expectError(missingEvidence, 422, 'MODE_EVIDENCE_REQUIRED');

    const validated = ModeSchema.parse((await (await patchJson(
      `${first.origin}/api/modes`, { mode_id: created.id,
        validation_status: 'validated', evidence: 'GPU comparison run 2026-08-11.' },
    )).json() as { data: unknown }).data);
    expect(validated.validation_status).toBe('validated');
    const blockedWithoutEvidence = await patchJson(`${first.origin}/api/modes`, {
      mode_id: created.id, validation_status: 'blocked',
    });
    await expectError(blockedWithoutEvidence, 422, 'MODE_EVIDENCE_REQUIRED');
    const blocked = ModeSchema.parse((await (await patchJson(
      `${first.origin}/api/modes`, { mode_id: created.id,
        validation_status: 'blocked', evidence: 'Provider regression detected.' },
    )).json() as { data: unknown }).data);
    expect(blocked.validation_status).toBe('blocked');
    const blockedBrief = await postJson(
      `${first.origin}/api/projects/${modeProject.id}/briefs`, {
        mode_key: created.key, body: productionBriefBody('Blocked mode rejected'),
      });
    await expectError(blockedBrief, 409, 'MODE_BLOCKED');
    const blockedCompile = await postJson(
      `${first.origin}/api/shots/${modeShot.id}/compile_bindings`, {});
    await expectError(blockedCompile, 409, 'MODE_BLOCKED');
    const reopened = ModeSchema.parse((await (await patchJson(
      `${first.origin}/api/modes`, { mode_id: created.id,
        validation_status: 'candidate' },
    )).json() as { data: unknown }).data);
    expect(reopened).toMatchObject({ validation_status: 'candidate', evidence: null });

    await closeApi(first.server);
    const second = await startApi(databasePath);
    const listed = ModeSchema.array().parse((await (await fetch(
      `${second.origin}/api/modes`,
    )).json() as { data: unknown }).data);
    expect(listed).toEqual([reopened]);
    const database = new Database(databasePath, { readonly: true });
    const schemaVersion = database.prepare(
      'SELECT MAX(version) AS version FROM schema_version',
    ).get() as { version: number };
    database.close();
    expect(schemaVersion.version).toBe(21);
  });

  test('versions production briefs and freezes immutable job lock snapshots', async () => {
    const databasePath = await temporaryDatabasePath();
    const api = await startApi(databasePath);
    await postJson(`${api.origin}/api/modes`, {
      key: 'cinematic-drama', title: 'Cinematic Drama',
      description: 'Production intent policy.',
      capability_declaration: productionCapability(),
    });
    const project = ProjectSchema.parse((await (await postJson(
      `${api.origin}/api/projects`, { title: 'Locked production',
        script_title: 'Production lock', script_content:
        'A complete script establishes the production lock snapshot test.' },
    )).json() as { data: unknown }).data);
    const shot = ShotPlanSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/shots`, validShotInput(),
    )).json() as { data: unknown }).data);

    const unlockedJob = await postJson(`${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'unlocked-job', []));
    expect(unlockedJob.status).toBe(409);
    const unlockedError = await unlockedJob.json() as ErrorEnvelope;
    expect(unlockedError.error.code).toBe('LOCK_REQUIRED');
    expect(unlockedError.error.message).toContain('create a production brief');
    expect(unlockedError.error.message).toContain('freeze a current-assets manifest');
    expect(unlockedError.error.message).toContain('engage the project generation lock');
    const missingMode = await postJson(
      `${api.origin}/api/projects/${project.id}/briefs`, {
        mode_key: 'missing-mode', body: productionBriefBody('Missing mode'),
      });
    await expectError(missingMode, 422, 'BRIEF_MODE_NOT_FOUND');

    await putJson(`${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: true, reason: 'Missing brief check' });
    const missingBrief = await postJson(`${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'missing-brief', []));
    await expectError(missingBrief, 409, 'BRIEF_REQUIRED');
    await putJson(`${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: false });

    const briefV1 = ProductionBriefSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/briefs`, {
        mode_key: 'cinematic-drama', body: productionBriefBody('First intent'),
      },
    )).json() as { data: unknown }).data);
    expect(briefV1.brief_version).toBe(1);
    const immutableBrief = await patchJson(
      `${api.origin}/api/projects/${project.id}/briefs`, {
        brief_id: briefV1.id, body: productionBriefBody('Mutation'),
      });
    await expectError(immutableBrief, 404, 'ROUTE_NOT_FOUND');
    await putJson(`${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: true, reason: 'Missing manifest check' });
    const missingManifest = await postJson(`${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'missing-manifest', []));
    await expectError(missingManifest, 409, 'MANIFEST_REQUIRED');
    await putJson(`${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: false });

    const asset = await createAssetViaApi(api.origin, project.id, {
      kind: 'image', uri: 'references/locked-context.png', content_hash: null,
    });
    await patchJson(`${api.origin}/api/projects/${project.id}/assets`,
      { asset_id: asset.id, status: 'approved' });
    const manifestV1 = CurrentAssetsManifestSnapshotSchema.parse(
      (await (await postJson(
        `${api.origin}/api/projects/${project.id}/manifests`, {},
      )).json() as { data: unknown }).data,
    );
    const briefV2 = ProductionBriefSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/briefs`, {
        mode_key: 'cinematic-drama', body: productionBriefBody('Locked intent'),
      },
    )).json() as { data: unknown }).data);
    const lockedCharacter = CharacterSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/characters`, {
        name: 'Locked Courier', canonical_appearance:
          'A courier with a black bob and charcoal raincoat.', seed_family: [31],
      },
    )).json() as { data: unknown }).data);
    const lockedReference = CharacterReferenceSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/characters/${lockedCharacter.id}/references`,
      { uri: asset.uri, kind: 'image', content_hash: null, asset_id: asset.id,
        derived_from: null, sort_order: 0 },
    )).json() as { data: unknown }).data);
    expect(briefV2.brief_version).toBe(2);
    const engaged = ProjectGenerationLockSchema.parse((await (await putJson(
      `${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: true, reason: 'Representative generation batch' },
    )).json() as { data: unknown }).data);
    expect(engaged).toMatchObject({ engaged: true,
      reason: 'Representative generation batch' });
    const alreadyEngaged = await putJson(
      `${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: true, reason: 'Duplicate engage' });
    await expectError(alreadyEngaged, 409, 'LOCK_ALREADY_ENGAGED');
    const lockedBrief = await postJson(
      `${api.origin}/api/projects/${project.id}/briefs`, {
        mode_key: 'cinematic-drama', body: productionBriefBody('Forbidden'),
      });
    await expectError(lockedBrief, 409, 'LOCK_ENGAGED');
    const lockedAsset = await patchJson(
      `${api.origin}/api/projects/${project.id}/assets`,
      { asset_id: asset.id, status: 'archived' });
    await expectError(lockedAsset, 409, 'LOCK_ENGAGED');
    const lockedManifest = await postJson(
      `${api.origin}/api/projects/${project.id}/manifests`, {});
    await expectError(lockedManifest, 409, 'LOCK_ENGAGED');
    const lockedShot = await patchJson(`${api.origin}/api/shots/${shot.id}`, {
      semantic_references: [],
    });
    await expectError(lockedShot, 409, 'LOCK_ENGAGED');
    const lockedReferenceUpdate = await patchJson(
      `${api.origin}/api/projects/${project.id}/characters/${lockedCharacter.id}/references`,
      { reference_id: lockedReference.id, sort_order: 1 });
    await expectError(lockedReferenceUpdate, 409, 'LOCK_ENGAGED');
    const lockedReferenceUpload = await fetch(
      `${api.origin}/api/projects/${project.id}/characters/` +
      `${lockedCharacter.id}/reference_uploads`, { method: 'POST', headers: {
        'content-type': 'image/png', 'x-file-name': 'locked-reference.png',
        'x-idempotency-key': 'locked-reference-upload',
      }, body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64') });
    await expectError(lockedReferenceUpload, 409, 'LOCK_ENGAGED');
    const lockedReferenceApproval = await postJson(
      `${api.origin}/api/projects/${project.id}/characters/${lockedCharacter.id}` +
      `/references/${lockedReference.id}/approve`, { make_primary: true });
    await expectError(lockedReferenceApproval, 409, 'LOCK_ENGAGED');
    const mode = ModeSchema.array().parse((await (await fetch(
      `${api.origin}/api/modes`)).json() as { data: unknown }).data)
      .find(({ key }) => key === 'cinematic-drama')!;
    const lockedModeCapability = await patchJson(`${api.origin}/api/modes`, {
      mode_id: mode.id, capability_declaration: productionCapability(),
    });
    await expectError(lockedModeCapability, 409, 'LOCK_ENGAGED');

    const firstJob = H3JobSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'locked-job-v1', []),
    )).json() as { data: unknown }).data);
    expect(firstJob.lock_snapshot).toEqual({
      brief_version: briefV2.brief_version,
      manifest_version: manifestV1.manifest.manifest_version,
      mode_key: 'cinematic-drama', locked_at: engaged.engaged_at,
    });
    await putJson(`${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: false });

    const briefV3 = ProductionBriefSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/briefs`, {
        mode_key: 'cinematic-drama', body: productionBriefBody('Next intent'),
      },
    )).json() as { data: unknown }).data);
    const nextAsset = await createAssetViaApi(api.origin, project.id, {
      kind: 'image', uri: 'references/next-context.png', content_hash: null,
    });
    await patchJson(`${api.origin}/api/projects/${project.id}/assets`,
      { asset_id: nextAsset.id, status: 'approved' });
    const manifestV2 = CurrentAssetsManifestSnapshotSchema.parse(
      (await (await postJson(
        `${api.origin}/api/projects/${project.id}/manifests`, {},
      )).json() as { data: unknown }).data,
    );
    await putJson(`${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: true, reason: 'Next batch' });
    const secondJob = H3JobSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'locked-job-v2', []),
    )).json() as { data: unknown }).data);
    expect(secondJob.lock_snapshot).toMatchObject({ brief_version: 3,
      manifest_version: 2, mode_key: 'cinematic-drama' });
    expect(briefV3.brief_version).toBe(3);
    expect(manifestV2.manifest.manifest_version).toBe(2);
    const persistedFirst = (await getSnapshot(api.origin, project.id)).h3_jobs
      .find(({ id }) => id === firstJob.id);
    expect(persistedFirst?.lock_snapshot).toEqual(firstJob.lock_snapshot);
    const briefs = ProductionBriefSchema.array().parse((await (await fetch(
      `${api.origin}/api/projects/${project.id}/briefs`,
    )).json() as { data: unknown }).data);
    expect(briefs.map(({ brief_version }) => brief_version)).toEqual([1, 2, 3]);
  });

  test('compiles semantic references into immutable job bindings', async () => {
    const api = await startApi(await temporaryDatabasePath());
    const project = ProjectSchema.parse((await (await postJson(
      `${api.origin}/api/projects`, { title: 'Binding compilation',
        script_title: 'A complete binding script', script_content:
          'A courier enters a rain-soaked cinema and stops beneath the marquee.' },
    )).json() as { data: unknown }).data);
    const shot = ShotPlanSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/shots`, validShotInput(),
    )).json() as { data: unknown }).data);
    const scene = await createAssetViaApi(api.origin, project.id, {
      kind: 'image', uri: 'references/cinema-master.png', content_hash: null,
    });
    const portrait = await createAssetViaApi(api.origin, project.id, {
      kind: 'image', uri: 'references/courier-master.png', content_hash: null,
    });
    const character = CharacterSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/characters`, {
        name: 'Lin Lan', canonical_appearance:
          'A young East Asian woman with a black bob, amber eyes, and a dark green raincoat.',
        seed_family: [8811],
      },
    )).json() as { data: unknown }).data);
    expect((await postJson(
      `${api.origin}/api/projects/${project.id}/characters/${character.id}/references`,
      { uri: portrait.uri, kind: 'image', content_hash: null,
        asset_id: portrait.id, derived_from: null, sort_order: 0 },
    )).status).toBe(201);
    const state = { characters: [{ character_id: character.id,
      position: 'beneath the marquee', appearance_state: 'raincoat soaked' }],
      props: [], scene_state: 'wet cinema entrance at night',
      sound_handoff: 'rain and a distant tram bell' };
    expect((await patchJson(`${api.origin}/api/shots/${shot.id}`, {
      semantic_references: [
        { purpose: 'reference_character',
          target: { type: 'character', character_id: character.id } },
        { purpose: 'first_frame',
          target: { type: 'asset', asset_id: scene.id } },
      ], opening_state: state, ending_state: state,
    })).status).toBe(200);
    await prepareApiGenerationContext(api.origin, project.id,
      [scene.id, portrait.id]);
    const compiled = CompiledBindingsResultSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/compile_bindings`, {},
    )).json() as { data: unknown }).data);
    expect(compiled).toMatchObject({ generation_mode: 'r2v', bindings: [
      { slot_index: 0, purpose: 'first_frame', asset_id: scene.id },
      { slot_index: 1, purpose: 'reference_character', asset_id: portrait.id },
    ] });
    const submitted = [
      { asset_id: scene.id, asset_kind: 'image', role: 'first_frame', ordinal: 0 },
      { asset_id: portrait.id, asset_kind: 'image', role: 'character', ordinal: 1 },
    ];
    const job = H3JobSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('r2v', 'compiled-binding-job', submitted),
    )).json() as { data: unknown }).data);
    expect(job.compiled_bindings).toEqual(compiled.bindings);
    const unrelated = await postJson(`${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('r2v', 'compiled-extra-binding', [...submitted,
        { ...submitted[1], ordinal: 2 }]));
    await expectError(unrelated, 422, 'BINDING_UNRELATED_INPUT');

    await putJson(`${api.origin}/api/projects/${project.id}/generation_lock`,
      { engaged: false });
    const later = await createAssetViaApi(api.origin, project.id, {
      kind: 'image', uri: 'references/later.png', content_hash: null,
    });
    await patchJson(`${api.origin}/api/projects/${project.id}/assets`,
      { asset_id: later.id, status: 'approved' });
    await postJson(`${api.origin}/api/projects/${project.id}/manifests`, {});
    const persisted = (await getSnapshot(api.origin, project.id)).h3_jobs
      .find(({ id }) => id === job.id);
    expect(persisted?.compiled_bindings).toEqual(compiled.bindings);
  });

  test('gates repeated jobs on an explicitly approved representative take', async () => {
    const databasePath = await temporaryDatabasePath();
    const api = await startApi(databasePath);
    const project = ProjectSchema.parse((await (await postJson(
      `${api.origin}/api/projects`, { title: 'Representative gate',
        script_title: 'Representative gate script', script_content:
          'A complete shot establishes the quality baseline before repeated generation.' },
    )).json() as { data: unknown }).data);
    const shot = ShotPlanSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/shots`, validShotInput(),
    )).json() as { data: unknown }).data);
    await prepareApiGenerationContext(api.origin, project.id, []);
    const firstJob = H3JobSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'representative-first', [], null),
    )).json() as { data: unknown }).data);
    const blocked = await postJson(`${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'representative-blocked', [], null));
    await expectError(blocked, 409, 'TAKE_GATE_BLOCKED');
    const overrideReason = 'Director requests a diagnostic comparison before approval.';
    const overrideJob = H3JobSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'representative-override', [], overrideReason),
    )).json() as { data: unknown }).data);
    expect(overrideJob.gate_override_reason).toBe(overrideReason);

    const firstOutput = await createAssetViaApi(api.origin, project.id, {
      kind: 'video', uri: 'outputs/representative-first.mp4', content_hash: null,
    });
    const worker = openProjectStore(databasePath);
    completeJobWithStore(worker, firstJob.id, firstOutput.id, 'rep-first-provider');
    worker.close();
    const firstActual = ShotActualSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/actuals`, { job_id: firstJob.id,
        output_asset_id: firstOutput.id, observed_description: 'Baseline take.',
        deviation_notes: '', qc_verdict: 'pending' },
    )).json() as { data: unknown }).data);
    expect(firstActual).toMatchObject({ qc_verdict: 'pending',
      is_representative: false, representative_status: 'none' });
    const marked = ShotActualSchema.parse((await (await postJson(
      `${api.origin}/api/actuals/${firstActual.id}/representative`,
      { representative: true },
    )).json() as { data: unknown }).data);
    expect(marked).toMatchObject({ qc_verdict: 'pending',
      is_representative: true, representative_status: 'pending' });
    const representativeApproved = ShotActualSchema.parse((await (await postJson(
      `${api.origin}/api/actuals/${firstActual.id}/representative/review`,
      { representative_status: 'approved' },
    )).json() as { data: unknown }).data);
    expect(representativeApproved.qc_verdict).toBe('pending');
    expect(representativeApproved.approved_at).not.toBeNull();
    const duplicateRepresentativeReview = await postJson(
      `${api.origin}/api/actuals/${firstActual.id}/representative/review`,
      { representative_status: 'rejected' });
    await expectError(duplicateRepresentativeReview, 409,
      'TAKE_REPRESENTATIVE_STATUS_INVALID');
    expect((await postJson(`${api.origin}/api/shots/${shot.id}/jobs`,
      h3JobInput('t2v', 'representative-open-gate', [], null))).status).toBe(201);
    const qcApproved = ShotActualSchema.parse((await (await postJson(
      `${api.origin}/api/actuals/${firstActual.id}/review`,
      { qc_verdict: 'approved' },
    )).json() as { data: unknown }).data);
    expect(qcApproved.representative_status).toBe('approved');

    const secondOutput = await createAssetViaApi(api.origin, project.id, {
      kind: 'video', uri: 'outputs/representative-second.mp4', content_hash: null,
    });
    const secondWorker = openProjectStore(databasePath);
    completeJobWithStore(secondWorker, overrideJob.id, secondOutput.id,
      'rep-second-provider');
    secondWorker.close();
    const secondActual = ShotActualSchema.parse((await (await postJson(
      `${api.origin}/api/shots/${shot.id}/actuals`, { job_id: overrideJob.id,
        output_asset_id: secondOutput.id, observed_description: 'Comparison take.',
        deviation_notes: '', qc_verdict: 'pending' },
    )).json() as { data: unknown }).data);
    const conflict = await postJson(
      `${api.origin}/api/actuals/${secondActual.id}/representative`,
      { representative: true });
    await expectError(conflict, 409, 'TAKE_REPRESENTATIVE_CONFLICT');
    expect((await postJson(
      `${api.origin}/api/actuals/${firstActual.id}/representative`,
      { representative: false })).status).toBe(200);
    const transferred = ShotActualSchema.parse((await (await postJson(
      `${api.origin}/api/actuals/${secondActual.id}/representative`,
      { representative: true },
    )).json() as { data: unknown }).data);
    expect(transferred.representative_status).toBe('pending');
  });
});

function productionCapability() {
  return { generation_modes: ['t2v', 'i2v', 'fl2v', 'r2v'],
    duration_seconds: { min: 2, max: 15 }, resolution: { min_width: 480,
      max_width: 480, min_height: 864, max_height: 864 },
    lora_profile_requirements: [], provider_requirements: ['local_comfyui'],
    extensions: {} };
}

function productionBriefBody(logline: string) {
  return { logline, style_notes: 'Rain-soaked cinematic drama.',
    text_style_lock: 'On-screen text uses restrained ivory sans serif.',
    hard_rules: ['Never overwrite planned shots.', 'Use approved assets only.'] };
}

async function prepareApiGenerationContext(origin: string, projectId: string,
  assetIds: string[]): Promise<void> {
  const modes = ModeSchema.array().parse((await (await fetch(
    `${origin}/api/modes`,
  )).json() as { data: unknown }).data);
  if (!modes.some(({ key }) => key === 'test-production')) {
    await postJson(`${origin}/api/modes`, { key: 'test-production',
      title: 'Test Production', description: 'Test production policy.',
      capability_declaration: productionCapability() });
  }
  const approvedIds = [...assetIds];
  if (approvedIds.length === 0) {
    approvedIds.push((await createAssetViaApi(origin, projectId, {
      kind: 'image', uri: `context/${projectId}.png`, content_hash: null,
    })).id);
  }
  for (const assetId of approvedIds) {
    await patchJson(`${origin}/api/projects/${projectId}/assets`,
      { asset_id: assetId, status: 'approved' });
  }
  await postJson(`${origin}/api/projects/${projectId}/manifests`, {});
  await postJson(`${origin}/api/projects/${projectId}/briefs`, {
    mode_key: 'test-production', body: productionBriefBody('Test intent'),
  });
  await putJson(`${origin}/api/projects/${projectId}/generation_lock`,
    { engaged: true, reason: 'Test generation context' });
}

function validShotInput(): Record<string, unknown> {
  return {
    title: 'Carriage walk',
    scene_id: 'scene-01',
    duration_seconds: 8,
    shot_size: 'medium wide',
    camera_movement: 'locked-off camera with natural carriage sway',
    action: 'The conductor crosses frame and checks the empty seats.',
    dialogue: '',
    sound: 'Rail rhythm and a distant signal bell.',
    prompt:
      'Medium-wide locked-off camera. The conductor crosses the night carriage.',
    continuity_mode: 'independent',
    continuity_dependencies: [],
    costume_state: { conductor: 'navy uniform, brass buttons' },
    reference_bindings: [],
  };
}

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'h3storyboard-api-'));
  temporaryDirectories.add(directory);
  return join(directory, 'project.db');
}

async function startApi(databasePath: string): Promise<{
  server: ApiServer;
  origin: string;
}> {
  const server = createApiServer({ database_path: databasePath, port: 0 });
  servers.add(server);
  const { origin } = await server.start();
  return { server, origin };
}

async function closeApi(server: ApiServer): Promise<void> {
  await server.close();
  servers.delete(server);
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

async function createAssetViaApi(
  origin: string,
  projectId: string,
  body: unknown,
) {
  const response = await postJson(
    `${origin}/api/projects/${projectId}/assets`,
    body,
  );
  expect(response.status).toBe(201);
  return AssetSchema.parse((await response.json() as { data: unknown }).data);
}

function h3JobInput(
  mode: string,
  idempotencyKey: string,
  inputBindings: readonly unknown[],
  gateOverrideReason: string | null = 'Integration test repeated generation.',
): Record<string, unknown> {
  return {
    mode,
    provider: 'local_comfyui',
    model: 'H3-local',
    prompt: `A valid ${mode} generation request.`,
    duration_seconds: 6,
    seed: 9,
    steps: 20,
    idempotency_key: idempotencyKey,
    input_bindings: inputBindings,
    ...(gateOverrideReason === null ? {} : {
      gate_override_reason: gateOverrideReason,
    }),
  };
}

function completeJobWithStore(store: ReturnType<typeof openProjectStore>,
  jobId: string, outputAssetId: string, providerJobId: string): void {
  const claimed = store.claimH3Job(jobId);
  store.markH3JobQueued(jobId, claimed.lease_token!, providerJobId);
  store.markH3JobRunning(jobId, claimed.lease_token!);
  store.completeH3Job(jobId, claimed.lease_token!, outputAssetId);
}

async function getSnapshot(
  origin: string,
  projectId: string,
): Promise<ReturnType<typeof ProjectSnapshotSchema.parse>> {
  const response = await fetch(`${origin}/api/projects/${projectId}`);
  expect(response.status).toBe(200);
  return ProjectSnapshotSchema.parse(
    (await response.json() as { data: unknown }).data,
  );
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  const body = await response.json() as ErrorEnvelope;
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(0);
}
