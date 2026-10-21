const fs = require('node:fs');
const ts = require('typescript');

function loadTypeScript(module, filename) {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
    });
    module._compile(outputText, filename);
}
require.extensions['.ts'] = loadTypeScript;
require.extensions['.tsx'] = loadTypeScript;
require.extensions['.css'] = () => {};
