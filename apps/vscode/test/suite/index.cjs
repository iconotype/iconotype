const path = require('path')
const Mocha = require('mocha')
const { globSync } = require('glob')
exports.run = () => {
  const mocha = new Mocha({ ui: 'tdd', color: true, reporter: 'spec' })
  globSync('**/*.test.cjs', { cwd: __dirname }).forEach((f) => mocha.addFile(path.resolve(__dirname, f)))
  return new Promise((res, rej) => mocha.run((n) => (n ? rej(new Error(`${n} failing`)) : res())))
}
