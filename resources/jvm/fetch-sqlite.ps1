# Fetch pinned desktop SQLite dependencies (binary JVM assets are ignored by git).
param([string]$Out = "")
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrEmpty($Out)) { $Out = Join-Path $PSScriptRoot "libs" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$assets = @(
  @{ Path = "org/xerial/sqlite-jdbc/3.46.1.0/sqlite-jdbc-3.46.1.0.jar"; Hash = "6DC7464E3803648D3FF18A7359BAB6ADF079FCD8495B18991F6F5EDCB8AC6E3B" },
  @{ Path = "org/slf4j/slf4j-api/2.0.16/slf4j-api-2.0.16.jar"; Hash = "A12578DDE1BA00BD9B816D388A0B879928D00BAB3C83C240F7013BF4196C579A" },
  @{ Path = "org/slf4j/slf4j-simple/2.0.16/slf4j-simple-2.0.16.jar"; Hash = "EFFC32018658BEA09D1E08C7D1060CCAD46C086960F583D07DD7FFE9C1172A47" }
)
foreach ($asset in $assets) {
  $target = Join-Path $Out ([IO.Path]::GetFileName($asset.Path))
  if ((Test-Path $target) -and (Get-FileHash $target -Algorithm SHA256).Hash -eq $asset.Hash) { continue }
  $temporary = $target + ".download-" + [guid]::NewGuid().ToString("N")
  try {
    Invoke-WebRequest -UseBasicParsing -Uri ("https://repo.maven.apache.org/maven2/" + $asset.Path) -OutFile $temporary
    if ((Get-FileHash $temporary -Algorithm SHA256).Hash -ne $asset.Hash) { throw "Hash mismatch: $($asset.Path)" }
    Move-Item -Force $temporary $target
  } finally { if (Test-Path $temporary) { Remove-Item $temporary } }
}
