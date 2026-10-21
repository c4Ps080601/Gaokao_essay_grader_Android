param(
    [Parameter(Mandatory=$true)][string]$UnsignedApk,
    [string]$Version = '0.1.3'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$toolsRoot = Join-Path $taskRoot '.android-tools'
$javaRoot = Join-Path $toolsRoot 'jdk'
$buildTools = Join-Path $toolsRoot 'sdk/build-tools/35.0.0'
$env:JAVA_HOME = $javaRoot
$signingRoot = Join-Path $toolsRoot 'release-signing'
$keyFile = Join-Path $signingRoot 'essay-grader-release.p12'
$passwordFile = Join-Path $signingRoot 'password.dpapi'
$aliasName = 'essay-grader-release'
$deliveryRoot = Join-Path $taskRoot 'artifacts/android-release'
New-Item -ItemType Directory -Force -Path $signingRoot,$deliveryRoot | Out-Null
if ((Test-Path -LiteralPath $keyFile) -and !(Test-Path -LiteralPath $passwordFile)) {
    throw 'Signing password is missing. Recover it; do not replace the existing signing key.'
}
if (!(Test-Path -LiteralPath $passwordFile)) {
    $randomBytes = New-Object byte[] 48
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
    $securePassword = ConvertTo-SecureString -String ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
    # DPAPI protects this password for the current Windows account; no plaintext file is written.
    $securePassword | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile -Encoding ascii
} else {
    $securePassword = (Get-Content -LiteralPath $passwordFile -Raw).Trim() | ConvertTo-SecureString
}
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:ESSAY_RELEASE_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if (!(Test-Path -LiteralPath $keyFile)) {
        & (Join-Path $javaRoot 'bin/keytool.exe') -genkeypair -noprompt -storetype PKCS12 -keystore $keyFile -alias $aliasName -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -dname 'CN=Essay Grader Release,O=Essay Grader' -storepass:env ESSAY_RELEASE_STORE_PASSWORD -keypass:env ESSAY_RELEASE_STORE_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Release key generation failed' }
    }
    $alignedFile = Join-Path $deliveryRoot 'aligned-unsigned.apk'
    $finalFile = Join-Path $deliveryRoot "essay-grader-$Version-release.apk"
    # Native SDK executables on Windows require ASCII arguments for APK paths.
    $localUnsignedFile = Join-Path $deliveryRoot 'release-unsigned.apk'
    Copy-Item -LiteralPath $UnsignedApk -Destination $localUnsignedFile -Force
    Push-Location $deliveryRoot
    try {
        & (Join-Path $buildTools 'zipalign.exe') -f -P 16 4 'release-unsigned.apk' 'aligned-unsigned.apk'
        if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed' }
    } finally { Pop-Location }
    & (Join-Path $buildTools 'apksigner.bat') sign --ks $keyFile --ks-key-alias $aliasName --ks-pass env:ESSAY_RELEASE_STORE_PASSWORD --key-pass env:ESSAY_RELEASE_STORE_PASSWORD --out $finalFile $alignedFile
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
    & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $finalFile
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    Push-Location $deliveryRoot
    try {
        & (Join-Path $buildTools 'zipalign.exe') -c -P 16 4 (Split-Path $finalFile -Leaf)
        if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed' }
    } finally { Pop-Location }
    Remove-Item -LiteralPath $localUnsignedFile,$alignedFile -Force
    Get-FileHash -LiteralPath $finalFile -Algorithm SHA256
} finally {
    $env:ESSAY_RELEASE_STORE_PASSWORD = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
