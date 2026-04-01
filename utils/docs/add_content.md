# `add_content.py`

位置：[add_content.py](/d:/WORK/xinjin/utils/add_content.py)

用途：
通过本地 `mcp_server` 的 Admin API 向 Dify 知识库添加内容。

支持内容类型：
- `URL`
- `文件`

说明：
- 文本请先保存为 `.txt`
- 网页可直接传 `URL`
- 本地网页可传 `.html`
- 其他文件如 `.pdf`、`.md` 也可直接上传
- 工具会用本地登记文件做去重，避免同一内容重复灌入

常用命令：

列出知识库：
```bash
python utils/add_content.py --list-workspaces
```

添加 URL 到知识库：
```bash
python utils/add_content.py --url "https://example.com/page" --workspace Xinjin
```

添加文件到知识库：
```bash
python utils/add_content.py --file "D:\\docs\\note.txt" --workspace Xinjin
```

添加内容并附带 metadata：
```bash
python utils/add_content.py --url "https://example.com/page" --workspace Xinjin --meta source=wiki --meta lang=zh
```

传完整 JSON metadata：
```bash
python utils/add_content.py --file "D:\\docs\\page.html" --workspace Xinjin --metadata "{\"source\":\"archive\",\"topic\":\"anime\"}"
```

只做去重预览，不实际上传：
```bash
python utils/add_content.py --url "https://example.com/page" --workspace Xinjin --meta source=wiki --dry-run
```

强制重复上传：
```bash
python utils/add_content.py --file "D:\\docs\\note.txt" --workspace Xinjin --force
```

常用参数：
- `--url`：上传 URL
- `--file`：上传本地文件
- `--workspace`：知识库名或 dataset ID
- `--meta key=value`：附加 metadata，可重复使用
- `--metadata`：传 JSON metadata
- `--dry-run`：只看去重结果
- `--force`：跳过去重直接上传
- `--registry`：指定本地去重登记文件
