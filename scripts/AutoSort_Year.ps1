# 获取脚本当前所在的根目录
$rootDir = $PSScriptRoot

# 递归搜索根目录下所有的 png 图片 (包含所有子文件夹)
# 如果不仅是png，想包含所有文件，把 "*.png" 改为 "*.*"
# -Recurse 参数让它能钻进月份文件夹里
$files = Get-ChildItem -Path $rootDir -Filter "*.png" -Recurse

Write-Host "正在扫描并整理一整年的文件，请稍候..." -ForegroundColor Cyan

ForEach ($file in $files) {
    $fileName = $file.Name

    # 规则：匹配下划线 "_" 前面的内容作为日期
    # 例如：10.01_p1.png -> 识别出 10.01
    if ($fileName -match "_") {
        $datePrefix = $fileName.Split("_")[0]

        # 关键点：我们在“文件当前所在的文件夹”里创建新文件夹
        # 这样文件就不会跑乱，还在它所属的月份文件夹里
        $currentParentDir = $file.DirectoryName
        $targetFolder = Join-Path -Path $currentParentDir -ChildPath $datePrefix

        # 如果日期文件夹不存在，就在该月份里创建一个
        if (-not (Test-Path -Path $targetFolder)) {
            New-Item -ItemType Directory -Path $targetFolder | Out-Null
        }

        # 移动文件 (为了防止报错，如果目标已有同名文件，会自动跳过)
        $destFile = Join-Path -Path $targetFolder -ChildPath $fileName
        if (-not (Test-Path -Path $destFile)) {
            Move-Item -Path $file.FullName -Destination $targetFolder
        }
    }
}

Write-Host "整理完成！所有图片已按日期归档到对应月份的子文件夹中。" -ForegroundColor Green
Pause
