import type {
  Asset,
  CurrentAssetsManifestSnapshot,
  BindShotReferenceInput,
  CreateAssetInput,
  CreateProjectInput,
  CreateShotActualInput,
  CreateShotPlanInput,
  Project,
  ProjectSnapshot,
  ReviewShotActualInput,
  UpdateAssetInput,
  UpdateShotPlanInput,
  ShotActual,
  ShotPlan,
} from '@h3storyboard/protocol';
import { requireShot } from './store-guards.js';
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
import { CharacterImageJobStore } from './character-image-job-store.js';
import { GpuLeaseStore } from './gpu-lease-store.js';
import { H3JobStore } from './h3-job-store.js';
import { recoverExpiredH3Jobs } from './job-lifecycle.js';
import { migrateDatabase } from './migrations.js';
import { ModeStore } from './mode-store.js';
import { ProductionStore } from './production-store.js';
import { PlanReviewStore } from './plan-review-store.js';
import { ScriptStore } from './script-store.js';
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
import { bindShotReference } from './shot-binding-operations.js';

export class ProjectStore extends H3JobStore {
  /** Reads one planned shot by id (SHOT_PLAN_NOT_FOUND when absent). */
  getShotPlan(shotPlanId: string): ShotPlan {
    return requireShot(this.h3Database, shotPlanId);
  }

  readonly #database: Database.Database;
  readonly modes: ModeStore;
  readonly production: ProductionStore;
  readonly scripts: ScriptStore;
  readonly planReviews: PlanReviewStore;
  readonly takes: TakeStore;
  readonly characters: CharacterStore;
  readonly characterMedia: CharacterMediaStore;
  readonly characterImageJobs: CharacterImageJobStore;
  readonly gpuLeases: GpuLeaseStore;
  readonly canvas: CanvasStore;
  #closed = false;
  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    const database = new Database(databasePath);
    super(database);
    this.#database = database;
    this.modes = new ModeStore(this.#database);
    this.production = new ProductionStore(this.#database);
    this.scripts = new ScriptStore(this.#database);
    this.planReviews = new PlanReviewStore(this.#database);
    this.takes = new TakeStore(this.#database);
    this.characters = new CharacterStore(this.#database);
    this.characterMedia = new CharacterMediaStore(this.#database);
    this.characterImageJobs = new CharacterImageJobStore(this.#database);
    this.gpuLeases = new GpuLeaseStore(this.#database);
    this.canvas = new CanvasStore(this.#database);
    this.#database.pragma('foreign_keys = ON');
    this.#database.pragma('busy_timeout = 5000');
    this.#database.pragma('journal_mode = WAL');
    try {
      migrateDatabase(this.#database);
      recoverExpiredH3Jobs(this.#database);
      this.characterImageJobs.recoverExpired();
      this.gpuLeases.recoverExpired();
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

  bindShotReference(projectId: string, shotPlanId: string,
    input: BindShotReferenceInput): ShotPlan {
    return bindShotReference(this.#database, projectId, shotPlanId, input);
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
