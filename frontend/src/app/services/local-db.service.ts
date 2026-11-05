import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface CachedResourceMeta {
  id: string;
  licence_category_id?: string;
  category_id?: string;
  title: string;
  description: string | null;
  type?: 'pdf' | 'video' | 'image' | 'link';
  kind?: string;
  storage_path: string | null;
  external_url?: string | null;
  file_size_kb?: number;
  download_url?: string;
  is_free_preview?: boolean;
  blobData?: Blob;
  cachedAt?: number;
  downloaded_offline?: boolean;
  updated_at?: number;
}

export interface CachedResourceBlob {
  id: string;
  blob: Blob;
  mimeType: string;
  savedAt: number;
}

export interface CachedQuizPack {
  id: string;
  licence_category_id?: string;
  category_id?: string;
  title: string;
  description?: string | null;
  topic?: string | null;
  duration_minutes?: number | null;
  time_limit_sec?: number | null;
  pass_threshold?: number;
  is_mock_exam?: boolean;
  questions: Array<any>;
  updated_at?: number;
}

export interface SyncQueueItem {
  clientId: string;
  type: 'quiz_attempt' | 'record_payment';
  payload: any;
  createdAt: string;
  retries: number;
}

export interface ClockGuardState {
  id: number;
  lastSeenTimestampMs: number;
  serverTimeMs: number;
  maxOfflineUntilMs: number;
  trialEndsAt: string | null;
  hasPaid: boolean;
  hasAccess: boolean;
}

@Injectable({ providedIn: 'root' })
export class LocalDbService extends Dexie {
  resourcesMeta!: Table<CachedResourceMeta, string>;
  resources!: Table<CachedResourceMeta, string>;
  resourceBlobs!: Table<CachedResourceBlob, string>;
  quizzes!: Table<CachedQuizPack, string>;
  studentCache!: Table<{ key: string; data: any; updatedAt: number }, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  clockGuard!: Table<ClockGuardState, number>;

  private offlineReceiptSeq = Number(localStorage.getItem('lm_offline_receipt_seq') || '1');

  constructor() {
    super('AutoEcoleLaMarseillaiseDB');
    this.version(1).stores({
      resourcesMeta: 'id, licence_category_id, downloaded_offline',
      resources: 'id, category_id, cachedAt',
      resourceBlobs: 'id, savedAt',
      quizzes: 'id, licence_category_id, is_mock_exam',
      studentCache: 'key',
      syncQueue: 'clientId, type, createdAt',
      clockGuard: 'id',
    });
  }

  /**
   * Checks monotonic device clock integrity and advances the high-water mark.
   * Returns `false` if a backward clock rollback > 5 minutes is detected.
   */
  async checkAndAdvanceClock(): Promise<boolean> {
    const res = await this.verifyOfflineAccessIntegrity();
    return res.reason !== 'CLOCK_ROLLBACK_DETECTED';
  }

  /**
   * Updates the monotonic clock guard from a verified server lease and checks for
   * device clock rollback tampering (> 5 minutes backward shift).
   */
  async updateClockGuardFromServer(accessState: {
    serverTimeMs: number;
    maxOfflineUntilMs: number;
    trialEndsAt: string | null;
    hasPaid: boolean;
    hasAccess: boolean;
  }): Promise<void> {
    const nowMs = Date.now();
    await this.clockGuard.put({
      id: 1,
      lastSeenTimestampMs: Math.max(nowMs, accessState.serverTimeMs),
      serverTimeMs: accessState.serverTimeMs,
      maxOfflineUntilMs: accessState.maxOfflineUntilMs,
      trialEndsAt: accessState.trialEndsAt,
      hasPaid: accessState.hasPaid,
      hasAccess: accessState.hasAccess,
    });
  }

  async verifyOfflineAccessIntegrity(): Promise<{
    allowed: boolean;
    reason: 'OK' | 'CLOCK_ROLLBACK_DETECTED' | 'OFFLINE_LEASE_EXPIRED' | 'TRIAL_EXPIRED';
  }> {
    const state = await this.clockGuard.get(1);
    if (!state) {
      return { allowed: true, reason: 'OK' };
    }

    const nowMs = Date.now();
    const fiveMinutesMs = 5 * 60 * 1000;

    // 1. Detect device clock rollback tampering
    if (nowMs + fiveMinutesMs < state.lastSeenTimestampMs) {
      return { allowed: false, reason: 'CLOCK_ROLLBACK_DETECTED' };
    }

    // Advance monotonic high-water mark
    await this.clockGuard.update(1, {
      lastSeenTimestampMs: Math.max(state.lastSeenTimestampMs, nowMs),
    });

    // 2. If student has already paid at least 1 valid installment, access is permanent
    if (state.hasPaid) {
      return { allowed: true, reason: 'OK' };
    }

    // 3. Check if 14-day trial expired
    if (state.trialEndsAt && nowMs > new Date(state.trialEndsAt).getTime()) {
      return { allowed: false, reason: 'TRIAL_EXPIRED' };
    }

    // 4. Check maximum offline lease window
    if (nowMs > state.maxOfflineUntilMs) {
      return { allowed: false, reason: 'OFFLINE_LEASE_EXPIRED' };
    }

    return { allowed: state.hasAccess, reason: state.hasAccess ? 'OK' : 'TRIAL_EXPIRED' };
  }

  nextOfflineReceiptNumber(devicePrefix = 'LM-D1'): string {
    const num = this.offlineReceiptSeq++;
    localStorage.setItem('lm_offline_receipt_seq', String(this.offlineReceiptSeq));
    return `${devicePrefix}-${String(num).padStart(4, '0')}`;
  }
}
