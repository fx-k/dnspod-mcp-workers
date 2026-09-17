"""验收全部工具的 JSON Schema 元结构；不使用任何云端凭据。"""
import json
import subprocess
from jsonschema import Draft202012Validator

tools = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import {TOOLS} from './src/tools.js'; console.log(JSON.stringify(TOOLS))"
], text=True))
for tool in tools:
    Draft202012Validator.check_schema(tool["inputSchema"])
print(f"PASS: {len(tools)} 个工具的 inputSchema 通过 Draft 2020-12 元 Schema 检查")
