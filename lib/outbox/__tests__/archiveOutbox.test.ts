import {
  archiveOutboxRepo,
  ArchiveOutboxRow,
} from "../../database/archiveOutboxRepository";
import { supabase } from "../../supabase";
import { archiveBackoffMs, flushArchiveOutbox } from "../archiveOutbox";

jest.mock("../../supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../../database/archiveOutboxRepository", () => ({
  archiveOutboxRepo: {
    getPending: jest.fn(),
    markDone: jest.fn(),
    bumpAttempts: jest.fn(),
    markFailed: jest.fn(),
  },
}));

const mockUpsert = jest.fn();

// In-memory archive outbox backing the mocked repo, so batching/markDone behave
// realistically (mirrors the P2 outbox.test.ts pattern).
let rows: ArchiveOutboxRow[] = [];

function makeRow(over: Partial<ArchiveOutboxRow> = {}): ArchiveOutboxRow {
  return {
    msg_id: "m1",
    user_id: "u1",
    conversation_id: "conv",
    ciphertext: "ct",
    iv: "iv",
    auth_tag: "tag",
    created_at_server: "2024-01-01T00:00:00.000Z",
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

  (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert });
  mockUpsert.mockResolvedValue({ error: null });

  (archiveOutboxRepo.getPending as jest.Mock).mockImplementation(
    async (limit: number) =>
      rows
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit),
  );
  (archiveOutboxRepo.markDone as jest.Mock).mockImplementation(
    async (ids: string[]) => {
      rows = rows.filter((r) => !ids.includes(r.msg_id));
    },
  );
  (archiveOutboxRepo.bumpAttempts as jest.Mock).mockImplementation(
    async (ids: string[]) => {
      for (const r of rows) {
        if (ids.includes(r.msg_id)) {
          r.attempts += 1;
          r.last_attempt_at = new Date().toISOString();
        }
      }
    },
  );
  (archiveOutboxRepo.markFailed as jest.Mock).mockImplementation(
    async (ids: string[]) => {
      for (const r of rows) if (ids.includes(r.msg_id)) r.status = "failed";
    },
  );
});

describe("archiveBackoffMs", () => {
  it("grows exponentially and caps at 5 minutes", () => {
    expect(archiveBackoffMs(0)).toBe(1000);
    expect(archiveBackoffMs(3)).toBe(8000);
    expect(archiveBackoffMs(20)).toBe(300_000); // capped
  });
});

describe("flushArchiveOutbox", () => {
  it("batch-delivers pending rows in one upsert and drops them", async () => {
    rows = [
      makeRow({ msg_id: "a", conversation_id: "c1" }),
      makeRow({ msg_id: "b", conversation_id: "c2" }),
    ];

    await flushArchiveOutbox();

    // One batched upsert for BOTH conversations (no per-conversation ordering).
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = mockUpsert.mock.calls[0];
    expect(payload.map((r: any) => r.msg_id)).toEqual(["a", "b"]);
    // ON CONFLICT DO NOTHING so a duplicate row never errors the batch.
    expect(opts).toEqual({ onConflict: "user_id,msg_id", ignoreDuplicates: true });
    expect(rows).toHaveLength(0);
  });

  it("keeps rows pending and bumps attempts on a network error", async () => {
    rows = [makeRow({ msg_id: "a" })];
    mockUpsert.mockResolvedValue({ error: { code: "08006" } });

    await flushArchiveOutbox();

    expect(archiveOutboxRepo.bumpAttempts).toHaveBeenCalledWith(["a"]);
    expect(archiveOutboxRepo.markDone).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("pending");
    expect(rows[0].attempts).toBe(1);
  });

  it("marks a row failed after the attempt cap", async () => {
    rows = [makeRow({ msg_id: "a", attempts: 9 })];
    mockUpsert.mockResolvedValue({ error: { code: "08006" } });

    await flushArchiveOutbox();

    expect(archiveOutboxRepo.markFailed).toHaveBeenCalledWith(["a"]);
    expect(rows[0].status).toBe("failed");
  });

  it("skips a row still within its backoff window", async () => {
    rows = [
      makeRow({
        msg_id: "a",
        attempts: 2,
        last_attempt_at: new Date().toISOString(), // backoff(2)=4s, not elapsed
      }),
    ];

    await flushArchiveOutbox();

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("pending");
  });
});
