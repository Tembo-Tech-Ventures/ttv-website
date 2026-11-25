// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { offerDeviceZone } from "./zone-choice";

/* The suggest form's time zone: Nairobi's without script, the device's own where it differs. */
function form(options: string[], selected = options[0]) {
  document.body.innerHTML = `<form data-suggest-form><select name="zone">${options.map((value) =>
    `<option value="${value}"${value === selected ? " selected" : ""}>${value}</option>`).join("")}</select></form>`;
  return document.querySelector("select") as HTMLSelectElement;
}

describe("offering the device's time zone", () => {
  it("adds and chooses the device's zone where it isn't Nairobi's", () => {
    const select = form(["Africa/Nairobi"]);
    offerDeviceZone(document, "America/New_York");
    expect([...select.options].map((option) => option.textContent)).toEqual(["Africa/Nairobi", "Your time (America/New York)"]);
    expect(select.value).toBe("America/New_York");
  });

  it("leaves the form as it is in Nairobi, or where the zone is already offered", () => {
    const nairobi = form(["Africa/Nairobi"]);
    offerDeviceZone(document, "Africa/Nairobi");
    expect(nairobi.options).toHaveLength(1);
    const kept = form(["Africa/Nairobi", "Europe/Paris"], "Africa/Nairobi");
    offerDeviceZone(document, "Europe/Paris");
    expect([kept.options.length, kept.value]).toEqual([2, "Africa/Nairobi"]);
  });
});
