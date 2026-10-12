import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PHONE_HEARTBEAT_INTERVAL_MS,
  startPhoneHeartbeat,
  watchPhoneClient,
} from "./phone_bridge_heartbeat";

function fakeClient(readyState = 1) {
  let onPong: () => void = () => {};
  const client = {
    readyState,
    ping: vi.fn(),
    send: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((_event: "pong", listener: () => void) => {
      onPong = listener;
    }),
  };
  return { client, pong: () => onPong() };
}

describe("phone heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings every 25 seconds by default", () => {
    expect(PHONE_HEARTBEAT_INTERVAL_MS).toBe(25_000);
  });

  it("pings a connected phone and sends it a heartbeat each round", () => {
    const { client } = fakeClient();
    watchPhoneClient(client);
    const stop = startPhoneHeartbeat(() => [client], 1000);

    vi.advanceTimersByTime(1000);
    expect(client.ping).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "heartbeat" }),
    );
    expect(client.terminate).not.toHaveBeenCalled();
    stop();
  });

  it("drops a phone that never answers the ping", () => {
    const { client } = fakeClient();
    watchPhoneClient(client);
    const stop = startPhoneHeartbeat(() => [client], 1000);

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(client.terminate).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps a phone that answers", () => {
    const { client, pong } = fakeClient();
    watchPhoneClient(client);
    const stop = startPhoneHeartbeat(() => [client], 1000);

    vi.advanceTimersByTime(1000);
    pong();
    vi.advanceTimersByTime(1000);
    pong();
    vi.advanceTimersByTime(1000);
    expect(client.ping).toHaveBeenCalledTimes(3);
    expect(client.terminate).not.toHaveBeenCalled();
    stop();
  });

  it("does not send a heartbeat message on a connection that is closing", () => {
    const { client } = fakeClient(2);
    watchPhoneClient(client);
    const stop = startPhoneHeartbeat(() => [client], 1000);

    vi.advanceTimersByTime(1000);
    expect(client.send).not.toHaveBeenCalled();
    stop();
  });

  it("keeps going when a ping throws", () => {
    const { client } = fakeClient();
    client.ping.mockImplementation(() => {
      throw new Error("not open");
    });
    watchPhoneClient(client);
    const stop = startPhoneHeartbeat(() => [client], 1000);

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    stop();
  });

  it("stops when asked", () => {
    const { client } = fakeClient();
    watchPhoneClient(client);
    const stop = startPhoneHeartbeat(() => [client], 1000);

    stop();
    vi.advanceTimersByTime(5000);
    expect(client.ping).not.toHaveBeenCalled();
  });
});
