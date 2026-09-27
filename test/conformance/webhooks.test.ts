import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../../src/webhooks.js";

interface Case {
  name: string;
  category: "signature" | "rotation";
  signed_with: string;
  headers: Record<string, string>;
  body: string;
  expect: boolean;
  other_valid_secret?: string;
}

interface Fixture {
  reference_now: string;
  tolerance_seconds: number;
  secret: string;
  cases: Case[];
}

const fixture: Fixture = JSON.parse(await readFile("conformance/webhooks.json", "utf8"));
// Une signature de webhook expire par conception (protection contre le rejeu) : on ne peut la
// rejouer qu'en figeant l'horloge sur l'instant `reference_now` du fichier, jamais l'heure réelle.
const now = new Date(fixture.reference_now).getTime() / 1000;

describe("verifyWebhookSignature against duva-mail/duva-conformance", () => {
  const nonRotation = fixture.cases.filter((c) => c.category !== "rotation");
  it.each(nonRotation)("$name", (testCase) => {
    // Toujours SON PROPRE secret (le canonique du fichier) ; `signed_with` n'est qu'informatif :
    // c'est précisément ce qu'un cas `wrong_secret` distingue.
    const got = verifyWebhookSignature(fixture.secret, testCase.headers, testCase.body, {
      toleranceSeconds: fixture.tolerance_seconds,
      now,
    });
    expect(got).toBe(testCase.expect);
  });

  it("covers every non-rotation case", () => {
    expect(nonRotation.length).toBe(fixture.cases.length - 1);
  });

  const [rotation] = fixture.cases.filter((c) => c.category === "rotation");

  it("a rotation vector verifies against a LIST of active secrets", () => {
    expect(rotation).toBeDefined();
    // The active set during rotation: the current secret (`other_valid_secret`, == the top-level
    // `secret`) AND the older one that actually signed this webhook (`signed_with`).
    const secrets = [rotation!.other_valid_secret!, rotation!.signed_with];
    const got = verifyWebhookSignature(secrets, rotation!.headers, rotation!.body, {
      toleranceSeconds: fixture.tolerance_seconds,
      now,
    });
    expect(got).toBe(rotation!.expect);
  });

  it("the current secret alone is NOT enough: proof the case truly needs the older one too", () => {
    const withCurrentOnly = verifyWebhookSignature(
      rotation!.other_valid_secret!,
      rotation!.headers,
      rotation!.body,
      { now },
    );
    expect(withCurrentOnly).toBe(false);
    const withTheSignerAlone = verifyWebhookSignature(
      rotation!.signed_with,
      rotation!.headers,
      rotation!.body,
      { now },
    );
    expect(withTheSignerAlone).toBe(true); // the point: a verifier must try it too, it doesn't know which one signed
  });
});
