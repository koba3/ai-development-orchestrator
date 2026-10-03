import { describe, expect, it } from "vitest";
import { extractHumanMessage, readSlackWorkspaceId } from "../src/slack/extract-message.js";

describe("extractHumanMessage", () => {
  it("strips a mention and threads a new channel message", () => {
    expect(
      extractHumanMessage(
        {
          type: "message",
          channel: "C1",
          user: "U1",
          text: "<@UBOT> Questoonに顧客CSV出力を追加して",
          ts: "111.222",
        },
        [],
        "T1",
      ),
    ).toEqual({
      workspaceId: "T1",
      channel: "C1",
      user: "U1",
      text: "Questoonに顧客CSV出力を追加して",
      messageTs: "111.222",
      threadTs: "111.222",
    });
  });

  it("prefers the Bolt workspace id over the message team", () => {
    expect(
      readSlackWorkspaceId({
        message: { team: "T-MESSAGE", team_id: "T-FIELD" },
        contextTeamId: "T-CONTEXT",
        envelopeTeamId: "T-ENVELOPE",
      }),
    ).toBe("T-CONTEXT");
    expect(readSlackWorkspaceId({ message: { team: "T-MESSAGE" }, envelopeTeamId: "T-ENVELOPE" })).toBe("T-ENVELOPE");
    expect(readSlackWorkspaceId({ message: { team: "T-MESSAGE" } })).toBe("T-MESSAGE");
  });

  it("keeps an existing thread and ignores bots, edits, and other channels", () => {
    expect(
      extractHumanMessage(
        { type: "message", channel: "C1", user: "U1", text: "続き", ts: "2", thread_ts: "1" },
        ["C1"],
      )?.threadTs,
    ).toBe("1");
    expect(extractHumanMessage({ type: "message", bot_id: "B1", channel: "C1", user: "U1", text: "bot", ts: "1" }, [])).toBeNull();
    expect(
      extractHumanMessage(
        { type: "message", subtype: "message_changed", channel: "C1", user: "U1", text: "edit", ts: "1" },
        [],
      ),
    ).toBeNull();
    expect(
      extractHumanMessage({ type: "message", channel: "C2", user: "U1", text: "elsewhere", ts: "1" }, ["C1"]),
    ).toBeNull();
  });
});
