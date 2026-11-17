import { database } from "./database";
import type { Quiz } from "./models";

export interface QuizDraft {
  attemptId: string;
  quiz: Quiz;
  revision: string;
  answers: Record<string, string>;
  flags: string[];
  index: number;
  startedAt: number;
  deadline: number;
  highWater: number;
}
export function quizRevision(quiz: Quiz): string {
  return JSON.stringify({
    id: quiz.id,
    title: quiz.title,
    duration: quiz.duration_minutes,
    version: quiz.content_version,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      body: q.body,
      options: q.options,
      image: q.image_url,
    })),
  });
}
export function quizTime(draft: QuizDraft, now = Date.now()) {
  if (
    !Number.isFinite(draft.highWater) ||
    !Number.isFinite(draft.deadline) ||
    now + 1000 < draft.highWater
  )
    throw new Error("QUIZ_CLOCK_ROLLBACK");
  return Math.max(
    0,
    Math.ceil((draft.deadline - Math.max(now, draft.highWater)) / 1000),
  );
}

/** One active draft per school/account. All writes recheck identity inside the transaction. */
export class QuizDraftStore {
  constructor(private currentScope: () => string) {}
  private check(scope: string) {
    if (!scope || this.currentScope() !== scope)
      throw new Error("AUTH_CHANGED");
  }
  async load(): Promise<QuizDraft | null> {
    const scope = this.currentScope();
    this.check(scope);
    const row = await database.snapshots.get(scope + ":quiz-draft");
    this.check(scope);
    if (!row || row.scope !== scope) return null;
    const draft = row.data as QuizDraft;
    if (
      !draft.attemptId ||
      !draft.quiz?.id ||
      !Array.isArray(draft.quiz.questions) ||
      !draft.answers ||
      !Array.isArray(draft.flags)
    )
      throw new Error("QUIZ_DRAFT_INVALID");
    return draft;
  }
  async start(quiz: Quiz) {
    const scope = this.currentScope();
    this.check(scope);
    if (
      !Number.isInteger(quiz.content_version) ||
      quiz.content_version < 1 ||
      !quiz.questions.length ||
      !Number.isInteger(quiz.duration_minutes) ||
      quiz.duration_minutes < 1
    )
      throw new Error("QUIZ_DRAFT_INVALID");
    const now = Date.now();
    const draft: QuizDraft = {
      attemptId: crypto.randomUUID(),
      quiz: structuredClone(quiz),
      revision: quizRevision(quiz),
      answers: {},
      flags: [],
      index: 0,
      startedAt: now,
      deadline: now + quiz.duration_minutes * 60000,
      highWater: now,
    };
    await database.transaction("rw", database.snapshots, async () => {
      this.check(scope);
      if (await database.snapshots.get(scope + ":quiz-draft"))
        throw new Error("QUIZ_DRAFT_EXISTS");
      this.check(scope);
      await database.snapshots.add({
        key: scope + ":quiz-draft",
        scope,
        data: draft,
        updatedAt: now,
      });
    });
    return draft;
  }
  async update(attemptId: string, change: (draft: QuizDraft) => void) {
    const scope = this.currentScope();
    this.check(scope);
    return database.transaction("rw", database.snapshots, async () => {
      this.check(scope);
      const row = await database.snapshots.get(scope + ":quiz-draft");
      if (
        !row ||
        row.scope !== scope ||
        (row.data as QuizDraft).attemptId !== attemptId
      )
        throw new Error("QUIZ_DRAFT_CHANGED");
      const draft = row.data as QuizDraft;
      quizTime(draft);
      draft.highWater = Math.max(Date.now(), draft.highWater);
      change(draft);
      this.check(scope);
      await database.snapshots.put({
        ...row,
        data: draft,
        updatedAt: draft.highWater,
      });
      return draft;
    });
  }
  async discard(attemptId: string) {
    const scope = this.currentScope();
    this.check(scope);
    await database.transaction("rw", database.snapshots, async () => {
      this.check(scope);
      const row = await database.snapshots.get(scope + ":quiz-draft");
      this.check(scope);
      if (
        row?.scope === scope &&
        (row.data as QuizDraft).attemptId === attemptId
      )
        await database.snapshots.delete(row.key);
    });
  }
  async submit(attemptId: string) {
    const scope = this.currentScope();
    this.check(scope);
    return database.transaction(
      "rw",
      database.snapshots,
      database.outbox,
      async () => {
        this.check(scope);
        const historyKey = scope + ":quiz-submission:" + attemptId;
        const previous = await database.snapshots.get(historyKey);
        this.check(scope);
        if (previous?.scope === scope) return attemptId; // A retry never changes its timestamp or payload.
        const row = await database.snapshots.get(scope + ":quiz-draft");
        if (
          row?.scope !== scope ||
          (row.data as QuizDraft).attemptId !== attemptId
        )
          throw new Error("QUIZ_DRAFT_CHANGED");
        const draft = row.data as QuizDraft;
        quizTime(draft);
        const body = {
          quizId: draft.quiz.id,
          quizVersion: draft.quiz.content_version,
          answers: draft.answers,
          takenAt: new Date(
            Math.max(Date.now(), draft.highWater),
          ).toISOString(),
          clientId: attemptId,
        };
        const existing = await database.outbox.get(attemptId);
        if (
          existing &&
          (existing.scope !== scope ||
            JSON.stringify(existing.body) !== JSON.stringify(body))
        )
          throw new Error("OUTBOX_OPERATION_CONFLICT");
        this.check(scope);
        if (!existing)
          await database.outbox.add({
            id: attemptId,
            scope,
            kind: "quiz",
            body,
            context: { title: draft.quiz.title },
            createdAt: Date.now(),
            attempts: 0,
            nextAt: 0,
            state: "pending",
          });
        await database.snapshots.put({
          key: historyKey,
          scope,
          data: {
            attemptId,
            quizId: draft.quiz.id,
            title: draft.quiz.title,
            takenAt: body.takenAt,
          },
          updatedAt: Date.now(),
        });
        await database.snapshots.delete(row.key);
        return attemptId;
      },
    );
  }
}

export interface QuizSubmission {
  id: string;
  title: string;
  takenAt: string;
  state: "pending" | "blocked" | "confirmed" | "unknown";
  error?: string;
  attempt?: import("./models").Attempt;
}
export async function quizSubmissions(
  scope: string,
): Promise<QuizSubmission[]> {
  if (!scope) return [];
  const [snapshots, queued] = await Promise.all([
    database.snapshots.where("scope").equals(scope).toArray(),
    database.outbox.where("scope").equals(scope).toArray(),
  ]);
  const rows = new Map<string, QuizSubmission>();
  for (const row of snapshots.filter((x) =>
    x.key.startsWith(scope + ":quiz-submission:"),
  )) {
    const data = row.data as {
      attemptId: string;
      title: string;
      takenAt: string;
    };
    rows.set(data.attemptId, {
      id: data.attemptId,
      title: data.title,
      takenAt: data.takenAt,
      state: "unknown",
    });
  }
  for (const q of queued.filter((x) => x.kind === "quiz"))
    rows.set(q.id, {
      id: q.id,
      title: q.context?.title || rows.get(q.id)?.title || "Évaluation",
      takenAt: String(q.body["takenAt"] || ""),
      state: q.state,
      error: q.error,
    });
  for (const row of rows.values()) {
    const result = snapshots.find((s) => s.key === scope + ":result:" + row.id)
      ?.data as { attempt?: import("./models").Attempt } | undefined;
    if (result?.attempt) {
      row.state = "confirmed";
      row.attempt = result.attempt;
    }
  }
  return [...rows.values()].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}
