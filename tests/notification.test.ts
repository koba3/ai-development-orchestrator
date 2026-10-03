import { describe, expect, it } from "vitest";
import { formatPlanningFailedMessage, formatTasksCreatedMessage } from "../src/notifications/notification.service.js";

describe("notification messages", () => {
  it("lists task ids for a ready plan", () => {
    const text = formatTasksCreatedMessage({
      channel: "C1",
      threadTs: "1",
      summary: "顧客一覧にCSV出力を追加",
      needsHuman: false,
      humanQuestion: "",
      tasks: [
        {
          taskId: "TASK-102",
          title: "CSV出力APIを実装",
          agentType: "backend",
          status: "READY",
          notionUrl: "https://notion.local/TASK-102",
        },
      ],
    });
    expect(text).toContain("TASK-102");
    expect(text).toContain("READY");
    expect(text).toContain("https://notion.local/TASK-102");
  });

  it("asks the human when the task is held", () => {
    const text = formatTasksCreatedMessage({
      channel: "C1",
      threadTs: "1",
      summary: "本番マイグレーション",
      needsHuman: true,
      humanQuestion: "本番DBを変更してよいですか？",
      tasks: [
        {
          taskId: "TASK-9",
          title: "migration",
          agentType: "backend",
          status: "NEEDS_HUMAN",
          notionUrl: "",
        },
      ],
    });
    expect(text).toContain("人間の確認が必要です");
    expect(text).toContain("本番DBを変更してよいですか？");
    expect(text).toContain("NEEDS_HUMAN");
  });

  it("does not leak internal errors in the failure notice", () => {
    expect(formatPlanningFailedMessage()).not.toContain("sk-");
    expect(formatPlanningFailedMessage()).toContain("失敗");
  });
});
