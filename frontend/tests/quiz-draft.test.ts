import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { database } from "../src/app/core/database";
import {
  QuizDraftStore,
  quizRevision,
  quizTime,
  quizSubmissions,
} from "../src/app/core/quiz-draft";
import type { Quiz } from "../src/app/core/models";
const quiz: Quiz = {
  id: "quiz-a",
  content_version: 1,
  title: "Sécurité",
  duration_minutes: 5,
  questions: [
    { id: "q1", body: "Question 1", options: ["Oui", "Non"], image_url: null },
    { id: "q2", body: "Question 2", options: ["Oui", "Non"], image_url: null },
  ],
};
let scope = "school-a:user-a";
const store = () => new QuizDraftStore(() => scope);
beforeEach(async () => {
  scope = "school-a:user-a";
  await database.snapshots.clear();
  await database.outbox.clear();
});
afterEach(() => vi.restoreAllMocks());
it("restores answers, flags, position, stable ID and original deadline after reopen", async () => {
  const s = store(),
    draft = await s.start(quiz);
  await s.update(draft.attemptId, (d) => {
    d.answers.q1 = "0";
    d.flags = ["q2"];
    d.index = 1;
  });
  const restored = (await store().load())!;
  expect(restored.attemptId).toBe(draft.attemptId);
  expect(restored.deadline).toBe(draft.deadline);
  expect(restored.answers).toEqual({ q1: "0" });
  expect(restored.flags).toEqual(["q2"]);
  expect(restored.index).toBe(1);
});
it("does not load, modify or discard another account or school's draft", async () => {
  const s = store(),
    draft = await s.start(quiz);
  scope = "school-a:user-b";
  expect(await s.load()).toBeNull();
  await expect(s.update(draft.attemptId, () => {})).rejects.toThrow(
    "QUIZ_DRAFT_CHANGED",
  );
  await s.discard(draft.attemptId);
  scope = "school-b:user-a";
  expect(await s.load()).toBeNull();
  scope = "school-a:user-a";
  expect((await s.load())?.attemptId).toBe(draft.attemptId);
});
it("aborts writes if identity changes while a transaction is scheduled", async () => {
  const s = store(),
    d = await s.start(quiz);
  const update = s.update(d.attemptId, (x) => {
    x.answers.q1 = "1";
  });
  scope = "other:user";
  await expect(update).rejects.toThrow("AUTH_CHANGED");
  scope = "school-a:user-a";
  expect((await s.load())!.answers).toEqual({});
});
it("atomically queues one stable submission and keeps its payload across retries", async () => {
  const s = store(),
    d = await s.start(quiz);
  await s.update(d.attemptId, (x) => {
    x.answers.q1 = "0";
  });
  await Promise.all([s.submit(d.attemptId), s.submit(d.attemptId)]);
  const first = (await database.outbox.get(d.attemptId))!;
  expect(first.body.quizVersion).toBe(1);
  expect(first.body.answers).toEqual({ q1: "0" });
  expect(await s.load()).toBeNull();
  expect(await database.outbox.count()).toBe(1);
  await s.submit(d.attemptId);
  expect((await database.outbox.get(d.attemptId))!.body).toEqual(first.body);
});
it("keeps the draft and avoids partial submission when storage fails", async () => {
  const s = store(),
    d = await s.start(quiz);
  vi.spyOn(database.outbox, "add").mockRejectedValueOnce(
    new Error("QuotaExceededError"),
  );
  await expect(s.submit(d.attemptId)).rejects.toThrow("QuotaExceededError");
  expect((await s.load())!.attemptId).toBe(d.attemptId);
  expect(await database.outbox.count()).toBe(0);
  expect(await quizSubmissions(scope)).toEqual([]);
  await s.submit(d.attemptId);
  expect(await database.outbox.count()).toBe(1);
});
it("does not extend deadlines after backgrounding or accept a rolled-back clock", async () => {
  const s = store(),
    d = await s.start(quiz);
  expect(quizTime(d, d.deadline + 1)).toBe(0);
  expect(() => quizTime(d, d.highWater - 1001)).toThrow("QUIZ_CLOCK_ROLLBACK");
  expect(quizRevision({ ...quiz, content_version: 2 })).not.toBe(d.revision);
  await expect(s.start(quiz)).rejects.toThrow("QUIZ_DRAFT_EXISTS");
});
it("recovers pending/rejected/server-confirmed results only for their original scope", async () => {
  const s = store(),
    d = await s.start(quiz);
  await s.submit(d.attemptId);
  expect((await quizSubmissions(scope))[0].state).toBe("pending");
  await database.outbox.update(d.attemptId, {
    state: "blocked",
    error: "QUIZ_VERSION_CHANGED",
  });
  expect((await quizSubmissions(scope))[0].error).toBe("QUIZ_VERSION_CHANGED");
  expect(await quizSubmissions("school-b:user-a")).toEqual([]);
  await database.snapshots.put({
    key: scope + ":result:" + d.attemptId,
    scope,
    updatedAt: Date.now(),
    data: {
      attempt: {
        id: "server-id",
        quiz_id: quiz.id,
        score: 1,
        total: 2,
        taken_at: new Date().toISOString(),
      },
    },
  });
  await database.outbox.delete(d.attemptId);
  const item = (await quizSubmissions(scope))[0];
  expect(item.state).toBe("confirmed");
  expect(item.attempt?.score).toBe(1);
});
