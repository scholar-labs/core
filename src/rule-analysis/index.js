import * as core from '@ast-grep/napi';
import { parseYaml } from './yaml-parser.js';

export function analyze(sourceCode, YamlRule) {
    const rule = parseYaml(YamlRule).rule;
     
    // construct rule object
    const ruleObject = {"rule": rule};

    // parse source code to JavaScript syntax tree
    const tree = core.parse(core.Lang.JavaScript, sourceCode);
    const root = tree.root();

    const relevantNodes = root.findAll(ruleObject);

    const result = [];

    for(let node of relevantNodes) {
        let nodeInfo = {};
        nodeInfo.text = node.text();
        nodeInfo.range = node.range();
        result.push(nodeInfo);
    }
    return result;
}