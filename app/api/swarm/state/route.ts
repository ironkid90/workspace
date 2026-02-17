import { NextResponse } from "next/server";

import { swarmStore } from "@/lib/swarm/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = swarmStore.getState();
  return NextResponse.json({
    state,
    capabilities: {
      supportsLocalExecution: !process.env.VERCEL,
      supportsPauseResume: state.features.humanInLoop,
      supportsRewind: state.features.checkpointing,
    },
  });
}
