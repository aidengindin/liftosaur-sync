import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StravaClient, StravaConflictError, StravaUploadParams } from "./strava.js";

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

function makeClient() {
  return new StravaClient(
    "client-id",
    "client-secret",
    { accessToken: "token", refreshToken: "refresh", expiresAt: FUTURE },
    () => {},
    { pollIntervalMs: 0, maxPollAttempts: 5 }
  );
}

const PARAMS: StravaUploadParams = {
  name: "Liftosaur: Day 1",
  description: "Program: Test",
  externalId: "liftosaur-123",
  startTime: "2026-08-12T10:34:28Z",
  utcOffset: -14400,
  elapsedTime: 2883,
  sets: [
    { exercise_type: "BARBELL_BACK_SQUAT", repetitions: 8, weight: 54.4 },
    { exercise_type: "PULL_UP_GENERIC", repetitions: 8 },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("StravaClient.uploadWorkout", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the workout as a JSON upload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 99, status: "processing" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 99, status: "Your activity is ready.", activity_id: 555 })
    );

    await makeClient().uploadWorkout(PARAMS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.strava.com/api/v3/uploads");
    expect(init.method).toBe("POST");

    const form = init.body as FormData;
    expect(form.get("data_type")).toBe("json");
    expect(form.get("sport_type")).toBe("WeightTraining");
    expect(form.get("external_id")).toBe("liftosaur-123");
    expect(form.get("name")).toBe("Liftosaur: Day 1");
    expect(form.get("description")).toBe("Program: Test");
  });

  it("sends a document Strava's JSON schema accepts", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 99, status: "ready", activity_id: 555 })
    );

    await makeClient().uploadWorkout(PARAMS);

    const form = fetchMock.mock.calls[0][1].body as FormData;
    const doc = JSON.parse(await (form.get("file") as Blob).text());

    expect(doc.version).toBe("1.0");
    expect(doc.start_time).toBe("2026-08-12T10:34:28Z");
    expect(doc.utc_offset).toBe(-14400);
    expect(doc.elapsed_time).toBe(2883);
    expect(doc.sets).toHaveLength(2);
    expect(doc.sets[0]).toEqual({
      exercise_type: "BARBELL_BACK_SQUAT",
      repetitions: 8,
      weight: 54.4,
    });
    // Bodyweight set carries no weight key at all
    expect(doc.sets[1]).toEqual({ exercise_type: "PULL_UP_GENERIC", repetitions: 8 });
  });

  it("polls until the activity id appears", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 99, status: "processing" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 99, status: "processing" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 99, status: "ready", activity_id: 777 })
    );

    const activityId = await makeClient().uploadWorkout(PARAMS);

    expect(activityId).toBe(777);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://www.strava.com/api/v3/uploads/99");
  });

  it("returns immediately when the first response already has an activity id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 99, status: "ready", activity_id: 42 })
    );

    expect(await makeClient().uploadWorkout(PARAMS)).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws StravaConflictError carrying the existing activity id on a duplicate", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 99, error: "liftosaur-123.json duplicate of activity 21234316" })
    );

    const err = await makeClient()
      .uploadWorkout(PARAMS)
      .catch((e) => e);

    expect(err).toBeInstanceOf(StravaConflictError);
    expect((err as StravaConflictError).activityId).toBe("21234316");
  });

  it("detects a duplicate reported during polling", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 99, status: "processing" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 99, error: "duplicate of activity 888" })
    );

    const err = await makeClient()
      .uploadWorkout(PARAMS)
      .catch((e) => e);

    expect(err).toBeInstanceOf(StravaConflictError);
    expect((err as StravaConflictError).activityId).toBe("888");
  });

  it("throws when the upload reports a non-duplicate error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 99, error: "Invalid exercise_type: NOT_A_LIFT" })
    );

    await expect(makeClient().uploadWorkout(PARAMS)).rejects.toThrow(/NOT_A_LIFT/);
  });

  it("throws when the POST itself fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Bad Request", { status: 400 }));

    await expect(makeClient().uploadWorkout(PARAMS)).rejects.toThrow(/400/);
  });

  it("throws when processing never completes", async () => {
    // A Response body can only be read once, so mint a fresh one per poll.
    fetchMock.mockImplementation(async () => jsonResponse({ id: 99, status: "processing" }));

    await expect(makeClient().uploadWorkout(PARAMS)).rejects.toThrow(/timed out/i);
  });
});
