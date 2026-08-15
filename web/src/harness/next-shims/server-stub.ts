/**
 * Alias target for @/auth and @/db: any access throws with a message that
 * tells you the component belongs to the server, not the canvas.
 */
function explode(name: string): never {
  throw new Error(`${name} is server-side — this component can't run in the u-and-i canvas`);
}

const trap: ProxyHandler<object> = {
  get(_t, prop) {
    if (prop === "__esModule") return true;
    if (prop === Symbol.toPrimitive || prop === "then") return undefined;
    return () => explode(String(prop));
  },
};

export default new Proxy({}, trap);
export const auth = () => explode("auth");
export const db = new Proxy({}, trap);
