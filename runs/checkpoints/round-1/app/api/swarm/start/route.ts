import { NextResponse } from "next/server";

import { getActiveRunPromise, startSwarmRun } from "@/lib/swarm/engine";
import { swarmStore } from "@/lib/swarm/store";
import type { RunMode, SwarmFeatures } from "@/lib/swarm/types";

export const dynamic = "force-dynamic";

interface StartPayload {
  maxRounds?: number;
  workspace?: string;
  mode?: RunMode;
  features?: Partial<SwarmFeatures>;
}

export async function POST(request: Request) {
  const currentState = swarmStore.getState();
  if (currentState.running || getActiveRunPromise()) {
    return NextResponse.json(
      {
        error: "A swarm run is already active.",
        state: currentState,
      },
      { status: 409 },
    );
  }

  let payload: StartPayload = {};
  try {
    payload = (await request.json()) as StartPayload;
  } catch {
    payload = {};
  }

  try {
    const result = startSwarmRun({
      maxRounds: payload.maxRounds,
      workspace: payload.workspace,
      mode: payload.mode,
      features: payload.features,
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      mode: result.mode,
      features: result.features,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
