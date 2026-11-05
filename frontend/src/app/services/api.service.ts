import { Injectable, signal, computed } from '@angular/core';
import { LocalDbService, CachedResourceMeta, CachedQuizPack } from './local-db.service';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'instructor' | 'student';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly apiBase = (window as any).__AEM_API_BASE__ || 'http://localhost:3000/api';

  readonly token = signal<string | null>(localStorage.getItem('aem_token'));
  readonly user = signal<SessionUser | null>(
    JSON.parse(localStorage.getItem('aem_user') || 'null')
  );
  readonly currentUser = this.user;

  readonly isOnline = signal<boolean>(navigator.onLine);
  readonly isSyncing = signal<boolean>(false);
  readonly pendingSyncCount = signal<number>(0);
  readonly clockTampered = signal<boolean>(false);

  readonly syncStatusLabel = computed(() => {
    if (this.clockTampered()) return '🔴 Horloge modifiée — Reconnexion requise';
    if (this.isSyncing()) return '🔄 Synchronisation...';
    if (!this.isOnline()) {
      const n = this.pendingSyncCount();
      return n > 0
        ? `🟡 Hors ligne (${n} en attente)`
        : '🟢 Mode Hors Ligne Actif';
    }
    const n = this.pendingSyncCount();
    return n > 0 ? `🔄 ${n} à synchroniser` : '🟢 Synchronisé';
  });

  constructor(private localDb: LocalDbService) {
    window.addEventListener('online', () => {
      this.isOnline.set(true);
      this.flushSyncQueue();
    });
    window.addEventListener('offline', () => {
      this.isOnline.set(false);
    });
    this.refreshPendingCount();
    if (this.isOnline() && this.token()) {
      this.flushSyncQueue();
    }
  }

  async refreshPendingCount(): Promise<void> {
    const count = await this.localDb.syncQueue.count();
    this.pendingSyncCount.set(count);
  }

  setSession(token: string, user: SessionUser, accessState?: any): void {
    localStorage.setItem('aem_token', token);
    localStorage.setItem('aem_user', JSON.stringify(user));
    this.token.set(token);
    this.user.set(user);
    if (accessState) {
      this.localDb.updateClockGuardFromServer(accessState);
      this.clockTampered.set(false);
    }
  }

  clearSession(): void {
    localStorage.removeItem('aem_token');
    localStorage.removeItem('aem_user');
    this.token.set(null);
    this.user.set(null);
  }

  async request<T = any>(
    path: string,
    options: { method?: string; body?: any } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const currentToken = this.token();
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch(`${this.apiBase}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.message || data.error || 'Erreur réseau');
      err.status = res.status;
      err.code = data.error;
      err.error = data;
      err.data = data;
      throw err;
    }
    return data as T;
  }

  // ---------------------------------------------------------------------------
  // Authentication & Session
  // ---------------------------------------------------------------------------
  async restoreSession(): Promise<void> {
    const tok = this.token();
    if (!tok) return;
    if (!this.isOnline()) return; // Keep cached user offline
    try {
      const res = await this.request<{ user: SessionUser }>('/auth/session');
      if (res?.user) {
        this.user.set(res.user);
        localStorage.setItem('aem_user', JSON.stringify(res.user));
      }
    } catch (err: any) {
      if (err.status === 401) {
        this.clearSession();
      }
    }
  }

  async getCatalogue(): Promise<any> {
    return this.request('/auth/catalogue');
  }

  async login(identifier: string, password: string): Promise<any> {
    const res = await this.request('/auth/login', {
      method: 'POST',
      body: { identifier, password },
    });
    if (res?.token && res?.user) {
      this.setSession(res.token, res.user);
    }
    return res;
  }

  async requestOtp(phone: string): Promise<any> {
    return this.request('/auth/request-otp', {
      method: 'POST',
      body: { phone },
    });
  }

  async registerStudent(payload: {
    fullName: string;
    phone: string;
    password: string;
    otpCode: string;
    categoryCode: string;
    groupId?: string;
  }): Promise<any> {
    const res = await this.request('/auth/register', {
      method: 'POST',
      body: payload,
    });
    if (res?.token && res?.user) {
      this.setSession(res.token, res.user);
    }
    return res;
  }

  async claimInvite(payload: {
    code: string;
    phone: string;
    password: string;
  }): Promise<any> {
    const res = await this.request('/auth/claim-invite', {
      method: 'POST',
      body: payload,
    });
    if (res?.token && res?.user) {
      this.setSession(res.token, res.user);
    }
    return res;
  }

  async logout(): Promise<void> {
    try {
      if (this.isOnline() && this.token()) {
        await this.request('/auth/logout', { method: 'POST' });
      }
    } catch {
      // Ignore logout network error
    } finally {
      this.clearSession();
    }
  }

  // ---------------------------------------------------------------------------
  // Student Portal Endpoints (Offline-First)
  // ---------------------------------------------------------------------------
  async getStudentMe(): Promise<any> {
    if (this.isOnline()) {
      try {
        const data = await this.request('/student/me');
        await this.localDb.studentCache.put({
          key: 'me',
          data,
          updatedAt: Date.now(),
        });
        return data;
      } catch (err: any) {
        if (err.status === 401) {
          this.clearSession();
          throw err;
        }
      }
    }
    const cached = await this.localDb.studentCache.get('me');
    return cached?.data || null;
  }

  async getStudentResources(): Promise<any[]> {
    if (this.isOnline()) {
      try {
        const res = await this.request<{ resources: any[] }>('/student/resources');
        const list = res?.resources || [];
        await this.localDb.resourcesMeta.bulkPut(list);
        return list;
      } catch {
        // Fallback to IndexedDB
      }
    }
    return this.localDb.resourcesMeta.toArray();
  }

  async getStudentQuizzes(): Promise<any[]> {
    if (this.isOnline()) {
      try {
        const res = await this.request<{ quizzes: any[] }>('/student/quizzes');
        const list = res?.quizzes || [];
        await this.localDb.quizzes.bulkPut(list);
        return list;
      } catch {
        // Fallback to IndexedDB
      }
    }
    return this.localDb.quizzes.toArray();
  }

  async submitQuizAttempt(
    quizId: string,
    answers: Record<string, string>,
    scorePercent: number,
    passed: boolean
  ): Promise<any> {
    const clientId = crypto.randomUUID();
    const payload = {
      quizId,
      answers,
      scorePercent,
      passed,
      clientId,
    };

    if (this.isOnline()) {
      try {
        return await this.request('/student/quiz-attempts', {
          method: 'POST',
          body: payload,
        });
      } catch {
        // Queue offline
      }
    }

    await this.localDb.syncQueue.put({
      clientId,
      type: 'quiz_attempt',
      payload,
      createdAt: new Date().toISOString(),
      retries: 0,
    });
    await this.refreshPendingCount();
    return { queuedOffline: true, clientId };
  }

  // ---------------------------------------------------------------------------
  // Admin & Cashier Endpoints
  // ---------------------------------------------------------------------------
  async getAdminDashboard(): Promise<any> {
    if (this.isOnline()) {
      try {
        const res = await this.request('/admin/dashboard');
        await this.localDb.studentCache.put({
          key: 'admin_dashboard',
          data: res,
          updatedAt: Date.now(),
        });
        return res;
      } catch {
        // Fallback to cache
      }
    }
    const cached = await this.localDb.studentCache.get('admin_dashboard');
    return cached?.data || {};
  }

  async getAdminStudents(): Promise<any[]> {
    if (this.isOnline()) {
      try {
        const res = await this.request<{ students: any[] }>('/admin/students');
        const list = res?.students || [];
        await this.localDb.studentCache.put({
          key: 'admin_students',
          data: list,
          updatedAt: Date.now(),
        });
        return list;
      } catch {
        // Fallback to cache
      }
    }
    const cached = await this.localDb.studentCache.get('admin_students');
    return cached?.data || [];
  }

  async getAdminStudentDetail(studentId: string): Promise<any> {
    return this.request(`/admin/students/${studentId}`);
  }

  async createWalkInStudent(payload: {
    fullName: string;
    phone: string;
    categoryCode: string;
    groupId?: string;
    initialPaymentAmount?: number;
    initialPaymentMethod?: string;
  }): Promise<any> {
    return this.request('/admin/students', {
      method: 'POST',
      body: payload,
    });
  }

  async generateStudentInvite(studentId: string): Promise<any> {
    return this.request(`/admin/students/${studentId}/invite`, {
      method: 'POST',
    });
  }

  async recordPayment(params: {
    enrollmentId: string;
    amount: number;
    method: string;
    reference?: string;
    studentName?: string;
    studentPhone?: string;
    categoryName?: string;
    groupName?: string;
  }): Promise<any> {
    const clientId = crypto.randomUUID();
    const paidAt = new Date().toISOString();

    if (this.isOnline()) {
      try {
        return await this.request('/admin/payments', {
          method: 'POST',
          body: {
            enrollmentId: params.enrollmentId,
            amount: params.amount,
            method: params.method,
            reference: params.reference || null,
            clientId,
          },
        });
      } catch (err: any) {
        if (err.status && err.status >= 400 && err.status < 500) {
          throw err;
        }
      }
    }

    const offlineReceipt = this.localDb.nextOfflineReceiptNumber('LM-D1');
    const payload = {
      enrollmentId: params.enrollmentId,
      amount: params.amount,
      method: params.method,
      reference: params.reference || null,
      clientId,
      paidAt,
      receiptNumber: offlineReceipt,
    };

    await this.localDb.syncQueue.put({
      clientId,
      type: 'record_payment',
      payload,
      createdAt: paidAt,
      retries: 0,
    });
    await this.refreshPendingCount();

    return {
      syncedOnline: false,
      payment: {
        id: clientId,
        receipt_number: offlineReceipt,
        amount: params.amount,
        method: params.method,
        paid_at: paidAt,
      },
      student: {
        full_name: params.studentName || 'Élève AEM',
        phone: params.studentPhone || '',
      },
      enrollment: {
        category_name: params.categoryName || 'Permis B',
        group_name: params.groupName || 'Session AEM',
        balance_due: 0,
      },
    };
  }

  async cancelPayment(paymentId: string, reason: string): Promise<any> {
    return this.request(`/admin/payments/${paymentId}/cancel`, {
      method: 'POST',
      body: { reason },
    });
  }

  async getAdminAuditLog(): Promise<any[]> {
    const res = await this.request<{ logs: any[] }>('/admin/audit-log');
    return res?.logs || [];
  }

  async createGroup(payload: {
    name: string;
    categoryCode: string;
    capacity?: number;
  }): Promise<any> {
    return this.request('/admin/groups', {
      method: 'POST',
      body: payload,
    });
  }

  async createResource(payload: {
    title: string;
    description?: string;
    categoryCode: string;
    kind: string;
    isFreePreview?: boolean;
  }): Promise<any> {
    return this.request('/admin/content/resources', {
      method: 'POST',
      body: payload,
    });
  }

  async flushSyncQueue(): Promise<void> {
    if (!this.isOnline() || !this.token() || this.isSyncing()) return;

    const items = await this.localDb.syncQueue.orderBy('createdAt').toArray();
    if (items.length === 0) {
      this.pendingSyncCount.set(0);
      return;
    }

    this.isSyncing.set(true);
    try {
      for (const item of items) {
        try {
          if (item.type === 'quiz_attempt') {
            await this.request('/student/quiz-attempts', {
              method: 'POST',
              body: item.payload,
            });
          } else if (item.type === 'record_payment') {
            await this.request('/admin/payments', {
              method: 'POST',
              body: item.payload,
            });
          }
          await this.localDb.syncQueue.delete(item.clientId);
        } catch (err: any) {
          if (err.status && err.status >= 400 && err.status < 500) {
            await this.localDb.syncQueue.delete(item.clientId);
          } else {
            await this.localDb.syncQueue.update(item.clientId, {
              retries: item.retries + 1,
            });
          }
        }
      }
    } finally {
      this.isSyncing.set(false);
      await this.refreshPendingCount();
    }
  }
}
