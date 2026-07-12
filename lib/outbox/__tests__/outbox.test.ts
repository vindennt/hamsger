import { outboxRepo, OutboxRow } from "../../database/outboxRepository";
import { supabase } from "../../supabase";
import { useChatStore } from "../../store/useChatStore";
import { backoffMs, flushOutbox, retrySend } from "../outbox";

jest.mock("../../supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../../database/outboxRepository", () => ({
  outboxRepo: {
    getPending: jest.fn(),
    markSent: jest.fn(),
    bumpAttempt: jest.fn(),
    markFailed: jest.fn(),
    retry: jest.fn(),
  },
}));
jest.mock("../../store/useChatStore", () => ({
  useChatStore: { getState: jest.fn() },
}));

const mockInsert = jest.fn();
const updateMessageStatus = jest.fn();

// In-memory outbox backing the mocked repo, so ordering/markSent behave realistically.
let rows: OutboxRow[] = [];

function makeRow(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    msg_id: "m1",
    conversation_id: "conv",
    sender_id: "s",
    recipient_id: "r",
    payload: JSON.stringify({ id: over.msg_id ?? "m1" }),
    status: "pending",
    attempts: 0,
    last_attempt_at: null,
    created_at: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];

  (supabase.from as jest.Mock).mockReturnValue({ insert: mockInsert });
  mockInsert.mockResolvedValue({ error: null });
  (useChatStore.getState as jest.Mock).mockReturnValue({ updateMessageStatus });

  (outboxRepo.getPending as jest.Mock).mockImplementation(async () =>
    rows
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  );
  (outboxRepo.markSent as jest.Mock).mockImplementation(async (id: string) => {
    rows = rows.filter((r) => r.msg_id !== id);
  });
  (outboxRepo.bumpAttempt as jest.Mock).mockImplementation(async (id: string) => {
    const r = rows.find((x) => x.msg_id === id);
    if (r) {
      r.attempts += 1;
      r.last_attempt_at = new Date().toISOString();
    }
  });
  (outboxRepo.markFailed as jest.Mock).mockImplementation(async (id: string) => {
    const r = rows.find((x) => x.msg_id === id);
    if (r) r.status = "failed";
  });
  (outboxRepo.retry as jest.Mock).mockImplementation(async (id: string) => {
    const r = rows.find((x) => x.msg_id === id);
    if (r) {
      r.status = "pending";
      r.attempts = 0;
      r.last_attempt_at = null;
    }
  });
});

describe("backoffMs", () => {
  it("grows exponentially and caps at 5 minutes", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(20)).toBe(300_000); // capped
  });
});

describe("flushOutbox delivery", () => {
  it("delivers a pending row, removes it, and marks the UI sent", async () => {
    rows = [makeRow({ msg_id: "m1" })];

    await flushOutbox();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0);
    expect(updateMessageStatus).toHaveBeenCalledWith("conv", "m1", "sent");
  });

  it("keeps the row pending and bumps attempts on a network error", async () => {
    rows = [makeRow({ msg_id: "m1" })];
    mockInsert.mockResolvedValue({ error: { code: "08006" } });

    await flushOutbox();

    expect(outboxRepo.bumpAttempt).toHaveBeenCalledWith("m1");
    expect(outboxRepo.markSent).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("pending");
  });

  it("treats a duplicate (23505) as delivered", async () => {
    rows = [makeRow({ msg_id: "m1" })];
    mockInsert.mockResolvedValue({ error: { code: "23505" } });

    await flushOutbox();

    expect(outboxRepo.markSent).toHaveBeenCalledWith("m1");
    expect(updateMessageStatus).toHaveBeenCalledWith("conv", "m1", "sent");
  });

  it("marks failed after the attempt cap", async () => {
    rows = [makeRow({ msg_id: "m1", attempts: 9 })];
    mockInsert.mockResolvedValue({ error: { code: "08006" } });

    await flushOutbox();

    expect(outboxRepo.markFailed).toHaveBeenCalledWith("m1");
    expect(updateMessageStatus).toHaveBeenCalledWith("conv", "m1", "failed");
  });
});

describe("flushOutbox ordering", () => {
  it("stops a conversation at the first failure to preserve order", async () => {
    rows = [
      makeRow({ msg_id: "a", created_at: "2024-01-01T00:00:00.000Z" }),
      makeRow({ msg_id: "b", created_at: "2024-01-01T00:00:01.000Z" }),
    ];
    mockInsert.mockResolvedValueOnce({ error: { code: "08006" } });

    await flushOutbox();

    // Only the first row was attempted; the second stays queued.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.msg_id)).toEqual(["a", "b"]);
  });

  it("delivers different conversations independently", async () => {
    rows = [
      makeRow({ msg_id: "a", conversation_id: "c1" }),
      makeRow({ msg_id: "b", conversation_id: "c2" }),
    ];

    await flushOutbox();

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(0);
  });

  it("skips a row still within its backoff window", async () => {
    rows = [
      makeRow({
        msg_id: "a",
        attempts: 2,
        last_attempt_at: new Date().toISOString(), // backoffMs(2)=4s, not elapsed
      }),
    ];

    await flushOutbox();

    expect(mockInsert).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("pending");
  });
});

describe("retrySend", () => {
  it("re-arms a failed row and delivers it", async () => {
    rows = [makeRow({ msg_id: "m1", status: "failed", attempts: 10 })];

    await retrySend("conv", "m1");

    expect(outboxRepo.retry).toHaveBeenCalledWith("m1");
    expect(updateMessageStatus).toHaveBeenCalledWith("conv", "m1", "pending");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0); // delivered
  });
});
