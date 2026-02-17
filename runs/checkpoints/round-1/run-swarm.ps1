param(
  [string]$Workspace = "",
  [int]$MaxRounds = 3,
  [ValidateSet("local", "demo")]
  [string]$Mode = "local",
  [switch]$Setup,
  [switch]$Deploy,
  [switch]$Prod,
  [switch]$Legacy
)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
if ($Setup) {
    npm run swarm:setup
    exit $LASTEXITCODE
}

if ($Deploy) {
    $deployArgs = @("run", "swarm:deploy", "--")
    if (-not [string]::IsNullOrWhiteSpace($Workspace)) {
        $deployArgs += @("--path", $Workspace)
    }
    if ($Prod) {
        $deployArgs += "--prod"
    }

    npm @deployArgs
    exit $LASTEXITCODE
}

if (-not $Legacy) {
    $runArgs = @("run", "swarm:run", "--", "--max-rounds", $MaxRounds, "--mode", $Mode)
    if (-not [string]::IsNullOrWhiteSpace($Workspace)) {
        $runArgs += @("--workspace", $Workspace)
    }
    npm @runArgs
    exit $LASTEXITCODE
}

if ([string]::IsNullOrWhiteSpace($Workspace)) {
    $Workspace = $Root
}
$Workspace = Resolve-Path $Workspace
$Prompts = Join-Path $Root "prompts"
$Runs = Join-Path $Root "runs"
if (-not (Test-Path $Runs)) { New-Item -ItemType Directory -Force $Runs | Out-Null }

function Invoke-CodexExec {
  param(
    [string]$Ws,
    [string]$PromptText,
    [string]$OutFile
  )
  $tmp = Join-Path $env:TEMP ("codex_prompt_" + [guid]::NewGuid().ToString() + ".md")
  $PromptText | Set-Content -Path $tmp -Encoding UTF8
  try {
    Write-Host "  -> Running Codex for $(Split-Path $OutFile -Leaf)..." -ForegroundColor Gray
    # Using --dangerously-bypass-approvals-and-sandbox for full autonomous capability
    codex --dangerously-bypass-approvals-and-sandbox exec --cd $Ws --skip-git-repo-check --json (Get-Content $tmp -Raw) -o $OutFile | Out-Null
    if (-not (Test-Path $OutFile)) {
        throw "Failed to produce output file: $OutFile"
    }
  } catch {
    Write-Host "  !! Error running Codex for $(Split-Path $OutFile -Leaf): $_" -ForegroundColor Red
    "ERROR: $_" | Set-Content $OutFile
  } finally {
    if (Test-Path $tmp) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
  }
}

$prevEvaluator = ""

for ($round = 1; $round -le $MaxRounds; $round++) {
  Write-Host "`n=== Round $round ===" -ForegroundColor Cyan
  $roundDir = Join-Path $Runs ("round-" + $round)
  if (-not (Test-Path $roundDir)) { New-Item -ItemType Directory -Force $roundDir | Out-Null }

  $w1 = Get-Content (Join-Path $Prompts "worker1.md") -Raw
  $w2 = Get-Content (Join-Path $Prompts "worker2.md") -Raw
  $ev = Get-Content (Join-Path $Prompts "evaluator.md") -Raw
  $co = Get-Content (Join-Path $Prompts "coordinator.md") -Raw

  if ($prevEvaluator) {
    $feedback = "`n`n--- PREVIOUS EVALUATOR FEEDBACK ---`n$prevEvaluator"
    $w1 += $feedback
    $w2 += $feedback
    $ev += $feedback
  }

  $w1Out = Join-Path $roundDir "worker1.md"
  $w2Out = Join-Path $roundDir "worker2.md"
  $evOut = Join-Path $roundDir "evaluator.md"
  $coOut = Join-Path $roundDir "coordinator.md"

  Write-Host "Running Worker-1, Worker-2, and Evaluator in parallel..."
  $jobs = @(
    Start-Job -ScriptBlock ${function:Invoke-CodexExec} -ArgumentList $Workspace, $w1, $w1Out
    Start-Job -ScriptBlock ${function:Invoke-CodexExec} -ArgumentList $Workspace, $w2, $w2Out
    Start-Job -ScriptBlock ${function:Invoke-CodexExec} -ArgumentList $Workspace, $ev, $evOut
  )

  $jobs | Wait-Job | Out-Null
  # Suppress noisy MCP errors during parallel runs
  $jobs | Receive-Job -ErrorAction SilentlyContinue | Out-Null
  $jobs | Remove-Job | Out-Null

  $worker1Text = if (Test-Path $w1Out) { Get-Content $w1Out -Raw } else { "Missing worker1 output" }
  $worker2Text = if (Test-Path $w2Out) { Get-Content $w2Out -Raw } else { "Missing worker2 output" }
  $evaluatorText = if (Test-Path $evOut) { Get-Content $evOut -Raw } else { "Missing evaluator output" }
  $prevEvaluator = $evaluatorText

  Write-Host "Running Coordinator..."
  $coPrompt = @"
$co

Round: $round
RoundDir: $roundDir

Worker-1 Output:
$worker1Text

Worker-2 Output:
$worker2Text

Evaluator Output:
$evaluatorText
"@

  Invoke-CodexExec -Ws $Workspace -PromptText $coPrompt -OutFile $coOut
  
  if (Test-Path $coOut) {
    $lastCoordinator = Get-Content $coOut -Raw
    if ($lastCoordinator -match "STATUS:\s*PASS") {
      Write-Host "Coordinator signaled PASS. Ending swarm." -ForegroundColor Green
      break
    }
  } else {
    Write-Host "Coordinator failed to produce output." -ForegroundColor Red
  }
}

Write-Host "`nSwarm run complete."
Write-Host "Runs directory: $Runs"
