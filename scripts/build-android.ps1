param([switch]$Release)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$toolsRoot = Join-Path $taskRoot '.android-tools'
$env:JAVA_HOME = Join-Path $toolsRoot 'jdk'
$env:ANDROID_HOME = Join-Path $toolsRoot 'sdk'
$env:ANDROID_USER_HOME = Join-Path $toolsRoot 'user'
$env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle'
if (!(Test-Path (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { throw 'Run python scripts/setup-android.py first.' }
$projectRoot = Join-Path $taskRoot 'app/android'
# Android SDK is resolved from ANDROID_HOME; avoids locale-sensitive local.properties.
Push-Location (Join-Path $taskRoot 'app')
try {
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'UI sync failed' }
    Push-Location $projectRoot
    try {
        if($Release){ & .\gradlew.bat --no-daemon --console=plain assembleRelease lintRelease }
        else { & .\gradlew.bat --no-daemon --console=plain assembleDebug }
        if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed' }
    } finally { Pop-Location }
    $gradleSource = Get-Content -LiteralPath (Join-Path $projectRoot 'app/build.gradle') -Raw
    $version = [regex]::Match($gradleSource,'versionName\s+"([^"]+)"').Groups[1].Value
    if(!$version){throw 'Android versionName is missing'}
    if($Release){
        & (Join-Path $PSScriptRoot 'sign-android-release.ps1') -UnsignedApk (Join-Path $projectRoot 'app/build/outputs/apk/release/app-release-unsigned.apk') -Version $version
        if($LASTEXITCODE -ne 0){throw 'Release signing failed'}
        return
    }
    $delivery = Join-Path $taskRoot 'artifacts/android'
    New-Item -ItemType Directory -Path $delivery -Force | Out-Null
    $apk = Join-Path $delivery "essay-grader-android-$version-debug.apk"
    Copy-Item -LiteralPath (Join-Path $projectRoot 'app/build/outputs/apk/debug/app-debug.apk') -Destination $apk -Force
    Get-FileHash -LiteralPath $apk -Algorithm SHA256 | Format-List
} finally { Pop-Location }
