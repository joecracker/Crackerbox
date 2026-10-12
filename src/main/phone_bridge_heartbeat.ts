// Keeps the phone's connection to the laptop honest. Every few seconds the
// laptop sends a ping and a small "heartbeat" message. Traffic on the line stops
// it from going idle, the phone page uses the heartbeat to notice a dead line,
// and a phone that stops answering is dropped here instead of lingering as a
// connection that only looks open.
export const PHONE_HEARTBEAT_INTERVAL_MS = 25_000;

const WS_OPEN = 1;

export interface PhoneHeartbeatClient {
  readyState: number;
  ping(): void;
  send(data: string): void;
  terminate(): void;
  on(event: "pong", listener: () => void): unknown;
}

const answered = new WeakMap<object, boolean>();

// Call once when a phone connects.
export function watchPhoneClient(client: PhoneHeartbeatClient): void {
  answered.set(client, true);
  client.on("pong", () => answered.set(client, true));
}

// Returns a function that stops the heartbeat.
export function startPhoneHeartbeat(
  getClients: () => Iterable<PhoneHeartbeatClient>,
  intervalMs: number = PHONE_HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    for (const client of getClients()) {
      if (answered.get(client) === false) {
        // It never answered the last ping: the line is dead.
        client.terminate();
        continue;
      }
      answered.set(client, false);
      try {
        client.ping();
        if (client.readyState === WS_OPEN) {
          client.send(JSON.stringify({ type: "heartbeat" }));
        }
      } catch {
        // A client that is closing can throw; the close handler cleans up.
      }
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
