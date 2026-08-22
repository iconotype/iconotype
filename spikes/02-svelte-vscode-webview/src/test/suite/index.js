const path = require('path')
const Mocha = require('mocha')
const { globSync } = require('glob')
exports.run = function () {
  const mocha = new Mocha({ ui: 'tdd', color: true, reporter: 'spec' })
  const root = __dirname
  globSync('**/*.test.js', { cwd: root }).forEach(f => mocha.addFile(path.resolve(root, f)))
  return new Promise((res, rej) => mocha.run(fails => (fails ? rej(new Error(fails + ' failing')) : res())))
}
