param(
  [string]$OutputPath = "..\configurator-snapshot.json"
)

$ErrorActionPreference = "Stop"

$models = @(
  @{ Key = "G6"; Url = "https://www.xiaopeng.com/g6_2026/configuration.html"; FallbackName = "小鹏 G6" },
  @{ Key = "G9"; Url = "https://www.xiaopeng.com/g9_2026/configuration.html"; FallbackName = "小鹏 G9" },
  @{ Key = "X9"; Url = "https://www.xiaopeng.com/x9_2026/configuration.html"; FallbackName = "小鹏 X9" },
  @{ Key = "MONA M03"; Url = "https://www.xiaopeng.com/m03/configuration.html"; FallbackName = "小鹏 MONA M03" },
  @{ Key = "P7i"; Url = "https://www.xiaopeng.com/p7i/configuration.html"; FallbackName = "小鹏 P7i" }
)

function Clean-HtmlText {
  param([string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  $value = $Text `
    -replace "<br\s*/?>", "`n" `
    -replace "<sup>.*?</sup>", "" `
    -replace "<[^>]+>", "" `
    -replace "&nbsp;", " "
  return $value.Trim()
}

function Convert-PriceToWan {
  param($Price)

  if ($null -eq $Price) { return $null }
  $number = 0
  if (-not [double]::TryParse([string]$Price, [ref]$number)) { return $null }
  return [math]::Round($number / 10000, 2)
}

function Get-VariantAvailability {
  param(
    [object[]]$VariantNames,
    [object[]]$RowValues
  )

  $available = @()
  for ($i = 0; $i -lt $VariantNames.Count; $i++) {
    if ($i -ge $RowValues.Count) { continue }
    $value = [string]$RowValues[$i]
    if ($value -eq "-" -or [string]::IsNullOrWhiteSpace($value)) { continue }
    $available += [string]$VariantNames[$i]
  }
  return $available
}

function Parse-PriceFromLabel {
  param([string]$Label)

  $match = [regex]::Match($Label, "售价：￥([\d,]+)")
  if (-not $match.Success) { return 0 }
  return Convert-PriceToWan ($match.Groups[1].Value -replace ",", "")
}

function Parse-ThemeSection {
  param(
    [object]$Section,
    [object[]]$VariantNames
  )

  $colors = @()
  $interiors = @()
  $currentBucket = ""

  foreach ($row in $Section.data) {
    if ($row.extraClass -eq "mini-title") {
      $title = Clean-HtmlText $row.name
      if ($title -match "外观") {
        $currentBucket = "color"
      } elseif ($title -match "座舱|内饰") {
        $currentBucket = "interior"
      } else {
        $currentBucket = ""
      }
      continue
    }

    $item = [ordered]@{
      name = Clean-HtmlText $row.name
      premium = 0
      availableVariants = @(Get-VariantAvailability -VariantNames $VariantNames -RowValues $row.data)
    }

    if ($currentBucket -eq "color") {
      $colors += $item
    } elseif ($currentBucket -eq "interior") {
      $interiors += $item
    }
  }

  return [ordered]@{
    colors = $colors
    interiors = $interiors
  }
}

function Parse-PackageSection {
  param(
    [object]$Section,
    [object[]]$VariantNames
  )

  $packages = @()
  $current = $null

  foreach ($row in $Section.data) {
    if ($row.extraClass -eq "mini-title") {
      if ($null -ne $current) {
        $packages += $current
      }
      $label = Clean-HtmlText $row.name
      $current = [ordered]@{
        name = ($label -replace "（售价：￥[\d,]+）", "").Trim()
        price = Parse-PriceFromLabel $label
        desc = $null
        items = @()
        availableVariants = @()
        conflictsWith = @()
      }
      continue
    }

    if ($null -eq $current) { continue }

    $line = Clean-HtmlText $row.name
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      $current.items += $line
    }

    $available = @(Get-VariantAvailability -VariantNames $VariantNames -RowValues $row.data)
    foreach ($variant in $available) {
      if ($current.availableVariants -notcontains $variant) {
        $current.availableVariants += $variant
      }
    }
  }

  if ($null -ne $current) {
    $packages += $current
  }

  foreach ($package in $packages) {
    if ($package.items.Count -gt 0) {
      $package.desc = ($package.items -join "；")
    }
  }

  return $packages
}

function Parse-NotesAndConstraints {
  param(
    [string]$Tips,
    [object[]]$Packages
  )

  $plain = Clean-HtmlText $Tips
  $lines = $plain -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $notes = @()
  $restrictionNotes = @()
  $exteriorInterior = @()
  $exclusiveGroups = @()

  foreach ($line in $lines) {
    if ($line -eq "备注：" -or $line -match "标准配置|选装配置|无此配置") {
      continue
    }

    $notes += $line

    $colorMatch = [regex]::Match($line, "(.+?)外观色仅可选(.+?)座舱主题")
    if ($colorMatch.Success) {
      $color = $colorMatch.Groups[1].Value.Trim()
      $themes = $colorMatch.Groups[2].Value.Split("、") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
      $restrictionNotes += $line
      $exteriorInterior += [ordered]@{
        color = $color
        allowedInteriors = $themes
        note = $line
      }
      continue
    }

    $exclusiveMatch = [regex]::Match($line, "(.+?)与(.+?)，?只可选其一")
    if ($exclusiveMatch.Success) {
      $left = $exclusiveMatch.Groups[1].Value.Trim()
      $right = $exclusiveMatch.Groups[2].Value.Trim()
      $restrictionNotes += $line
      $exclusiveGroups += @(@($left, $right))
      foreach ($package in $Packages) {
        if ($package.name -eq $left -and $package.conflictsWith -notcontains $right) {
          $package.conflictsWith += $right
        }
        if ($package.name -eq $right -and $package.conflictsWith -notcontains $left) {
          $package.conflictsWith += $left
        }
      }
    }
  }

  return [ordered]@{
    notes = $notes
    restrictionNotes = ($restrictionNotes | Select-Object -Unique)
    constraints = [ordered]@{
      exteriorInterior = $exteriorInterior
      packageExclusiveGroups = $exclusiveGroups
    }
  }
}

function Normalize-DisplayName {
  param(
    [string]$Edition,
    [string]$FallbackName
  )

  if ([string]::IsNullOrWhiteSpace($Edition)) { return $FallbackName }
  $name = $Edition -replace "^\d{4}款", ""
  $name = $name -replace "\s+", " "
  return $name.Trim()
}

$result = [ordered]@{
  meta = [ordered]@{
    brand = "小鹏"
    version = (Get-Date -Format "yyyy-MM-dd")
    fetched_at = (Get-Date).ToUniversalTime().ToString("o")
    source_url = "https://www.xiaopeng.com/"
    disclaimer = "本数据为官网公开参数配置页抓取整理的本地快照，用于配置器演示。价格、配置、限制规则与交付信息请以小鹏官网和门店最新信息为准。"
  }
  models = @()
}

foreach ($model in $models) {
  Write-Host "Fetching $($model.Url)..."
  $html = Invoke-WebRequest -UseBasicParsing $model.Url | Select-Object -ExpandProperty Content
  $match = [regex]::Match($html, 'window\.__INITIAL_STATE__= (.*?);</script>', 'Singleline')
  if (-not $match.Success) {
    throw "INITIAL_STATE not found for $($model.Url)"
  }

  $state = $match.Groups[1].Value | ConvertFrom-Json
  $config = $state.configdata
  $variantNames = @($config.carType.data | ForEach-Object { [string]$_ })
  $prices = @($config.priceConfig.data)
  $themeSection = $config.data | Where-Object { $_.name -eq "主题选装" } | Select-Object -First 1
  $packageSection = $config.data | Where-Object { $_.name -eq "选装包" } | Select-Object -First 1

  $themeData = Parse-ThemeSection -Section $themeSection -VariantNames $variantNames
  $packages = Parse-PackageSection -Section $packageSection -VariantNames $variantNames
  $ruleData = Parse-NotesAndConstraints -Tips $config.tips -Packages $packages

  foreach ($rule in $ruleData.constraints.exteriorInterior) {
    foreach ($color in $themeData.colors) {
      if ($color.name -eq $rule.color) {
        $color.allowedInteriors = $rule.allowedInteriors
      }
    }
  }

  $variants = @()
  for ($i = 0; $i -lt $variantNames.Count; $i++) {
    $variants += [ordered]@{
      name = $variantNames[$i]
      price = Convert-PriceToWan $prices[$i]
      highlight = $null
    }
  }

  $result.models += [ordered]@{
    key = $model.Key
    brand = "小鹏"
    displayName = Normalize-DisplayName -Edition $config.edition -FallbackName $model.FallbackName
    source_url = $model.Url
    fetched_at = (Get-Date).ToUniversalTime().ToString("o")
    version = (Get-Date -Format "yyyy-MM-dd")
    variants = $variants
    colors = $themeData.colors
    interiors = $themeData.interiors
    packages = $packages
    notes = $ruleData.notes
    restrictionNotes = $ruleData.restrictionNotes
    constraints = $ruleData.constraints
  }
}

$resolvedOutput = Resolve-Path (Join-Path $PSScriptRoot $OutputPath)
$result | ConvertTo-Json -Depth 8 | Set-Content -Path $resolvedOutput -Encoding UTF8
Write-Host "Wrote snapshot to $resolvedOutput"
