// Minimal ambient declaration for @garmin/fitsdk (ESM-only, no bundled types).
declare module "@garmin/fitsdk" {
  interface FitEncoder {
    onMesg(mesgNum: number, mesg: Record<string, unknown>): this;
    close(): Uint8Array;
  }

  class Encoder implements FitEncoder {
    constructor(options?: { fieldDescriptions?: Record<string, unknown> });
    onMesg(mesgNum: number, mesg: Record<string, unknown>): this;
    writeMesg(mesg: { mesgNum: number } & Record<string, unknown>): this;
    close(): Uint8Array;
  }

  const Profile: {
    version: { major: number; minor: number; patch: number; type: string };
    MesgNum: Record<string, number>;
    messages: Record<number, unknown>;
    types: Record<string, Record<string | number, unknown>>;
  };

  export { Encoder, Profile };
}
