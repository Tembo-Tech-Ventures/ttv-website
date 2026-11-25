import { afterEach, describe, expect, it, vi } from "vitest";
import { constraint, deviceProblem, deviceProblemText, listDevices, mediaDevices, openDevice, stopStream } from "./devices";

afterEach(() => vi.unstubAllGlobals());

describe("the device check's browser calls", () => {
  it("names each getUserMedia failure as the person can act on it", () => {
    const failure = (name: string) => new DOMException("No", name);
    expect(deviceProblem(failure("NotAllowedError"))).toBe("blocked");
    expect(deviceProblem(failure("SecurityError"))).toBe("blocked");
    expect(deviceProblem(failure("NotFoundError"))).toBe("missing");
    expect(deviceProblem(failure("OverconstrainedError"))).toBe("missing");
    expect(deviceProblem(failure("NotReadableError"))).toBe("in-use");
    expect(deviceProblem(failure("AbortError"))).toBe("in-use");
    expect(deviceProblem(new TypeError("getUserMedia is not a function"))).toBe("unsupported");
    expect(deviceProblem("nonsense")).toBe("unsupported");
  });

  it("always offers a way to join without the device, and says how to fix it", () => {
    expect(deviceProblemText("camera", "blocked")).toEqual({
      title: "TTV can't use your camera",
      body: "Your browser blocked it. Allow it in this site's settings in your browser, then try again. You can join without it.",
    });
    expect(deviceProblemText("microphone", "missing").body).toBe("Connect one and try again. You can join to listen, and turn it on once it works.");
    expect(deviceProblemText("microphone", "in-use").title).toBe("Your microphone is being used by another app");
    expect(deviceProblemText("camera", "unsupported").title).toBe("This browser can't join calls");
  });

  it("knows a browser that can't make calls (an app's own browser) from one that can", () => {
    vi.stubGlobal("navigator", {});
    expect(mediaDevices()).toBeNull();
    const media = { getUserMedia: vi.fn(), enumerateDevices: vi.fn() };
    vi.stubGlobal("navigator", { mediaDevices: media });
    expect(mediaDevices()).toBe(media);
  });

  it("lists devices with the browser's names, or numbered ones before permission", async () => {
    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: "audioinput", deviceId: "mic-1", label: "" },
      { kind: "audioinput", deviceId: "mic-2", label: "Headset" },
      { kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD camera" },
      { kind: "audiooutput", deviceId: "out", label: "Speakers" },
      { kind: "videoinput", deviceId: "", label: "" },
    ]);
    expect(await listDevices({ enumerateDevices, getUserMedia: vi.fn() })).toEqual({
      microphone: [{ deviceId: "mic-1", label: "Microphone 1" }, { deviceId: "mic-2", label: "Headset" }],
      camera: [{ deviceId: "cam-1", label: "FaceTime HD camera" }],
    });
    expect(await listDevices({ enumerateDevices: vi.fn().mockRejectedValue(new Error("no")), getUserMedia: vi.fn() })).toEqual({ microphone: [], camera: [] });
  });

  it("opens exactly the chosen device, or the browser's default, and releases every track", async () => {
    const getUserMedia = vi.fn().mockResolvedValue("stream");
    const media = { getUserMedia, enumerateDevices: vi.fn() };
    await openDevice(media, "camera", "cam-1");
    await openDevice(media, "microphone", null);
    expect(getUserMedia.mock.calls).toEqual([[{ video: { deviceId: { exact: "cam-1" } } }], [{ audio: true }]]);
    expect(constraint(null)).toBe(true);
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopStream({ getTracks: () => tracks } as unknown as MediaStream);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(() => stopStream(null)).not.toThrow();
  });
});
