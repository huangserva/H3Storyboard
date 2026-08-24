import type {
  Asset,
  CurrentAssetsManifestSnapshot,
  CreateAssetInput,
  CreateH3JobInput,
  CreateProjectInput,
  CreateShotActualInput,
  CreateShotPlanInput,
  H3Job,
  Project,
  ProjectSnapshot,
  ReviewShotActualInput,
  UpdateAssetInput,
  UpdateShotPlanInput,
  JobEvent,
  ShotActual,
  ShotPlan,
} from '@h3storyboard/protocol';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createAsset,
  getAsset,
  listAssets,
  updateAsset,
} from './asset-operations.js';
import { CanvasStore } from './canvas-store.js';
import { CharacterStore } from './character-store.js';
import { CharacterMediaStore } from './character-media-store.js';
import {
  claimH3Job,
  claimNextH3Job,
  createH3Job,
  markH3JobQueued,
  markH3JobRunning,
  markH3SubmitIntent,
  clearH3ProviderTask,
} from './job-operations.js';
import { completeH3Job } from './job-completion.js';
import {
  cancelH3Job,
  deferH3Job,
  failH3Job,
  forceFailH3Job,
  heartbeatH3Job,
  listH3JobEvents,
  recoverExpiredH3Jobs,
} from './job-lifecycle.js';
import { migrateDatabase } from './migrations.js';
import { getJob } from './job-support.js';
import { ModeStore } from './mode-store.js';
import { ProductionStore } from './production-store.js';
import { TakeStore } from './take-store.js';
import {
  freezeCurrentAssetsManifest,
  getCurrentAssetsManifest,
  listCurrentAssetsManifests,
} from './manifest-operations.js';
import {
  createProject,
  getProjectSnapshot,
  listProjects,
} from './project-operations.js';
import {
  createShotActual,
  createShotPlan,
  updateShotPlan,
  reviewShotActual,
} from './shot-operations.js';
import {
  finalizeWorkerOutput,
  type WorkerOutputInput,
  type WorkerOutputResult,
} from './worker-completion.js';

export class ProjectStore {
  readonly #database: Database.Database;
  readonly modes: ModeStore;
  readonly production: ProductionStore;
  readonly takes: TakeStore;
  readonly characters: CharacterStore;
  readonly characterMedia: CharacterMediaStore;
  readonly canvas: CanvasStore;
  #closed = false;
  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.#database = new Database(databasePath);
    this.modes = new ModeStore(this.#database);
    this.production = new ProductionStore(this.#database);
    this.takes = new TakeStore(this.#database);
    this.characters = new CharacterStore(this.#database);
    this.characterMedia = new CharacterMediaStore(this.#database);
    this.canvas = new CanvasStore(this.#database);
    this.#database.pragma('foreign_keys = ON');
    this.#database.pragma('busy_timeout = 5000');
    this.#database.pragma('journal_mode = WAL');
    try {
      migrateDatabase(this.#database);
      recoverExpiredH3Jobs(this.#database);
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error;
    }
  }
  createProject(input: CreateProjectInput): Project {
    return createProject(this.#database, input);
  }
  runImmediate<T>(operation: () => T): T {
    return this.#database.transaction(operation).immediate(); }
  listProjects(): Project[] {
    return listProjects(this.#database);
  }
  getProjectSnapshot(projectId: string): ProjectSnapshot {
    return getProjectSnapshot(this.#database, projectId);
  }

  createAsset(projectId: string, input: CreateAssetInput): Asset {
    return createAsset(this.#database, projectId, input);
  }

  listAssets(projectId: string): Asset[] {
    return listAssets(this.#database, projectId);
  }

  getAsset(assetId: string): Asset { return getAsset(this.#database, assetId); }

  updateAsset(projectId: string, input: UpdateAssetInput): Asset {
    return updateAsset(this.#database, projectId, input);
  }

  freezeCurrentAssetsManifest(projectId: string): CurrentAssetsManifestSnapshot {
    return freezeCurrentAssetsManifest(this.#database, projectId);
  }

  listCurrentAssetsManifests(projectId: string): CurrentAssetsManifestSnapshot[] {
    return listCurrentAssetsManifests(this.#database, projectId);
  }

  getCurrentAssetsManifest(projectId: string,
    version: number): CurrentAssetsManifestSnapshot {
    return getCurrentAssetsManifest(this.#database, projectId, version);
  }

  createShotPlan(projectId: string, input: CreateShotPlanInput): ShotPlan {
    return createShotPlan(this.#database, projectId, input);
  }

  updateShotPlan(input: UpdateShotPlanInput): ShotPlan {
    return updateShotPlan(this.#database, input);
  }

  createH3Job(shotPlanId: string, input: CreateH3JobInput): H3Job {
    return createH3Job(this.#database, shotPlanId, input);
  }

  claimH3Job(jobId: string, leaseDurationMs?: number): H3Job {
    return claimH3Job(this.#database, jobId, leaseDurationMs);
  }

  claimNextH3Job(leaseDurationMs?: number): H3Job | null {
    return claimNextH3Job(this.#database, leaseDurationMs);
  }

  getH3Job(jobId: string): H3Job { return getJob(this.#database, jobId); }

  markH3SubmitIntent(jobId: string, leaseToken: string,
    providerClientId: string): H3Job {
    return markH3SubmitIntent(this.#database, jobId, leaseToken, providerClientId);
  }

  clearH3ProviderTask(jobId: string, leaseToken: string): H3Job {
    return clearH3ProviderTask(this.#database, jobId, leaseToken);
  }

  finalizeWorkerOutput(jobId: string, leaseToken: string,
    input: WorkerOutputInput): WorkerOutputResult {
    return finalizeWorkerOutput(this.#database, jobId, leaseToken, input);
  }

  markH3JobQueued(
    jobId: string,
    leaseToken: string,
    providerJobId: string,
  ): H3Job {
    return markH3JobQueued(this.#database, jobId, leaseToken, providerJobId);
  }

  markH3JobRunning(jobId: string, leaseToken: string): H3Job {
    return markH3JobRunning(this.#database, jobId, leaseToken);
  }

  completeH3Job(
    jobId: string,
    leaseToken: string,
    outputAssetId: string,
  ): H3Job {
    return completeH3Job(this.#database, jobId, leaseToken, outputAssetId);
  }

  heartbeatH3Job(
    jobId: string,
    leaseToken: string,
    leaseDurationMs?: number,
  ): H3Job {
    return heartbeatH3Job(
      this.#database,
      jobId,
      leaseToken,
      leaseDurationMs,
    );
  }

  failH3Job(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    errorMessage: string,
  ): H3Job {
    return failH3Job(
      this.#database,
      jobId,
      leaseToken,
      errorCode,
      errorMessage,
    );
  }

  deferH3Job(jobId: string, leaseToken: string, errorCode: string,
    errorMessage: string): H3Job {
    return deferH3Job(this.#database, jobId, leaseToken, errorCode, errorMessage);
  }

  forceFailH3Job(jobId: string, leaseToken: string, errorCode: string,
    errorMessage: string): H3Job {
    return forceFailH3Job(this.#database, jobId, leaseToken,
      errorCode, errorMessage);
  }

  cancelH3Job(jobId: string, reason?: string): H3Job {
    return cancelH3Job(this.#database, jobId, reason);
  }

  recoverExpiredH3Jobs(now?: Date): number {
    return recoverExpiredH3Jobs(this.#database, now);
  }

  listH3JobEvents(jobId: string): JobEvent[] {
    return listH3JobEvents(this.#database, jobId);
  }

  createShotActual(
    shotPlanId: string,
    input: CreateShotActualInput,
  ): ShotActual {
    return createShotActual(this.#database, shotPlanId, input);
  }

  reviewShotActual(
    actualId: string,
    input: ReviewShotActualInput,
  ): ShotActual {
    return reviewShotActual(this.#database, actualId, input);
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }
}

export function openProjectStore(databasePath: string): ProjectStore {
  return new ProjectStore(databasePath);
}
