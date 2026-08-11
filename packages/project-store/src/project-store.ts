import type {
  Asset,
  CanvasNode,
  CreateCanvasNodeInput,
  CreateAssetInput,
  CreateH3JobInput,
  CreateProjectInput,
  CreateShotActualInput,
  CreateShotPlanInput,
  H3Job,
  Project,
  ProjectSnapshot,
  ReviewShotActualInput,
  UpdateCanvasNodeInput,
  JobEvent,
  ShotActual,
  ShotPlan,
} from '@h3storyboard/protocol';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createCanvasNode,
  listCanvasNodes,
  updateCanvasNode,
} from './canvas-operations.js';
import {
  claimH3Job,
  createH3Job,
  markH3JobQueued,
  markH3JobRunning,
} from './job-operations.js';
import { completeH3Job } from './job-completion.js';
import {
  cancelH3Job,
  failH3Job,
  heartbeatH3Job,
  listH3JobEvents,
  recoverExpiredH3Jobs,
} from './job-lifecycle.js';
import { migrateDatabase } from './migrations.js';
import {
  createAsset,
  createProject,
  getProjectSnapshot,
  listProjects,
} from './project-operations.js';
import {
  createShotActual,
  createShotPlan,
  reviewShotActual,
} from './shot-operations.js';

export class ProjectStore {
  readonly #database: Database.Database;
  #closed = false;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.#database = new Database(databasePath);
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

  listProjects(): Project[] {
    return listProjects(this.#database);
  }

  getProjectSnapshot(projectId: string): ProjectSnapshot {
    return getProjectSnapshot(this.#database, projectId);
  }

  createAsset(projectId: string, input: CreateAssetInput): Asset {
    return createAsset(this.#database, projectId, input);
  }

  listCanvasNodes(projectId: string): CanvasNode[] {
    return listCanvasNodes(this.#database, projectId);
  }

  createCanvasNode(
    projectId: string,
    input: CreateCanvasNodeInput,
  ): CanvasNode {
    return createCanvasNode(this.#database, projectId, input);
  }

  updateCanvasNode(
    projectId: string,
    input: UpdateCanvasNodeInput,
  ): CanvasNode {
    return updateCanvasNode(this.#database, projectId, input);
  }

  createShotPlan(projectId: string, input: CreateShotPlanInput): ShotPlan {
    return createShotPlan(this.#database, projectId, input);
  }

  createH3Job(shotPlanId: string, input: CreateH3JobInput): H3Job {
    return createH3Job(this.#database, shotPlanId, input);
  }

  claimH3Job(jobId: string, leaseDurationMs?: number): H3Job {
    return claimH3Job(this.#database, jobId, leaseDurationMs);
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

  cancelH3Job(jobId: string): H3Job {
    return cancelH3Job(this.#database, jobId);
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
