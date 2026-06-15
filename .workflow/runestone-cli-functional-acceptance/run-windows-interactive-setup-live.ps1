$ErrorActionPreference='Continue'
$host.UI.RawUI.WindowTitle='RUNESTONE_SETUP_ACCEPTANCE'
Set-Location 'D:\projects\side-project\runestone\runestone-cli'
Start-Transcript -Path 'D:\projects\side-project\runestone\.workflow\runestone-cli-functional-acceptance\results\windows-interactive-setup-live.log' -Force
& 'C:\Users\cymondez\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\typescript\bin\tsc --project .\tsconfig.json
Write-Host '=== ACTUAL COMMAND: node .\bin\runestone setup ==='
& 'C:\Users\cymondez\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\bin\runestone setup
$exit=$LASTEXITCODE
Write-Host "=== SETUP_EXIT=$exit ==="
Set-Content -Path 'D:\projects\side-project\runestone\.workflow\runestone-cli-functional-acceptance\results\windows-interactive-setup.done' -Value $exit
Stop-Transcript
exit $exit
