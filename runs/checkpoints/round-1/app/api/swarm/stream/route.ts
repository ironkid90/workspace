import { swarmStore } from "@/lib/swarm/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toSse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(toSse(event, payload)));
      };

      push("state", swarmStore.getState());

      const unsubscribe = swarmStore.subscribe((event) => {
        push("event", event);
        push("state", swarmStore.getState());
      });

      const keepAlive = setInterval(() => {
        push("ping", { ts: new Date().toISOString() });
      }, 10000);

      request.signal.addEventListener(
        "abort",
        () => {
          clearInterval(keepAlive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // no-op
          }
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
