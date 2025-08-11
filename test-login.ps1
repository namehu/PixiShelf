# Set error handling
$ErrorActionPreference = "Stop"

# Login to get Token
$loginBody = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3002/api/v1/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
    $token = $loginResponse.token
    Write-Host "Login successful, Token: $($token.Substring(0, 20))..."
} catch {
    Write-Host "Login failed: $($_.Exception.Message)"
    exit 1
}

# Set Headers
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# Check scan path and status
try {
    $scanStatus = Invoke-RestMethod -Uri "http://localhost:3002/api/v1/scan/status" -Headers $headers
    Write-Host "Current scan status: $($scanStatus.scanning)"
    
    $scanPathResp = Invoke-RestMethod -Uri "http://localhost:3002/api/v1/settings/scan-path" -Headers $headers
    $scanPath = $scanPathResp.scanPath
    Write-Host "Scan path: $scanPath"

    if (-not $scanPath) {
        Write-Host "Scan path is not configured. Please set it in the Settings page first."
        exit 1
    }
    
    if (-not $scanStatus.scanning) {
        Write-Host "Starting new scan..."
        $scanBody = @{ force = $true } | ConvertTo-Json
        $scanResult = Invoke-RestMethod -Uri "http://localhost:3002/api/v1/scan" -Method POST -Headers $headers -Body $scanBody
        Write-Host "Scan started"
        
        # Wait for scan completion
        do {

            $scanStatus = Invoke-RestMethod -Uri "http://localhost:3002/api/v1/scan/status" -Headers $headers
            Write-Host "Scan status: $($scanStatus.scanning), message: $($scanStatus.message)"
            Start-Sleep -Seconds 2
        } while ($scanStatus.scanning)
        
        Write-Host "Scan completed!"
    }
} catch {
    Write-Host "Scan operation failed: $($_.Exception.Message)"
}

# Check tags
try {
    $tagsResponse = Invoke-RestMethod -Uri "http://localhost:3002/api/v1/artworks?pageSize=1" -Headers $headers
    Write-Host ""
    Write-Host "=== Tag parsing test results ==="
    Write-Host "Total artworks: $($tagsResponse.total)"
    
    if ($tagsResponse.items.Count -gt 0) {
        $artwork = $tagsResponse.items[0]
        Write-Host "First artwork:"
        Write-Host "  - ID: $($artwork.id)"
        Write-Host "  - Title: $($artwork.title)"
        Write-Host "  - Artist: $($artwork.artist.name)"
        Write-Host "  - Description: $($artwork.description)"
        Write-Host "  - Tag count: $($artwork.tags.Count)"
        
        if ($artwork.tags.Count -gt 0) {
            Write-Host "  - Tags:"
            foreach ($tag in $artwork.tags) {
                Write-Host "    * $tag"
            }
        }
    }
    
    # Test tag filtering
    Write-Host ""
    Write-Host "=== Tag filtering test ==="
    $filterResponse = Invoke-RestMethod -Uri "http://localhost:3002/api/v1/artworks?tags=AI%E7%94%9F%E6%88%90&pageSize=5" -Headers $headers
    Write-Host "Artworks with 'AI generated' tag: $($filterResponse.total)"
    
    if ($filterResponse.items.Count -gt 0) {
        Write-Host "Filtered results:"
        foreach ($artwork in $filterResponse.items) {
            Write-Host "  - $($artwork.title) (tags: $($artwork.tags -join ', '))"
        }
    }
    
} catch {
    Write-Host "Failed to get artwork list: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Test completed!"