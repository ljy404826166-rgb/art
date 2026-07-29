param(
  [string]$TargetRoot = 'F:\Artvee-Image-Archive-20260727',
  [string]$KeepDirectory = 'E:\Artvee-GPT-Repair-20260727-Rank09-Batch21-200\images'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$workDir = Join-Path $TargetRoot '_migration'
$manifestPath = Join-Path $workDir 'manifest.json'
$progressPath = Join-Path $workDir 'progress.json'
$completedPath = Join-Path $workDir 'completed.json'

function Save-JsonAtomic {
  param([string]$Path, [object]$Value)
  $tmp = "$Path.tmp"
  $json = $Value | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
  if ([System.IO.File]::Exists($Path)) {
    [System.IO.File]::Delete($Path)
  }
  [System.IO.File]::Move($tmp, $Path)
}

function Get-TargetPath {
  param([string]$SourcePath)
  $full = [System.IO.Path]::GetFullPath($SourcePath)
  if ($full.StartsWith('D:\', [System.StringComparison]::OrdinalIgnoreCase)) {
    return Join-Path $TargetRoot (Join-Path 'D' $full.Substring(3))
  }
  if ($full.StartsWith('E:\', [System.StringComparison]::OrdinalIgnoreCase)) {
    return Join-Path $TargetRoot (Join-Path 'E' $full.Substring(3))
  }
  throw "Unsupported source drive: $full"
}

function Assert-SourcePath {
  param([string]$Path)
  $full = [System.IO.Path]::GetFullPath($Path)
  $isEarly = $full.Equals('D:\art\csv\images', [System.StringComparison]::OrdinalIgnoreCase)
  $isBatch = $full.StartsWith('E:\Artvee-GPT-Repair-', [System.StringComparison]::OrdinalIgnoreCase) -and
    $full.EndsWith('\images', [System.StringComparison]::OrdinalIgnoreCase)
  if (-not ($isEarly -or $isBatch)) {
    throw "Rejected source path: $full"
  }
  if ($full.Equals([System.IO.Path]::GetFullPath($KeepDirectory), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Keep directory must not be migrated: $full"
  }
}

function Remove-EmptyTree {
  param([string]$Root)
  if (-not [System.IO.Directory]::Exists($Root)) { return }
  $dirs = Get-ChildItem -LiteralPath $Root -Directory -Recurse -Force |
    Sort-Object { $_.FullName.Length } -Descending
  foreach ($dir in $dirs) {
    if (@([System.IO.Directory]::EnumerateFileSystemEntries($dir.FullName)).Count -eq 0) {
      [System.IO.Directory]::Delete($dir.FullName, $false)
    }
  }
  if (@([System.IO.Directory]::EnumerateFileSystemEntries($Root)).Count -eq 0) {
    [System.IO.Directory]::Delete($Root, $false)
  }
}

[System.IO.Directory]::CreateDirectory($TargetRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($workDir) | Out-Null

if (Test-Path -LiteralPath $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
} else {
  $sources = @('D:\art\csv\images')
  $sources += @(Get-ChildItem -LiteralPath 'E:\' -Directory -Filter 'Artvee-GPT-Repair-*' |
    ForEach-Object { Join-Path $_.FullName 'images' } |
    Where-Object {
      (Test-Path -LiteralPath $_) -and
      -not ([System.IO.Path]::GetFullPath($_).Equals(
        [System.IO.Path]::GetFullPath($KeepDirectory),
        [System.StringComparison]::OrdinalIgnoreCase
      ))
    })

  $entries = foreach ($source in $sources) {
    Assert-SourcePath $source
    $sourceItem = Get-Item -LiteralPath $source
    if ($sourceItem.LinkType -eq 'Junction') { continue }
    $files = @(Get-ChildItem -LiteralPath $source -File -Recurse -Force)
    [pscustomobject]@{
      source = [System.IO.Path]::GetFullPath($source)
      target = [System.IO.Path]::GetFullPath((Get-TargetPath $source))
      files = $files.Count
      bytes = [int64](($files | Measure-Object Length -Sum).Sum)
    }
  }
  $manifest = [pscustomobject]@{
    version = 1
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    targetRoot = [System.IO.Path]::GetFullPath($TargetRoot)
    keepDirectory = [System.IO.Path]::GetFullPath($KeepDirectory)
    entries = @($entries)
    totalDirectories = @($entries).Count
    totalFiles = (@($entries) | Measure-Object files -Sum).Sum
    totalBytes = [int64]((@($entries) | Measure-Object bytes -Sum).Sum)
  }
  Save-JsonAtomic -Path $manifestPath -Value $manifest
}

$completed = @()
if (Test-Path -LiteralPath $completedPath) {
  $completed = @(Get-Content -LiteralPath $completedPath -Raw | ConvertFrom-Json)
}

$movedFiles = 0
$movedBytes = [int64]0
$startedAt = (Get-Date).ToUniversalTime().ToString('o')

foreach ($entry in @($manifest.entries)) {
  $source = [string]$entry.source
  $target = [string]$entry.target
  Assert-SourcePath $source
  if (-not $target.StartsWith(
    [System.IO.Path]::GetFullPath($TargetRoot),
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Rejected target path: $target"
  }

  $sourceItem = Get-Item -LiteralPath $source -ErrorAction SilentlyContinue
  if ($sourceItem -and $sourceItem.LinkType -eq 'Junction') {
    if (-not (@($sourceItem.Target) -contains $target)) {
      throw "Unexpected junction target for $source"
    }
    if ($completed -notcontains $source) {
      $completed += $source
      Save-JsonAtomic -Path $completedPath -Value @($completed)
    }
    continue
  }

  [System.IO.Directory]::CreateDirectory($target) | Out-Null

  if (Test-Path -LiteralPath $source) {
    $files = @(Get-ChildItem -LiteralPath $source -File -Recurse -Force)
    foreach ($file in $files) {
      $sourcePrefix = $source.TrimEnd('\')
      if (-not $file.FullName.StartsWith(
        "$sourcePrefix\",
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
        throw "File escaped source directory: $($file.FullName)"
      }
      $relative = $file.FullName.Substring($sourcePrefix.Length + 1)
      $destination = Join-Path $target $relative
      $destinationDir = [System.IO.Path]::GetDirectoryName($destination)
      [System.IO.Directory]::CreateDirectory($destinationDir) | Out-Null

      if (Test-Path -LiteralPath $destination) {
        $destItem = Get-Item -LiteralPath $destination
        if ($destItem.Length -ne $file.Length) {
          throw "Size conflict: $destination"
        }
        [System.IO.File]::Delete($file.FullName)
      } else {
        Move-Item -LiteralPath $file.FullName -Destination $destination
        $destItem = Get-Item -LiteralPath $destination
        if ($destItem.Length -ne $file.Length) {
          throw "Post-move size mismatch: $destination"
        }
      }

      $movedFiles++
      $movedBytes += [int64]$destItem.Length
      if (($movedFiles % 10) -eq 0) {
        Save-JsonAtomic -Path $progressPath -Value ([pscustomobject]@{
          status = 'running'
          startedAt = $startedAt
          updatedAt = (Get-Date).ToUniversalTime().ToString('o')
          currentSource = $source
          movedFilesThisRun = $movedFiles
          movedBytesThisRun = $movedBytes
          completedDirectories = @($completed).Count
          totalDirectories = $manifest.totalDirectories
        })
      }
    }
    Remove-EmptyTree $source
  }

  if (-not (Test-Path -LiteralPath $source)) {
    New-Item -ItemType Junction -Path $source -Target $target | Out-Null
  }

  $link = Get-Item -LiteralPath $source
  if ($link.LinkType -ne 'Junction' -or -not (@($link.Target) -contains $target)) {
    throw "Failed to establish junction: $source -> $target"
  }

  if ($completed -notcontains $source) {
    $completed += $source
    Save-JsonAtomic -Path $completedPath -Value @($completed)
  }
}

Save-JsonAtomic -Path $progressPath -Value ([pscustomobject]@{
  status = 'completed'
  startedAt = $startedAt
  completedAt = (Get-Date).ToUniversalTime().ToString('o')
  movedFilesThisRun = $movedFiles
  movedBytesThisRun = $movedBytes
  completedDirectories = @($completed).Count
  totalDirectories = $manifest.totalDirectories
  targetRoot = $manifest.targetRoot
  keepDirectory = $manifest.keepDirectory
})

Write-Output "Migration completed: $($manifest.totalDirectories) directories, $($manifest.totalFiles) files."
