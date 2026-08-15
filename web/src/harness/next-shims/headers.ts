/** next/headers is server-only; anything reaching it can't run in the canvas. */
const fail = (name: string) => () => {
  throw new Error(`next/headers ${name}() is server-only — not available in the u-and-i canvas`);
};

export const headers = fail("headers");
export const cookies = fail("cookies");
export const draftMode = fail("draftMode");
