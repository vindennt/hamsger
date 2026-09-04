import { baseMessageId } from "../types";

describe("baseMessageId", () => {
  it("strips the per-device transport suffix down to the logical id", () => {
    expect(baseMessageId("msg_new_123_abc__device-uuid-9")).toBe(
      "msg_new_123_abc",
    );
  });

  it("returns the id unchanged when there is no device suffix (sent/local id)", () => {
    expect(baseMessageId("msg_new_123_abc")).toBe("msg_new_123_abc");
  });

  it("collapses two devices' transport ids to the same logical id (dedup key)", () => {
    const base = "msg_new_123_abc";
    expect(baseMessageId(`${base}__phone`)).toBe(
      baseMessageId(`${base}__laptop`),
    );
  });
});
