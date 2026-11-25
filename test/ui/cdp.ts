// A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
// Used for our pages (strip, divider, overlay), Onshape's pages, and the main
// process (via the Node inspector, which speaks the same protocol).

export interface Target {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export async function listTargets(port: number): Promise<Target[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await res.json()) as Target[];
}

export class Cdp {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data));
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener(
        'error',
        () => reject(new Error(`CDP: can't connect to ${url}`)),
        {
          once: true,
        },
      );
    });
    return new Cdp(ws);
  }

  send<T = unknown>(method: string, params?: object): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Evaluates an expression (awaiting promises) and returns its JSON value.
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{
      result: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    }
    return r.result.value as T;
  }

  close(): void {
    this.ws.close();
  }
}
