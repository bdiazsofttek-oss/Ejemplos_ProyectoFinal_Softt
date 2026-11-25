[CmdletBinding()]
param(
    [switch]$NoBuild,
    [ValidateRange(1, 600)]
    [int]$DockerStartupTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function New-HexSecret([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Get-EnvValue([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    $match = Get-Content -LiteralPath $Path | Where-Object {
        $_ -match "^$([regex]::Escape($Name))=(.*)$"
    } | Select-Object -Last 1

    if ($null -eq $match) {
        return $null
    }

    return ($match -replace "^$([regex]::Escape($Name))=", '')
}

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
    $content = if (Test-Path -LiteralPath $Path) {
        @(Get-Content -LiteralPath $Path)
    }
    else {
        @()
    }

    $pattern = "^$([regex]::Escape($Name))="
    $replacement = "$Name=$Value"
    $found = $false
    $updated = foreach ($line in $content) {
        if ($line -match $pattern) {
            if (-not $found) {
                $found = $true
                $replacement
            }
        }
        else {
            $line
        }
    }

    if (-not $found) {
        $updated = @($updated) + $replacement
    }

    Set-Content -LiteralPath $Path -Value $updated -Encoding UTF8
}

function Invoke-DockerProbe([string[]]$Arguments) {
    # Windows PowerShell 5.1 treats native stderr as an ErrorRecord. A failed
    # readiness probe must return its exit code instead of terminating here.
    $ErrorActionPreference = 'SilentlyContinue'
    $output = & $script:dockerExecutable @Arguments 2>$null
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
    throw 'Docker no esta instalado o no se encuentra en PATH. Instala Docker Desktop, inicialo y vuelve a ejecutar este comando.'
}
$script:dockerExecutable = $dockerCommand.Source

$composeVersion = Invoke-DockerProbe @('compose', 'version')
if ($composeVersion.ExitCode -ne 0) {
    throw 'No se encontro Docker Compose v2. Actualiza Docker Desktop y vuelve a intentarlo.'
}

$engine = Invoke-DockerProbe @('info', '--format', '{{.OSType}}')
if ($engine.ExitCode -ne 0) {
    $desktopProcess = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue
    if (-not $desktopProcess) {
        $desktopCandidates = @(
            (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
            (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $script:dockerExecutable))) 'Docker Desktop.exe')
        )
        $desktopExecutable = $desktopCandidates | Where-Object {
            Test-Path -LiteralPath $_ -PathType Leaf
        } | Select-Object -First 1
        if (-not $desktopExecutable) {
            throw 'El motor Docker no responde y no se encontro Docker Desktop. Abre Docker Desktop manualmente y vuelve a ejecutar este comando.'
        }

        Write-Step 'Iniciando Docker Desktop'
        Start-Process -FilePath $desktopExecutable -WindowStyle Hidden | Out-Null
    }

    Write-Step "Esperando el motor Docker (hasta $DockerStartupTimeoutSeconds segundos)"
    $startupTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $nextProgressSeconds = 15
    do {
        Start-Sleep -Seconds 3
        $engine = Invoke-DockerProbe @('info', '--format', '{{.OSType}}')
        if ($engine.ExitCode -eq 0) {
            break
        }
        if ($startupTimer.Elapsed.TotalSeconds -ge $nextProgressSeconds) {
            Write-Host 'Docker sigue iniciando. Revisa Docker Desktop si solicita completar la configuracion.'
            $nextProgressSeconds += 15
        }
    } while ($startupTimer.Elapsed.TotalSeconds -lt $DockerStartupTimeoutSeconds)

    if ($engine.ExitCode -ne 0) {
        throw 'Docker no estuvo listo dentro del tiempo de espera. Abre Docker Desktop, completa su configuracion inicial y revisa cualquier error de WSL 2. Luego vuelve a ejecutar npm run start:project.'
    }
}

if ($engine.Output.Trim() -ne 'linux') {
    throw 'Este proyecto requiere contenedores Linux. Cambia Docker Desktop a Linux containers y vuelve a ejecutar este comando.'
}

$rootEnv = Join-Path $projectRoot '.env'
$createdRootEnv = -not (Test-Path -LiteralPath $rootEnv)
if ($createdRootEnv) {
    Write-Step 'Creando configuracion local segura'
    Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination $rootEnv
}

$surrealUser = Get-EnvValue $rootEnv 'SURREAL_USER'
if ([string]::IsNullOrWhiteSpace($surrealUser)) {
    $surrealUser = 'posr'
    Set-EnvValue $rootEnv 'SURREAL_USER' $surrealUser
}

$surrealPass = Get-EnvValue $rootEnv 'SURREAL_PASS'
if ([string]::IsNullOrWhiteSpace($surrealPass) -or $surrealPass -eq 'CHANGE_ME_BEFORE_DEPLOY') {
    $surrealPass = New-HexSecret 24
    Set-EnvValue $rootEnv 'SURREAL_PASS' $surrealPass
}

$jwtSecret = Get-EnvValue $rootEnv 'GATEWAY_JWT_SECRET'
if ([string]::IsNullOrWhiteSpace($jwtSecret) -or $jwtSecret -like 'RUN_*') {
    $jwtSecret = New-HexSecret 48
    Set-EnvValue $rootEnv 'GATEWAY_JWT_SECRET' $jwtSecret
}

Set-EnvValue $rootEnv 'GATEWAY_PORT' '3142'

$serviceTemplates = @(
    @{ Template = 'api/.env.example'; Target = 'api/.env' },
    @{ Template = 'gateway/.env.example'; Target = 'gateway/.env' },
    @{ Template = 'payments/.env.example'; Target = 'payments/.env' }
)

foreach ($entry in $serviceTemplates) {
    $target = Join-Path $projectRoot $entry.Target
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $entry.Template) -Destination $target
        Set-EnvValue $target 'SURREAL_USER' $surrealUser
        Set-EnvValue $target 'SURREAL_PASS' $surrealPass
        Set-EnvValue $target 'GATEWAY_JWT_SECRET' $jwtSecret
    }
}

Write-Step 'Levantando POSR con Docker Compose'
$composeArgs = @(
    'compose',
    '-f', 'docker-compose.yml',
    '-f', 'docker-compose.override.yml',
    '-f', 'docker-compose.windows.yml',
    'up', '-d'
)
if (-not $NoBuild) {
    $composeArgs += '--build'
}

# Compose also writes normal progress to stderr; do not interpret that as a
# terminating PowerShell error. The native exit code determines success.
try {
    $ErrorActionPreference = 'Continue'
    & $script:dockerExecutable @composeArgs
    $composeExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = 'Stop'
}
if ($composeExitCode -ne 0) {
    throw "Docker Compose termino con el codigo $composeExitCode. Revisa el error mostrado arriba."
}

Write-Step 'Proyecto iniciado'
Write-Host 'Aplicacion: http://localhost:5173' -ForegroundColor Green
Write-Host 'Estado:     docker compose ps'
Write-Host 'Detener:    docker compose down'
