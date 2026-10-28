<#
.SYNOPSIS
    Registers CaskaydiaCove Nerd Fonts in Windows and configures terminal/editor font settings.

.DESCRIPTION
    Invoked across the WSL boundary or natively on Windows. Registers installed font files with
    Windows GDI and registry, and updates font settings in Windows Terminal and known editors
    (VS Code, Cursor, Devin, Antigravity, VSCodium).
    Protects against JSON comment stripping by skipping files with comments and printing a warning.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$FontName = 'CaskaydiaCove NF',
    [string]$FontFamily = "'CaskaydiaCove NF', 'CaskaydiaCove Nerd Font'"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Register-WindowsFonts {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$FontsDirectory,
        [string]$RegistryPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
    )

    if (-not (Test-Path -LiteralPath $FontsDirectory)) {
        return
    }

    $fontFiles = Get-ChildItem -LiteralPath $FontsDirectory -Filter 'CaskaydiaCove*.ttf' -ErrorAction SilentlyContinue
    if (-not $fontFiles) {
        return
    }

    if (-not ([System.Management.Automation.PSTypeName]'FontHelper').Type) {
        $win32Type = @'
using System;
using System.Runtime.InteropServices;
public class FontHelper {
    [DllImport("gdi32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int AddFontResource(string lpFileName);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
'@
        Add-Type -TypeDefinition $win32Type -ErrorAction SilentlyContinue
    }

    foreach ($file in $fontFiles) {
        if ($PSCmdlet.ShouldProcess($file.FullName, "Register font in GDI and Registry")) {
            try {
                [FontHelper]::AddFontResource($file.FullName) | Out-Null
            } catch {
                Write-Verbose "Could not add font resource for $($file.Name): $_"
            }

            try {
                Add-Type -AssemblyName PresentationCore -ErrorAction Stop
                $fontUri = New-Object System.Uri($file.FullName)
                $gt = New-Object System.Windows.Media.GlyphTypeface($fontUri)
                $win32Family = $gt.Win32FamilyNames.Values | Select-Object -First 1
                $win32Face = $gt.Win32FaceNames.Values | Select-Object -First 1
                $regName = if ($win32Face -eq 'Regular') { "$win32Family (TrueType)" } else { "$win32Family $win32Face (TrueType)" }
                Set-ItemProperty -LiteralPath $RegistryPath -Name $regName -Value $file.FullName -Type String -Force -ErrorAction SilentlyContinue | Out-Null

                foreach ($fam in $gt.FamilyNames.Values) {
                    if ($fam -ne $win32Family) {
                        $regName2 = if ($win32Face -eq 'Regular') { "$fam (TrueType)" } else { "$fam $win32Face (TrueType)" }
                        Set-ItemProperty -LiteralPath $RegistryPath -Name $regName2 -Value $file.FullName -Type String -Force -ErrorAction SilentlyContinue | Out-Null
                    }
                }
            } catch {
                Write-Verbose "Could not register GlyphTypeface for $($file.Name): $_"
            }
        }
    }

    try {
        $HWND_BROADCAST = [IntPtr]0xffff
        $WM_FONTCHANGE = 0x001d
        $result = [IntPtr]::Zero
        # Use SendMessageTimeout (SMTO_ABORTIFHUNG = 2) with 1000ms timeout to avoid hanging on unresponsive windows
        [FontHelper]::SendMessageTimeout($HWND_BROADCAST, $WM_FONTCHANGE, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$result) | Out-Null
    } catch {
        Write-Verbose "Could not broadcast WM_FONTCHANGE: $_"
    }
}

function Update-WindowsTerminalSettings {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$LocalAppDataDirectory,
        [string]$TargetFontName
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    $wtPaths = @(
        (Join-Path $LocalAppDataDirectory 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'),
        (Join-Path $LocalAppDataDirectory 'Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json'),
        (Join-Path $LocalAppDataDirectory 'Microsoft\Windows Terminal\settings.json')
    )

    foreach ($settingsPath in $wtPaths) {
        if (-not (Test-Path -LiteralPath $settingsPath)) {
            continue
        }

        try {
            $raw = Get-Content -LiteralPath $settingsPath -Raw -ErrorAction Stop
            if ([string]::IsNullOrWhiteSpace($raw)) {
                continue
            }

            # Avoid stripping comments on rewrite if settings.json contains comments
            if ($raw -match '(?m)^\s*//' -or $raw -match '/\*') {
                Write-Warning "Windows Terminal settings '$settingsPath' contains comments; skipping automated rewrite to prevent comment loss. Please configure font face '$TargetFontName' manually."
                continue
            }

            $settings = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
            if (-not $settings.profiles.defaults) {
                $settings.profiles.defaults = [pscustomobject]@{}
            }
            if (-not $settings.profiles.defaults.font) {
                $settings.profiles.defaults | Add-Member -NotePropertyName font -NotePropertyValue ([pscustomobject]@{}) -Force
            }
            $settings.profiles.defaults.font | Add-Member -NotePropertyName face -NotePropertyValue $TargetFontName -Force

            if ($settings.profiles.list) {
                foreach ($profile in $settings.profiles.list) {
                    if ($profile.font -and $profile.font.face -eq 'CaskaydiaCove Nerd Font') {
                        $profile.font.face = $TargetFontName
                    }
                    if ($profile.name -like '*Ubuntu*' -or $profile.source -in @('Microsoft.WSL', 'Windows.Terminal.Wsl')) {
                        if (-not $profile.font) {
                            $profile | Add-Member -NotePropertyName font -NotePropertyValue ([pscustomobject]@{}) -Force
                        }
                        $profile.font | Add-Member -NotePropertyName face -NotePropertyValue $TargetFontName -Force
                    }
                }
            }

            $jsonContent = $settings | ConvertTo-Json -Depth 32
            if ($PSCmdlet.ShouldProcess($settingsPath, "Update Windows Terminal font to '$TargetFontName'")) {
                [System.IO.File]::WriteAllText($settingsPath, $jsonContent + [Environment]::NewLine, $utf8NoBom)
            }
        } catch {
            Write-Warning "Could not parse Windows Terminal settings at '$settingsPath': $($_.Exception.Message)"
        }
    }
}

function Update-KnownEditorSettings {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$AppDataDirectory,
        [string]$TargetFontFamily
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    # Limit edits to known editor list (no %APPDATA%\* discovery)
    $knownEditors = @(
        'Code',
        'Code - Insiders',
        'Cursor',
        'Devin',
        'Antigravity',
        'Antigravity IDE',
        'VSCodium'
    )

    foreach ($editor in $knownEditors) {
        $settingsPath = Join-Path $AppDataDirectory (Join-Path $editor 'User\settings.json')
        if (-not (Test-Path -LiteralPath $settingsPath)) {
            continue
        }

        try {
            $raw = Get-Content -LiteralPath $settingsPath -Raw -ErrorAction Stop
            if ([string]::IsNullOrWhiteSpace($raw)) {
                continue
            }

            # Avoid stripping comments on rewrite if settings.json contains comments
            if ($raw -match '(?m)^\s*//' -or $raw -match '/\*') {
                Write-Warning "Editor settings for $editor at '$settingsPath' contains comments; skipping automated rewrite to prevent comment loss. Please configure editor fonts manually."
                continue
            }

            $settings = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
            $settings | Add-Member -NotePropertyName 'terminal.integrated.fontFamily' -NotePropertyValue $TargetFontFamily -Force

            $jsonContent = $settings | ConvertTo-Json -Depth 32
            if ($PSCmdlet.ShouldProcess($settingsPath, "Update $editor font settings")) {
                [System.IO.File]::WriteAllText($settingsPath, $jsonContent + [Environment]::NewLine, $utf8NoBom)
            }
        } catch {
            Write-Warning "Could not parse editor settings for $editor at '$settingsPath': $($_.Exception.Message)"
        }
    }
}

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$appData = [Environment]::GetFolderPath('ApplicationData')

if ($localAppData) {
    $fontsDirectory = Join-Path $localAppData 'Microsoft\Windows\Fonts'
    Register-WindowsFonts -FontsDirectory $fontsDirectory
    Update-WindowsTerminalSettings -LocalAppDataDirectory $localAppData -TargetFontName $FontName
}

if ($appData) {
    Update-KnownEditorSettings -AppDataDirectory $appData -TargetFontFamily $FontFamily
}
