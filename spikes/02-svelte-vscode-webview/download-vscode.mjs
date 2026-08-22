import { downloadAndUnzipVSCode } from '@vscode/test-electron'
const p = await downloadAndUnzipVSCode('stable')
console.log('VSCODE_PATH=' + p)
