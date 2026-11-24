# Builds GaziClient.apk without Gradle or Android Studio: just the Android SDK build tools and a JDK.
#
#   powershell -ExecutionPolicy Bypass -File android\build.ps1
#
# Needs: JDK 17, Android SDK with "platforms;android-34" and "build-tools;34.0.0" (see README).
# The signing key is made on the first run and kept outside the repo, in %USERPROFILE%\.gaziclient.
# Back it up: without the same key, phones will not accept an update over an older install.

param(
    [string]$Sdk = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }),
    [string]$KeyDir = "$env:USERPROFILE\.gaziclient"
)

# Not "Stop": PowerShell 5.1 treats anything a tool prints to stderr (cargo, java -version) as an
# error. Every step checks $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"

# The SDK tools need Java 17+. An old Java 8 on PATH (Oracle's java8path) breaks d8/apksigner,
# so point JAVA_HOME at a JDK 17+ if the current one is older.
function Get-JavaMajor([string]$javaExe)
{
    $text = (& $javaExe -version 2>&1 | Out-String)
    if ($text -match 'version "(\d+)(\.(\d+))?') { if ($Matches[1] -eq "1") { return [int]$Matches[3] } return [int]$Matches[1] }
    return 0
}
$javaOk = $env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe") -and ((Get-JavaMajor "$env:JAVA_HOME\bin\java.exe") -ge 17)
if (-not $javaOk)
{
    $jdk = Get-ChildItem "C:\Program Files\Microsoft", "C:\Program Files\Java", "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter javac.exe -Depth 3 -ErrorAction SilentlyContinue } |
        Where-Object { (Get-JavaMajor (Join-Path $_.DirectoryName "java.exe")) -ge 17 } | Select-Object -First 1
    if ($jdk -eq $null) { throw "JDK 17 or newer not found. Install one (e.g. Microsoft OpenJDK 17)." }
    $env:JAVA_HOME = Split-Path $jdk.DirectoryName
}
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

$here = $PSScriptRoot
$root = Split-Path $here
$tools = Join-Path $Sdk "build-tools\34.0.0"
$androidJar = Join-Path $Sdk "platforms\android-34\android.jar"
if (-not (Test-Path $tools) -or -not (Test-Path $androidJar))
{
    throw "Android SDK not found in $Sdk. Install it first, see the README."
}

# aapt2 cannot open paths with non-ASCII letters (like "projelerü"), so build in an ASCII temp folder
$out = Join-Path ([IO.Path]::GetTempPath()) "gaziclient-android"
if (Test-Path $out)
{
    Remove-Item -Recurse -Force $out
}
New-Item -ItemType Directory -Force "$out\assets", "$out\res\mipmap-xxxhdpi", "$out\classes", "$out\gen" | Out-Null

# 1. same runtime and plugins as the desktop exe
Push-Location $root
cargo build --release
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
Pop-Location
$export = Start-Process -FilePath "$root\target\release\gaziclient.exe" -ArgumentList "--export-mobile", "`"$out\assets`"" -Wait -PassThru
if ($export.ExitCode -ne 0) { throw "export failed" }
Move-Item "$out\assets\logo.png" "$out\res\mipmap-xxxhdpi\ic_launcher.png"

$version = (Select-String -Path "$root\Cargo.toml" -Pattern '^version = "(.+)"').Matches[0].Groups[1].Value
$parts = $version.Split(".")
$code = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]

# 2. resources + manifest
& "$tools\aapt2.exe" compile --dir "$out\res" -o "$out\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }
Copy-Item "$here\AndroidManifest.xml" "$out\AndroidManifest.xml"
& "$tools\aapt2.exe" link -I $androidJar --manifest "$out\AndroidManifest.xml" -A "$out\assets" -o "$out\base.apk" `
    --java "$out\gen" --min-sdk-version 24 --target-sdk-version 34 --version-code $code --version-name $version "$out\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

# 3. java -> dex
$sources = Get-ChildItem -Recurse "$here\src", "$out\gen" -Filter *.java | ForEach-Object { $_.FullName }
& javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$androidJar;$tools\core-lambda-stubs.jar" -classpath $androidJar -d "$out\classes" $sources
if ($LASTEXITCODE -ne 0) { throw "javac failed" }
$classes = Get-ChildItem -Recurse "$out\classes" -Filter *.class | ForEach-Object { $_.FullName }
& "$tools\d8.bat" --release --min-api 24 --lib $androidJar --output $out $classes
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }
Push-Location $out
& "$tools\aapt.exe" add base.apk classes.dex | Out-Null
Pop-Location

# 4. align + sign
& "$tools\zipalign.exe" -f -p 4 "$out\base.apk" "$out\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }
$keystore = Join-Path $KeyDir "release.keystore"
$passFile = Join-Path $KeyDir "keystore-password.txt"
if (-not (Test-Path $keystore))
{
    New-Item -ItemType Directory -Force $KeyDir | Out-Null
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $pass = [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
    Set-Content -Path $passFile -Value $pass -NoNewline -Encoding ascii
    & keytool -genkeypair -keystore $keystore -alias gaziclient -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $pass -keypass $pass -dname "CN=GaziClient, O=akgazii"
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
    Write-Host "New signing key: $keystore (password in $passFile). Back both up."
}
$apk = Join-Path $here "GaziClient-$version.apk"
& "$tools\apksigner.bat" sign --ks $keystore --ks-key-alias gaziclient --ks-pass "file:$passFile" --out $apk "$out\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }
Remove-Item "$apk.idsig" -ErrorAction SilentlyContinue
Write-Host "Built $apk"
