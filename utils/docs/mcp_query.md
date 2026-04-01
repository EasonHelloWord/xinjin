# `mcp_query.py`

位置：[mcp_query.py](/d:/WORK/xinjin/utils/mcp_query.py)

用途：
通过 stdio 启动本地 `mcp_server`，调用 MCP 工具 `query_workspace`，查询 Dify 知识库并返回原始检索结果。

默认行为：
- 自动连接 `mcp_server/dist/index.js`
- 自动读取 `mcp_server/.env`
- 优先读取当前 `.env` 里的 `DIFY_DEFAULT_DATASET_ID`
- 若未设置，再回退到 `ANYTHINGLLM_WORKSPACE`
- 返回 `results[]`，包含 `text`、`metadata`、`distance`、`score`

常用命令：

列出 MCP 工具：
```bash
python utils/mcp_query.py --list-tools
```

查询当前默认知识库：
```bash
python utils/mcp_query.py "苏菲娅宁·SP·萨图尔努斯7世是谁？"
```

指定返回条数：
```bash
python utils/mcp_query.py "中二病也要谈恋爱的作者是谁？" --top-n 5
```

指定知识库 dataset ID：
```bash
python utils/mcp_query.py "查询内容" --slug 5bbd329d-05f3-4880-a9f6-93cbec087c42
```

拉长超时：
```bash
python utils/mcp_query.py "查询内容" --timeout 300
```

输出完整 MCP 回包：
```bash
python utils/mcp_query.py "查询内容" --raw-mcp
```

常用参数：
- `query`：检索问题
- `--top-n`：返回命中块数量
- `--slug`：知识库 dataset ID
- `--timeout`：请求超时秒数
- `--list-tools`：只列工具
- `--raw-mcp`：打印完整 MCP 外层响应
