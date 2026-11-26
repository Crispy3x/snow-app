import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { EDIT_URL, SEGMENT_URL, PhotoroomError, editBackground, photoroomConfigured, removeBackground, sceneBackground } = await import("../photoroom");

const KEY = "pr_test_secret_key_123";
const img = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function imageResponse(bytes = Buffer.from("JPEGDATA")) {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg" } });
}
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.PHOTOROOM_API_KEY = KEY;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PHOTOROOM_API_KEY;
});

describe("photoroom adapter", () => {
  it("reports whether a key is configured", () => {
    expect(photoroomConfigured()).toBe(true);
    process.env.PHOTOROOM_API_KEY = "  ";
    expect(photoroomConfigured()).toBe(false);
  });

  it("throws not_configured without calling fetch when the key is missing", async () => {
    delete process.env.PHOTOROOM_API_KEY;
    await expect(removeBackground(img)).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends remove-background requests to /v1/segment with the key header and multipart fields", async () => {
    fetchMock.mockResolvedValue(imageResponse());
    const out = await removeBackground(img);
    expect(out.toString()).toBe("JPEGDATA");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SEGMENT_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    const form = init.body as FormData;
    expect(form.get("image_file")).toBeInstanceOf(Blob);
    expect(form.get("format")).toBe("jpg");
    expect(form.get("bg_color")).toBe("#FFFFFF");
    expect(form.get("crop")).toBe("true");
  });

  it("sends AI scenes to /v2/edit with background.prompt and a square output", async () => {
    fetchMock.mockResolvedValue(imageResponse());
    await sceneBackground(img, "wooden_table");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EDIT_URL);
    const form = init.body as FormData;
    expect(form.get("imageFile")).toBeInstanceOf(Blob);
    expect(form.get("removeBackground")).toBe("true");
    expect(String(form.get("background.prompt"))).toMatch(/wooden table/i);
    expect(form.get("background.color")).toBeNull();
    expect(form.get("outputSize")).toBe("1600x1600");
    expect(form.get("export.format")).toBe("jpeg");
  });

  it("uses a solid white colour for the white studio preset", async () => {
    fetchMock.mockResolvedValue(imageResponse());
    await sceneBackground(img, "white_studio");
    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.get("background.color")).toBe("FFFFFF");
    expect(form.get("background.prompt")).toBeNull();
  });

  it("rejects an empty background request without calling the API", async () => {
    await expect(editBackground(img, { prompt: "  " })).rejects.toMatchObject({ code: "bad_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decodes base64 JSON responses from /v1/segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { base64img: Buffer.from("PNG!").toString("base64") }));
    expect((await removeBackground(img)).toString()).toBe("PNG!");
  });

  it.each([
    [400, { detail: "No subject found", status_code: 400, type: "no_subject" }, "bad_request"],
    [402, { error: { message: "API credits exhausted." } }, "no_credits"],
    [403, {}, "unauthorized"],
    [401, {}, "unauthorized"],
    [429, {}, "rate_limited"],
    [500, { error: { message: "oops" } }, "unavailable"],
    [418, {}, "failed"],
  ])("maps HTTP %i to %s", async (status, body, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body));
    const err = await removeBackground(img).catch((e) => e);
    expect(err).toBeInstanceOf(PhotoroomError);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(err.message).not.toContain(KEY);
  });

  it("includes Photoroom's detail for bad requests from either error shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { message: "removeBackground must be boolean" } }));
    const err = await editBackground(img, { color: "FFFFFF" }).catch((e) => e);
    expect(err.message).toContain("removeBackground must be boolean");
  });

  it("maps network failures and timeouts to unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(removeBackground(img)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("treats an empty 200 body as a failure", async () => {
    fetchMock.mockResolvedValue(imageResponse(Buffer.alloc(0)));
    await expect(removeBackground(img)).rejects.toMatchObject({ code: "failed" });
  });
});
