import { customColors, getShadow } from "./constants";

describe("theme constants", () => {
  it("returns consistent shadows by size", () => {
    expect(getShadow("sm")).toBe("0 5px 10px -5px rgba(0,0,0,0.4)");
    expect(getShadow("md")).toBe("0 10px 20px -10px rgba(0,0,0,0.4)");
    expect(getShadow("lg")).toBe("0 15px 35px -10px rgba(0,0,0,0.4)");
  });

  it("exposes required palette keys", () => {
    expect(customColors.dark.main).toBe("#013D39");
    expect(customColors.orange.main).toBe("#F28D68");
    expect(customColors.lessDark.main).toBe("#2C6964");
  });
});
