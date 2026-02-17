import { NextResponse } from "next/server";

import { approveSwarmPendingAction, pauseSwarmRun, resumeSwarmRun, rewindSwarmToRound } from "@/lib/swarm/engine";
import { swarmStore } from "@/lib/swarm/store";

export const dynamic = "force-dynamic";

interface ControlPayload {
  action?: "pause" | "resume" | "rewind" | "approve";
  reason?: string;
  round?: number;
}

export async function POST(request: Request) {
  let payload: ControlPayload = {};
  try {
    payload = (await request.json()) as ControlPayload;
  } catch {
    payload = {};
  }

  const action = payload.action;
  if (!action) {
    return NextResponse.json({ error: "Missing action." }, { status: 400 });
  }

  try {
    if (action === "pause") {
      const ok = pauseSwarmRun(payload.reason);
      return NextResponse.json({
        ok,
        action,
        state: swarmStore.getState(),
        message: ok ? "Run paused." : "Run was not paused.",
      });
    }

    if (action === "resume") {
      const ok = resumeSwarmRun();
      return NextResponse.json({
        ok,
        action,
        state: swarmStore.getState(),
        message: ok ? "Run resumed." : "Run was not resumed.",
      });
    }

    if (action === "approve") {
      const ok = approveSwarmPendingAction();
      return NextResponse.json({
        ok,
        action,
        state: swarmStore.getState(),
        message: ok ? "Pending action approved." : "No pending approval gate.",
      });
    }

    const round = Math.max(1, Math.floor(Number(payload.round)));
    if (!Number.isFinite(round)) {
      return NextResponse.json({ error: "A valid rewind round is required." }, { status: 400 });
    }

    const result = await rewindSwarmToRound(round);
    return NextResponse.json({
      ok: true,
      action,
      rewind: result,
      state: swarmStore.getState(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
