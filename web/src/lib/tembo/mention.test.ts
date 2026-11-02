import { describe, expect, it } from "vitest";
import { mentionsTembo } from "./mention";

describe("mentionsTembo", () => {
  it.each([
    "@tembo what did we cover on Tuesday?", "Thanks! @Tembo, can you summarise?", "(@TEMBO) help", "Asking @tembo.",
    "line one\n@tembo line two", "@tembo", "＠ｔｅｍｂｏ fullwidth",
  ])("asks for %j", (body) => expect(mentionsTembo(body)).toBe(true));

  it.each([
    "tembo without the at", "write to hello@tembo.org", "@tembotech is a handle", "see @tembo.co", "@tembo_bot", "@tembo-ai",
    "x@tembo", "@@tembo", "email me: someone.@tembo",
  ])("does not ask for %j", (body) => expect(mentionsTembo(body)).toBe(false));
});
