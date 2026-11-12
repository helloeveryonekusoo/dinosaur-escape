# Minimal static file server for local testing:  powershell -ExecutionPolicy Bypass -File serve.ps1
param([int]$Port = 8765)
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css'; '.png' = 'image/png'; '.json' = 'application/json'; '.glb' = 'model/gltf-binary'; '.gltf' = 'model/gltf+json'; '.bin' = 'application/octet-stream'; '.jpg' = 'image/jpeg' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($ctx.Request.HttpMethod -eq 'POST' -and $path -like 'shot/*') {
    # debug: save a posted dataURL screenshot into _shots/
    $reader = New-Object IO.StreamReader($ctx.Request.InputStream)
    $data = $reader.ReadToEnd(); $b64 = $data.Substring($data.IndexOf(',') + 1)
    $dir = Join-Path $root '_shots'; if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
    [IO.File]::WriteAllBytes((Join-Path $dir ([IO.Path]::GetFileName($path))), [Convert]::FromBase64String($b64))
    $ctx.Response.StatusCode = 200; $ctx.Response.Close(); continue
  }
  if ($path -eq '') { $path = 'index.html' }
  $file = Join-Path $root $path
  if ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($root))) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
