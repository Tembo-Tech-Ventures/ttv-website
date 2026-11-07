// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox, ChoiceGroup, SelectField, TextAreaField, TextField, fieldAria } from "./Field";
import { CONTROL } from "./recipes";

const dom = (html: string) => {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
};

describe("TextField", () => {
  it("labels its control by id, taken from the name when no id is given", () => {
    const html = renderToStaticMarkup(<TextField label="Your name" name="name" />);
    expect(html).toContain('<label for="name"');
    expect(html).toContain('id="name" name="name" type="text"');
  });

  it("refuses a field it cannot label", () => {
    expect(() => renderToStaticMarkup(<TextField label="Nowhere" />)).toThrow(/needs an id or a name/);
  });

  it("reads its hint, then its error, with the control and marks it invalid", () => {
    const root = dom(renderToStaticMarkup(<TextField label="Email" name="email" type="email" hint="We reply here." error="Enter an email address, like wanjiru@example.com." />));
    const input = root.querySelector("input")!;
    expect(input.getAttribute("aria-describedby")).toBe("email-hint email-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(root.getElementById("email-hint")?.textContent).toBe("We reply here.");
    expect(root.getElementById("email-error")?.textContent).toMatch(/^Enter an email address/);
  });

  it("says nothing extra when there is no hint or error", () => {
    const input = dom(renderToStaticMarkup(<TextField label="City" name="city" />)).querySelector("input")!;
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("marks optional fields in words, never with an asterisk", () => {
    const html = renderToStaticMarkup(<TextField label="Portfolio link" name="url" type="url" optional />);
    expect(html).toContain("(optional)");
    expect(html).not.toContain("*");
  });

  it("passes native attributes through, so the browser can still validate", () => {
    const html = renderToStaticMarkup(<TextField label="Name" name="name" required autoComplete="name" defaultValue="Wanjiru" maxLength={80} />);
    expect(html).toContain('required=""');
    expect(html).toContain('autoComplete="name"');
    expect(html).toContain('value="Wanjiru"');
    expect(html).toContain('maxLength="80"');
  });

  it("is a 44px control drawn from the shared recipe", () => {
    const html = renderToStaticMarkup(<TextField label="Name" name="name" />);
    expect(html).toContain("h-11");
    for (const name of CONTROL.split(" ")) expect(html).toContain(name);
  });
});

describe("TextAreaField and SelectField", () => {
  it("wire their hint and error the same way", () => {
    const area = dom(renderToStaticMarkup(<TextAreaField label="Your note" name="note" hint="What you'd like to talk about." error="Write a few words." />));
    expect(area.querySelector("textarea")!.getAttribute("aria-describedby")).toBe("note-hint note-error");
    const select = dom(
      renderToStaticMarkup(<SelectField label="Format" name="format" hint="How you'd like to meet." options={[{ value: "call", label: "Video call" }]} />),
    );
    expect(select.querySelector("select")!.getAttribute("aria-describedby")).toBe("format-hint");
  });

  it("offers a select's options from a prop, with an optional empty first choice", () => {
    const root = dom(
      renderToStaticMarkup(
        <SelectField
          label="Month"
          name="month"
          placeholder="Choose a month"
          defaultValue="dec"
          options={[
            { value: "nov", label: "November", disabled: true },
            { value: "dec", label: "December" },
          ]}
        />,
      ),
    );
    const options = [...root.querySelectorAll("option")];
    expect(options.map((option) => option.textContent)).toEqual(["Choose a month", "November", "December"]);
    expect(options[0].value).toBe("");
    expect(options[1].disabled).toBe(true);
  });

  it("keeps the select's caret out of the accessibility tree", () => {
    const svg = dom(renderToStaticMarkup(<SelectField label="Month" name="m" options={[]} />)).querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("choices", () => {
  it("labels a checkbox beside its box and reads its hint", () => {
    const root = dom(renderToStaticMarkup(<Checkbox label="I agree to the code of conduct" name="conduct" hint="You can read it first." />));
    const input = root.querySelector("input")!;
    expect(input.type).toBe("checkbox");
    expect(root.querySelector("label")!.getAttribute("for")).toBe(input.id);
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-hint`);
  });

  it("can say why a box has to be ticked", () => {
    const input = dom(renderToStaticMarkup(<Checkbox label="I agree" name="conduct" error="Agree to the code of conduct to post." />)).querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("conduct-error");
  });

  it("asks a question as a fieldset whose legend is the question", () => {
    const root = dom(
      renderToStaticMarkup(
        <ChoiceGroup
          label="How would you like to meet?"
          name="format"
          hint="Choose one."
          defaultValue="call"
          required
          options={[
            { value: "call", label: "Video call" },
            { value: "chat", label: "Messages", hint: "In a direct conversation." },
          ]}
        />,
      ),
    );
    const fieldset = root.querySelector("fieldset")!;
    expect(fieldset.querySelector("legend")!.textContent).toBe("How would you like to meet?");
    expect(fieldset.getAttribute("aria-describedby")).toBe("format-hint");
    const radios = [...root.querySelectorAll<HTMLInputElement>("input[type=radio]")];
    expect(radios.map((radio) => radio.id)).toEqual(["format-call", "format-chat"]);
    expect(radios.every((radio) => radio.name === "format" && radio.required)).toBe(true);
    expect(radios[0].defaultChecked).toBe(true);
    expect(root.getElementById("format-chat-hint")?.textContent).toBe("In a direct conversation.");
  });

  it("gives every checkbox in a group its own id and marks them all invalid together", () => {
    const root = dom(
      renderToStaticMarkup(
        <ChoiceGroup
          type="checkbox"
          label="Areas"
          name="areas"
          error="Choose at least one area."
          defaultValue={["web", "data"]}
          options={[
            { value: "web", label: "Web" },
            { value: "data", label: "Data" },
            { value: "design", label: "Design" },
          ]}
        />,
      ),
    );
    const boxes = [...root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(new Set(boxes.map((box) => box.id)).size).toBe(3);
    expect(boxes.filter((box) => box.defaultChecked).map((box) => box.value)).toEqual(["web", "data"]);
    expect(boxes.every((box) => box.getAttribute("aria-invalid") === "true" && !box.required)).toBe(true);
    expect(root.querySelector("fieldset")!.getAttribute("aria-describedby")).toBe("areas-error");
  });
});

describe("fieldAria", () => {
  it("is empty for a field with nothing to add", () => {
    expect(fieldAria("x", {})).toEqual({ "aria-describedby": undefined, "aria-invalid": undefined });
  });
});
