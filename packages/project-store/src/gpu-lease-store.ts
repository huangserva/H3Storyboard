import {
  GpuLeaseOwnerKindSchema,
  GpuLeaseSchema,
  type GpuLease,
  type GpuLeaseOwnerKind,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { runWriteTransaction } from './transactions.js';

const MAX_LEASE_DURATION_MS = 24 * 60 * 60 * 1_000;

export class GpuLeaseStore {
  constructor(private readonly database: Database.Database) {}

  get(gpuHost: string): GpuLease | null {
    const host = requireGpuHost(gpuHost);
    const row = this.database.prepare(
      'SELECT * FROM gpu_leases WHERE gpu_host = ?',
    ).get(host);
    return row ? GpuLeaseSchema.parse(row) : null;
  }

  acquire(gpuHost: string, rawOwnerKind: GpuLeaseOwnerKind,
    ownerJobId: string, leaseDurationMs = 60_000): GpuLease {
    const host = requireGpuHost(gpuHost);
    const ownerKind = parseOwnerKind(rawOwnerKind);
    requireLeaseDuration(leaseDurationMs);
    return runWriteTransaction(this.database, () => {
      requireActiveOwner(this.database, ownerKind, ownerJobId);
      const nowDate = new Date();
      const now = nowDate.toISOString();
      const existing = this.get(host);
      if (existing && Date.parse(existing.lease_expires_at) > nowDate.getTime()) {
        throw new StoreError(
          'GPU_LEASE_BUSY',
          'GPU host already has an active generation owner',
          { gpu_host: host, owner_kind: existing.owner_kind,
            owner_job_id: existing.owner_job_id,
            lease_expires_at: existing.lease_expires_at },
        );
      }
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(
        nowDate.getTime() + leaseDurationMs,
      ).toISOString();
      this.database.prepare(`INSERT INTO gpu_leases
        (gpu_host, owner_kind, owner_job_id, lease_token, lease_expires_at,
         heartbeat_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(gpu_host) DO UPDATE SET
          owner_kind = excluded.owner_kind,
          owner_job_id = excluded.owner_job_id,
          lease_token = excluded.lease_token,
          lease_expires_at = excluded.lease_expires_at,
          heartbeat_at = excluded.heartbeat_at,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`)
        .run(host, ownerKind, ownerJobId, leaseToken, leaseExpiresAt,
          now, now, now);
      return this.get(host)!;
    });
  }

  heartbeat(gpuHost: string, leaseToken: string,
    leaseDurationMs = 60_000): GpuLease {
    const host = requireGpuHost(gpuHost);
    requireLeaseDuration(leaseDurationMs);
    return runWriteTransaction(this.database, () => {
      const lease = this.requireLease(host, leaseToken);
      const nowDate = new Date();
      if (Date.parse(lease.lease_expires_at) <= nowDate.getTime()) {
        throw new StoreError(
          'GPU_LEASE_EXPIRED',
          'GPU host lease has expired',
          { gpu_host: host, owner_job_id: lease.owner_job_id },
        );
      }
      const now = nowDate.toISOString();
      const leaseExpiresAt = new Date(
        nowDate.getTime() + leaseDurationMs,
      ).toISOString();
      const result = this.database.prepare(`UPDATE gpu_leases
        SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
        WHERE gpu_host = ? AND lease_token = ?`)
        .run(now, leaseExpiresAt, now, host, leaseToken);
      if (result.changes !== 1) throw invalidLease(host);
      return this.get(host)!;
    });
  }

  release(gpuHost: string, leaseToken: string): GpuLease {
    const host = requireGpuHost(gpuHost);
    return runWriteTransaction(this.database, () => {
      const lease = this.requireLease(host, leaseToken);
      const result = this.database.prepare(
        'DELETE FROM gpu_leases WHERE gpu_host = ? AND lease_token = ?',
      ).run(host, leaseToken);
      if (result.changes !== 1) throw invalidLease(host);
      return lease;
    });
  }

  recoverExpired(nowDate = new Date()): number {
    if (Number.isNaN(nowDate.getTime())) throw new StoreError(
      'INPUT_INVALID',
      'Recovery time must be valid',
    );
    return runWriteTransaction(this.database, () => this.database.prepare(
      'DELETE FROM gpu_leases WHERE lease_expires_at <= ?',
    ).run(nowDate.toISOString()).changes);
  }

  private requireLease(gpuHost: string, leaseToken: string): GpuLease {
    const lease = this.get(gpuHost);
    if (!lease) throw new StoreError(
      'GPU_LEASE_NOT_FOUND',
      'GPU host has no active lease record',
      { gpu_host: gpuHost },
    );
    if (lease.lease_token !== leaseToken) throw invalidLease(gpuHost);
    return lease;
  }
}

function requireActiveOwner(db: Database.Database, ownerKind: GpuLeaseOwnerKind,
  ownerJobId: string): void {
  const table = ownerKind === 'h3_video' ? 'h3_jobs' : 'character_image_jobs';
  const row = db.prepare(`SELECT status FROM ${table} WHERE id = ?`)
    .get(ownerJobId) as { status: string } | undefined;
  if (!row || !['submitting', 'queued', 'running'].includes(row.status)) {
    throw new StoreError(
      'GPU_LEASE_OWNER_INVALID',
      'GPU lease owner must be an active persisted generation job',
      { owner_kind: ownerKind, owner_job_id: ownerJobId,
        status: row?.status ?? null },
    );
  }
}

function requireGpuHost(gpuHost: string): string {
  const host = gpuHost.trim();
  if (!host || host.length > 255) throw new StoreError(
    'INPUT_INVALID',
    'GPU host must be between 1 and 255 characters',
  );
  return host;
}

function parseOwnerKind(ownerKind: GpuLeaseOwnerKind): GpuLeaseOwnerKind {
  const result = GpuLeaseOwnerKindSchema.safeParse(ownerKind);
  if (!result.success) throw new StoreError(
    'INPUT_INVALID',
    'GPU lease owner kind is invalid',
    { issues: result.error.issues },
  );
  return result.data;
}

function requireLeaseDuration(leaseDurationMs: number): void {
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0 ||
    leaseDurationMs > MAX_LEASE_DURATION_MS) throw new StoreError(
    'INPUT_INVALID',
    'Lease duration must be an integer from 1 ms through 24 hours',
    { lease_duration_ms: leaseDurationMs },
  );
}

function invalidLease(gpuHost: string): StoreError {
  return new StoreError(
    'GPU_LEASE_INVALID',
    'GPU host lease token is stale or invalid',
    { gpu_host: gpuHost },
  );
}
