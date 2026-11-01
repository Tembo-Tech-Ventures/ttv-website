import { describe, expect, it } from "vitest";
import { mentionedNames } from "./channel-producers";

describe("mentionedNames", () => {
  it("reads each @ as the names it could be, up to four words, folding case as SQLite does", () => {
    expect(mentionedNames("@Wanjiku Njeri, see this. cc @Otieno")).toEqual([["wanjiku", "wanjiku njeri"], ["otieno"]]);
    expect(mentionedNames("(@Achieng Atieno Ouma Kamau Extra) hi")).toEqual([
      ["achieng", "achieng atieno", "achieng atieno ouma", "achieng atieno ouma kamau"],
    ]);
    // Non-ASCII letters keep their case, as SQLite's lower() leaves them.
    expect(mentionedNames("@WANJIRŨ")).toEqual([["wanjirŨ"]]);
  });

  it("skips Tembo, emails and @ inside words", () => {
    expect(mentionedNames("@tembo summarise, then email wanjiku@example.org or a@b")).toEqual([]);
    expect(mentionedNames("@Tembo and @Otieno")).toEqual([["otieno"]]);
  });
});
