const path = require('path')
const { runTests } = require('@vscode/test-electron')
;(async () => {
  try {
    await runTests({
      extensionDevelopmentPath: path.resolve(__dirname, '../../'),
      extensionTestsPath: path.resolve(__dirname, './suite/index'),
      launchArgs: ['--disable-extensions', '--disable-gpu', '--no-sandbox'],
    })
  } catch (e) { console.error('TESTS FAILED:', e.message); process.exit(1) }
})()
