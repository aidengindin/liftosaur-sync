import { vi, describe, it, expect, beforeEach, beforeAll } from "vitest";
import { GarminClient, GarminConflictError } from "./garmin.js";
import type { LiftosaurHistoryRecord } from "./liftosaur.js";
import type { GarminTokens } from "./db.js";

// ---------------------------------------------------------------------------
// Mock garmin-connect
// ---------------------------------------------------------------------------

const mockUploadActivity = vi.fn();
const mockLogin = vi.fn();
const mockLoadToken = vi.fn();
const mockExportToken = vi.fn().mockReturnValue({
  oauth1: { oauth_token: "tok1", oauth_token_secret: "sec1" },
  oauth2: { access_token: "at", refresh_token: "rt", expires_at: 9999999999 },
});

vi.mock("garmin-connect", () => ({
  GarminConnect: vi.fn().mockImplementation(function () {
    return {
      login: mockLogin,
      loadToken: mockLoadToken,
      uploadActivity: mockUploadActivity,
      exportToken: mockExportToken,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Mock fs/promises to avoid real file writes
// ---------------------------------------------------------------------------

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);

vi.mock("fs/promises", () => ({
  default: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleRecord: LiftosaurHistoryRecord = {
  id: "1742800292000",
  timestamp: "2026-03-24T10:31:32Z",
  program: "5/3/1",
  dayName: "Squat Day",
  duration: 3600,
  exercises: [],
  exercisesText: `Squat, Barbell / 3x5 185lb / warmup: 1x5 45lb / target: 3x5 185lb
Bench Press, Barbell / 3x5 155lb`,
};

const emptyRecord: LiftosaurHistoryRecord = {
  id: "1742800000000",
  timestamp: "2026-03-24T10:00:00Z",
  duration: 1800,
  exercises: [],
};

const durationOnlyRecord: LiftosaurHistoryRecord = {
  id: "1742801000000",
  timestamp: "2026-03-24T11:00:00Z",
  duration: 2700,
  exercises: [],
  exercisesText: undefined,
};

const sampleTokens: GarminTokens = {
  oauth1: { oauth_token: "tok1", oauth_token_secret: "sec1" },
  oauth2: { access_token: "at", refresh_token: "rt", expires_at: 9999999999 },
};

// ---------------------------------------------------------------------------
// buildFitFile() tests
// ---------------------------------------------------------------------------

describe("buildFitFile()", () => {
  beforeAll(async () => {
    await GarminClient.loadFitSdk();
  });

  it("returns a non-empty Uint8Array for a record with work sets and warmup sets", () => {
    const client = new GarminClient(null, sampleTokens, vi.fn());
    const result = client.buildFitFile(sampleRecord);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a non-empty Uint8Array for a record with no exercisesText", () => {
    const client = new GarminClient(null, sampleTokens, vi.fn());
    const result = client.buildFitFile(emptyRecord);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a non-empty Uint8Array for a record with only duration, no exercises", () => {
    const client = new GarminClient(null, sampleTokens, vi.fn());
    const result = client.buildFitFile(durationOnlyRecord);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("throws if loadFitSdk() was not called (simulated by resetting internal state)", () => {
    // Access the private static field via any-cast to simulate missing SDK
    const savedModule = (GarminClient as unknown as { _fitModule: unknown })._fitModule;
    (GarminClient as unknown as { _fitModule: unknown })._fitModule = null;

    const client = new GarminClient(null, sampleTokens, vi.fn());
    expect(() => client.buildFitFile(sampleRecord)).toThrow("FIT SDK not loaded");

    // Restore
    (GarminClient as unknown as { _fitModule: unknown })._fitModule = savedModule;
  });
});

// ---------------------------------------------------------------------------
// uploadWorkout() tests
// ---------------------------------------------------------------------------

describe("uploadWorkout()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadActivity.mockResolvedValue(undefined);
    mockLogin.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("happy path with tokens: uses loadToken, writes file, uploads, cleans up, calls onTokensSaved", async () => {
    const onTokensSaved = vi.fn();
    const client = new GarminClient(null, sampleTokens, onTokensSaved);

    await client.uploadWorkout(sampleRecord);

    expect(mockLoadToken).toHaveBeenCalledWith(sampleTokens.oauth1, sampleTokens.oauth2);
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [writtenPath] = mockWriteFile.mock.calls[0] as [string, ...unknown[]];
    expect(writtenPath).toMatch(/\.fit$/);
    expect(mockUploadActivity).toHaveBeenCalledWith(writtenPath, "fit");
    expect(mockUnlink).toHaveBeenCalledWith(writtenPath);
    expect(onTokensSaved).toHaveBeenCalledOnce();
  });

  it("credential login path: calls login(), exportToken(), and onTokensSaved when tokens are null", async () => {
    const credentials = { username: "user@example.com", password: "secret" };
    const onTokensSaved = vi.fn();
    const client = new GarminClient(credentials, null, onTokensSaved);

    await client.uploadWorkout(sampleRecord);

    expect(mockLogin).toHaveBeenCalledWith(credentials.username, credentials.password);
    expect(mockLoadToken).not.toHaveBeenCalled();
    expect(mockExportToken).toHaveBeenCalled();
    // onTokensSaved is called once after login (in ensureLoggedIn) and once after
    // upload (post-upload token refresh), so at least once is the correct assertion.
    expect(onTokensSaved).toHaveBeenCalled();
  });

  it("throws GarminConflictError when uploadActivity fails with 409 message", async () => {
    mockUploadActivity.mockRejectedValue(new Error("Request failed with status 409"));
    const onTokensSaved = vi.fn();
    const client = new GarminClient(null, sampleTokens, onTokensSaved);

    await expect(client.uploadWorkout(sampleRecord)).rejects.toBeInstanceOf(GarminConflictError);
    // unlink must still be called in the finally block
    expect(mockUnlink).toHaveBeenCalledOnce();
  });

  it("still cleans up temp file (unlink) even when uploadActivity throws a non-409 error", async () => {
    mockUploadActivity.mockRejectedValue(new Error("Network error"));
    const client = new GarminClient(null, sampleTokens, vi.fn());

    await expect(client.uploadWorkout(sampleRecord)).rejects.toThrow("Network error");
    expect(mockUnlink).toHaveBeenCalledOnce();
  });

  it("throws an error containing 'not authorized' when both credentials and tokens are null", async () => {
    const client = new GarminClient(null, null, vi.fn());

    await expect(client.uploadWorkout(sampleRecord)).rejects.toThrow(/not authorized/i);
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockUploadActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loginAndSaveTokens() static tests
// ---------------------------------------------------------------------------

describe("GarminClient.loginAndSaveTokens()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue(undefined);
  });

  it("calls login() with credentials and returns a GarminTokens object", async () => {
    const result = await GarminClient.loginAndSaveTokens("user@example.com", "password123");

    expect(mockLogin).toHaveBeenCalledWith("user@example.com", "password123");
    expect(mockExportToken).toHaveBeenCalled();
    // Verify shape matches GarminTokens
    expect(result).toMatchObject({
      oauth1: {
        oauth_token: expect.any(String),
        oauth_token_secret: expect.any(String),
      },
      oauth2: {
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        expires_at: expect.any(Number),
      },
    });
  });
});
