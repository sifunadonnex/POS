$ErrorActionPreference = 'Stop'
$backend = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [System.IO.Path]::GetFullPath((Join-Path $backend '..'))
Push-Location $backend
try {
    & pnpm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed; no package created.' }

    # New output per invocation. Never delete or overwrite a previous release.
    $id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $output = Join-Path $workspace ('.local\releases\' + $id)
    $stage = Join-Path $output 'backend'
    New-Item -ItemType Directory -Path $stage | Out-Null
    $files = @('app.cjs', 'package.json', 'pnpm-lock.yaml')
    foreach ($directory in @('dist', 'migrations')) {
        foreach ($file in Get-ChildItem -LiteralPath (Join-Path $backend $directory) -Recurse -File) {
            if ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked release input.' }
            $relative = $file.FullName.Substring($backend.Length + 1)
            # Ship executable build output and reviewed SQL only, not maps, tests or secrets.
            if (($directory -eq 'dist' -and $file.Extension -eq '.js' -and $file.Name -notmatch 'spec\.js$') -or
                ($directory -eq 'migrations' -and $file.Extension -eq '.sql')) {
                $files += $relative
            }
        }
    }
    if ($files -notcontains 'dist\main.js' -or $files -notcontains 'dist\database\migrate.js') {
        throw 'Required compiled entrypoint missing.'
    }
    foreach ($relative in $files) {
        $source = Join-Path $backend $relative
        if ((Get-Item -LiteralPath $source).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked release input.' }
        $destination = Join-Path $stage $relative
        New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }
    Copy-Item -LiteralPath (Join-Path $workspace 'docs\HOSTPINNACLE_DEPLOYMENT.md') -Destination (Join-Path $stage 'DEPLOYMENT.md')
    $archive = Join-Path $output 'pay-and-go-backend.zip'
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $actual = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') } | Sort-Object)
        $expected = @(@($files | ForEach-Object { $_.Replace('\', '/') }) + 'DEPLOYMENT.md' | Sort-Object)
        if (Compare-Object $actual $expected) { throw 'Archive differs from the release allowlist.' }
        Write-Output ('Verified archive file count: ' + $actual.Count)
    } finally { $zip.Dispose() }
    Write-Output ('Upload archive: ' + $archive)
    Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash)
} finally { Pop-Location }
