export type AntivirusScanVerdict = "clean" | "rejected";

export interface AntivirusScanInput {
  objectKey: string;
  body: Buffer;
  contentType: string;
}

export interface AntivirusPort {
  scan(input: AntivirusScanInput): Promise<{ verdict: AntivirusScanVerdict; reason?: string }>;
}

export class StubAntivirusPort implements AntivirusPort {
  async scan(
    input: AntivirusScanInput
  ): Promise<{ verdict: AntivirusScanVerdict; reason?: string }> {
    const text = input.body.toString("utf8");
    if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      return { verdict: "rejected", reason: "eicar_test_signature" };
    }
    return { verdict: "clean" };
  }
}
