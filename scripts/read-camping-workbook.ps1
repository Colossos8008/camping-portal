param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [string]$SheetName = "CampingplÃ¤tze",
  [int]$HeaderRow = 1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-EntryText {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Compression.ZipArchive]$Zip,
    [Parameter(Mandatory = $true)]
    [string]$EntryName
  )

  $entry = $Zip.Entries | Where-Object { $_.FullName -eq $EntryName } | Select-Object -First 1
  if (-not $entry) {
    throw "Entry not found: $EntryName"
  }

  $reader = New-Object System.IO.StreamReader($entry.Open())
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

function Get-CellValue {
  param(
    [Parameter(Mandatory = $true)]
    [System.Xml.XmlElement]$Cell,
    [Parameter(Mandatory = $true)]
    [System.Xml.XmlNamespaceManager]$Ns,
    [string[]]$SharedStrings
  )

  $type = $Cell.GetAttribute("t")

  if ($type -eq "inlineStr") {
    $parts = $Cell.SelectNodes("./x:is/x:t | ./x:is/x:r/x:t", $Ns)
    if (-not $parts) {
      return ""
    }

    return (($parts | ForEach-Object { $_.InnerText }) -join "")
  }

  $valueNode = $Cell.SelectSingleNode("./x:v", $Ns)
  if (-not $valueNode) {
    return ""
  }

  if ($type -eq "s") {
    $index = [int]$valueNode.InnerText
    if ($index -ge 0 -and $index -lt $SharedStrings.Length) {
      return $SharedStrings[$index]
    }
    return ""
  }

  return $valueNode.InnerText
}

function Get-ColumnLetters {
  param([Parameter(Mandatory = $true)][string]$CellRef)

  return ($CellRef -replace "\d", "")
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)

try {
  $workbookXml = [xml](Get-EntryText -Zip $zip -EntryName "xl/workbook.xml")
  $workbookRelsXml = [xml](Get-EntryText -Zip $zip -EntryName "xl/_rels/workbook.xml.rels")

  $sharedStrings = @()
  $sharedStringsEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/sharedStrings.xml" } | Select-Object -First 1
  if ($sharedStringsEntry) {
    $sharedStringsXml = [xml](Get-EntryText -Zip $zip -EntryName "xl/sharedStrings.xml")
    $sharedNs = New-Object System.Xml.XmlNamespaceManager($sharedStringsXml.NameTable)
    $sharedNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
    $siNodes = $sharedStringsXml.SelectNodes("//x:sst/x:si", $sharedNs)

    foreach ($si in $siNodes) {
      $parts = $si.SelectNodes("./x:t | ./x:r/x:t", $sharedNs)
      if (-not $parts) {
        $sharedStrings += ""
        continue
      }

      $sharedStrings += (($parts | ForEach-Object { $_.InnerText }) -join "")
    }
  }

  $workbookNs = New-Object System.Xml.XmlNamespaceManager($workbookXml.NameTable)
  $workbookNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  $workbookNs.AddNamespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")

  $sheetNode = $workbookXml.SelectSingleNode("//x:sheets/x:sheet[@name=""$SheetName""]", $workbookNs)
  if (-not $sheetNode) {
    throw "Worksheet '$SheetName' not found."
  }

  $sheetRelId = $sheetNode.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
  $sheetRelNode = $workbookRelsXml.Relationships.Relationship | Where-Object { $_.Id -eq $sheetRelId } | Select-Object -First 1
  if (-not $sheetRelNode) {
    throw "Relationship for worksheet '$SheetName' not found."
  }

  $sheetTarget = [string]$sheetRelNode.Target
  if ($sheetTarget.StartsWith("/")) {
    $sheetTarget = $sheetTarget.TrimStart("/")
  }
  if (-not $sheetTarget.StartsWith("xl/")) {
    $sheetTarget = "xl/" + $sheetTarget
  }
  $sheetXml = [xml](Get-EntryText -Zip $zip -EntryName $sheetTarget)

  $sheetNs = New-Object System.Xml.XmlNamespaceManager($sheetXml.NameTable)
  $sheetNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

  $rows = $sheetXml.SelectNodes("//x:sheetData/x:row", $sheetNs)
  if (-not $rows -or $rows.Count -eq 0) {
    throw "Worksheet '$SheetName' is empty."
  }

  $headerRowXml = $rows | Where-Object { [int]$_.GetAttribute("r") -eq $HeaderRow } | Select-Object -First 1
  if (-not $headerRowXml) {
    throw "Header row '$HeaderRow' was not found in worksheet '$SheetName'."
  }

  $headerMap = @{}
  foreach ($cell in $headerRowXml.SelectNodes("./x:c", $sheetNs)) {
    $column = Get-ColumnLetters -CellRef $cell.GetAttribute("r")
    $headerMap[$column] = Get-CellValue -Cell $cell -Ns $sheetNs -SharedStrings $sharedStrings
  }

  $result = New-Object System.Collections.Generic.List[object]

  foreach ($row in $rows) {
    if ([int]$row.GetAttribute("r") -le $HeaderRow) {
      continue
    }

    $item = [ordered]@{
      __rowNumber = [int]$row.GetAttribute("r")
    }

    foreach ($cell in $row.SelectNodes("./x:c", $sheetNs)) {
      $column = Get-ColumnLetters -CellRef $cell.GetAttribute("r")
      $header = $headerMap[$column]
      if (-not $header) {
        continue
      }

      $item[$header] = Get-CellValue -Cell $cell -Ns $sheetNs -SharedStrings $sharedStrings
    }
    $result.Add([pscustomobject]$item)
  }

  $result | ConvertTo-Json -Depth 6
} finally {
  $zip.Dispose()
}
