const fs = require('fs')
const os = require('os')
const path = require('path')
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron')

// One shared VSCode download for the whole repo (spikes + CI reuse it).
const cachePath = path.resolve(__dirname, '../../../.vscode-test')

;(async () => {
  try {
    // Resolve the executable explicitly: runTests' own name guess is wrong on macOS
    // when a cachePath is supplied (it looks for .../MacOS/Electron, the binary is .../MacOS/Code).
    const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: 'stable', cachePath })
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, './suite/index.cjs'),
      // a scratch folder to act as the workspace: discovery, export and the usage
      // scan all need real files to work on
      launchArgs: [
        fs.mkdtempSync(path.join(os.tmpdir(), 'iconotype-ws-')),
        '--disable-extensions', '--disable-gpu', '--no-sandbox',
      ],
    })
  } catch (e) {
    console.error('TESTS FAILED:', e.message)
    process.exit(1)
  }
})()
